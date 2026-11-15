/**
 * GLSL for the national map. Frame: kilometres, x east, z south, y up (see engine.ts).
 *
 * The relief is lit as a physical surface by a fixed low sun from the north-west (the direction the baked cast
 * shadows in surface.png were made for), with sky light weighted by openness. Colour comes from rules on today's
 * elevation, slope and wetness plus a national woodland figure for the year; what is generic is said where it is
 * done. Water is the sea of the chosen year, found from the flood-level field so the coast moves with sea level.
 */

/** Must match SUN_AZIMUTH / SUN_ELEVATION in scripts/national/build-surface.py (the baked cast shadows). */
export const SUN = { azimuthDeg: 315, elevationDeg: 24 };

export const FOG_KM = 4200;

const COMMON = /* glsl */ `
  uniform sampler2D uH;
  uniform vec4 uRect;
  uniform float uSea;
  uniform float uExag;
  float edgeFade(vec2 m){ vec2 e = min(m, 1.0 - m); return smoothstep(0.0, 0.07, min(e.x, e.y) + (sin(m.x * 37.0 + sin(m.y * 23.0) * 2.0) + sin(m.y * 41.0 + sin(m.x * 19.0) * 2.0)) * 0.006); }
`;

export const TERRAIN_VS = /* glsl */ `
  ${COMMON}
  varying vec2 vM;
  varying vec3 vW;
  void main(){
    vec4 w = modelMatrix * vec4(position, 1.0);
    vM = (w.xz - uRect.xy) * uRect.zw;
    float h = texture2D(uH, vM).r;
    w.y = mix(uSea, max(h, uSea), edgeFade(vM)) * uExag;
    vW = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

/** Shared helpers: noise from a tiling texture, tone mapping, haze. */
const LIB = /* glsl */ `
  uniform sampler2D uNoise;
  uniform vec3 uSunDir, uSunCol, uSkyCol, uHaze;
  uniform float uTime;
  uniform float uHazeK;

  // Noise from a small tiling texture. Each lookup fades to its mean once its features shrink below a couple of
  // pixels (gKpp = km per pixel here), so far views show no shimmer and no tile pattern; octaves are rotated so
  // the tiles do not line up.
  const mat2 ROT = mat2(0.8, 0.6, -0.6, 0.8);
  float gKpp = 1.0;
  float fadeK(float f){ return 1.0 - smoothstep(0.35, 1.0, gKpp * f * 8.0); }
  // explicit level of detail (256 texels per unit), so lookups are safe inside branches
  float lodK(float f){ return max(0.0, log2(256.0 * f * gKpp)); }
  float nk(vec2 p, float f, float o){ return 0.5 + (textureLod(uNoise, p * f + o, lodK(f)).r - 0.5) * fadeK(f); }
  vec4 n4k(vec2 p, float f, vec2 o){ return 0.5 + (textureLod(uNoise, p * f + o, lodK(f)) - 0.5) * fadeK(f); }
  float fbmk(vec2 p, float f, float o){
    return (nk(p, f, o) + 0.5 * nk(ROT * p, f * 2.03, o + 0.31) + 0.25 * nk(ROT * (ROT * p), f * 4.11, o + 0.17)) / 1.75;
  }

  vec3 tonemap(vec3 c){
    // ACES fit (Narkowicz), slightly lifted toe so shadows keep their colour
    c *= 0.92;
    vec3 t = clamp((c * (2.51 * c + 0.03)) / (c * (2.43 * c + 0.59) + 0.14), 0.0, 1.0);
    return mix(t, c / (1.0 + c), 0.15);
  }
  // open water: depth colour lit by sun and sky, a scrolling swell used as slopes, sky reflection and sun glitter
  vec3 seaSurface(vec3 seaC, vec2 wp, vec3 V, float near, float cloud, float motion, out vec3 skyR, out float sfres){
    float tt = uTime * motion;
    vec4 s1 = n4k(wp, 0.9, vec2(tt * 0.018, tt * 0.011)) - 0.5;
    vec4 s2 = n4k(ROT * wp, 2.3, -vec2(tt * 0.013, tt * 0.024)) - 0.5;
    float waveAmp = 0.06 + 0.1 * near;
    vec3 Ns = normalize(vec3((s1.x + s2.z * 0.6) * waveAmp, 1.0, (s1.y + s2.w * 0.6) * waveAmp));
    sfres = 0.02 + 0.98 * pow(1.0 - max(dot(V, Ns), 0.0), 5.0);
    vec3 R = reflect(-V, Ns);
    skyR = mix(uHaze, uSkyCol * 1.15, smoothstep(0.0, 0.5, R.y));
    float rs = max(dot(R, uSunDir), 0.0);
    // a broad warm sheen towards the sun, and sharp glints that sparkle only when the swell is resolved
  #ifdef LOWQ
    float spark = 1.0;
  #else
    float spark = mix(1.0, smoothstep(0.62, 0.9, n4k(wp, 3.1, vec2(tt * 0.03, -tt * 0.02)).r), near);
  #endif
    float glit = pow(rs, 360.0) * 4.0 * spark + pow(rs, 30.0) * 0.06;
    vec3 c = seaC * (uSunCol * 0.28 * (1.0 - 0.3 * cloud) + uSkyCol * 0.55);
    return mix(c, skyR, sfres * 0.6) + uSunCol * glit * (1.0 - 0.7 * cloud);
  }
  // aerial perspective: path length through a low haze layer, so a map seen from straight above stays clear
  float hazeAmount(vec3 w){
    float d = length(cameraPosition - w);
    float drop = max(cameraPosition.y - w.y, 1.0);
    float path = d * min(1.0, 60.0 / drop);
    return 1.0 - exp(-path * uHazeK);
  }
`;

export const TERRAIN_FS = /* glsl */ `
  ${COMMON}
  ${LIB}
  uniform sampler2D uRel, uSurf, uWat, uPol;
  uniform vec2 uTexel;      // 1 / height grid size
  uniform vec2 uCell;       // km per height texel (x, z)
  uniform float uWood, uWoodThr, uFarm, uCarr, uPolOn, uLight, uMotion, uDetail;
  uniform vec3 cGrass, cDown, cWood, cWood2, cCarr, cReed, cHeath, cMoor, cRock, cSedge, cSand, cWetSand, cMud,
               cFieldA, cFieldB, cFieldC, cFieldD, cShallow, cShelf, cDeep, cOpen, cTurbid, cFoam, cRiver, cLake;
  varying vec2 vM;
  varying vec3 vW;

  // cubic B-spline lookup of the flood-level channel: a smooth field, so the coastline it draws is smooth too
  float floodAt(vec2 uv, float lod){
    vec2 size = 1.0 / uTexel;
    vec2 st = uv * size - 0.5;
    vec2 i = floor(st), f = st - i;
    vec2 f2 = f * f, f3 = f2 * f;
    vec2 w0 = (-f3 + 3.0 * f2 - 3.0 * f + 1.0) / 6.0;
    vec2 w1 = (3.0 * f3 - 6.0 * f2 + 4.0) / 6.0;
    vec2 w2 = (-3.0 * f3 + 3.0 * f2 + 3.0 * f + 1.0) / 6.0;
    vec2 w3 = f3 / 6.0;
    vec2 g0 = w0 + w1, g1 = w2 + w3;
    vec2 p0 = (i - 1.0 + w1 / g0 + 0.5) * uTexel;
    vec2 p1 = (i + 1.0 + w3 / g1 + 0.5) * uTexel;
    return g0.y * (g0.x * textureLod(uH, vec2(p0.x, p0.y), lod).g + g1.x * textureLod(uH, vec2(p1.x, p0.y), lod).g)
         + g1.y * (g0.x * textureLod(uH, vec2(p0.x, p1.y), lod).g + g1.x * textureLod(uH, vec2(p1.x, p1.y), lod).g);
  }
  vec2 decSlope(vec2 c){ vec2 v = c * 2.0 - 1.0; return sign(v) * v * v; }

  vec2 hash22(vec2 p){ vec3 q = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); q += dot(q, q.yzx + 33.33); return fract((q.xx + q.yz) * q.zy); }
  // irregular field patchwork (generic farmland texture): nearest of jittered cell centres
  vec3 fields(vec2 p, out float edge){
    vec2 i = floor(p), f = fract(p);
    float d1 = 9.0, d2 = 9.0; vec2 id = vec2(0.0);
    for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
      vec2 g = vec2(float(x), float(y));
      vec2 o = 0.5 + 0.8 * (hash22(i + g) - 0.5);
      float d = length(g + o - f);
      if (d < d1) { d2 = d1; d1 = d; id = i + g; } else if (d < d2) d2 = d;
    }
    edge = d2 - d1;
    vec4 r = vec4(hash22(id + 17.1), hash22(id * 1.7 - 3.3));
    vec3 c = mix(mix(cFieldA, cFieldB, step(0.5, r.x)), mix(cFieldC, cFieldD, step(0.5, r.y)), step(0.55, r.z));
    float ang = r.w * 3.1416;
    float stripe = sin(dot(p, vec2(cos(ang), sin(ang))) * 44.0) * 0.5 + 0.5;
    return c * (0.93 + 0.1 * r.w) * (0.97 + 0.05 * stripe);
  }

  void main(){
    vec2 hf = texture2D(uH, vM).rg;
    float h = hf.r;
    float a = h - uSea;                                  // height above the sea of the year (m)
    vec4 surf = texture2D(uSurf, vM);                   // openness, wetland, sun visibility, lake
    vec3 rel = texture2D(uRel, vM).rgb;
    vec2 wat = texture2D(uWat, vM).rg;
    vec4 pol = texture2D(uPol, vM);
    float kpp = max(length(fwidth(vW.xz)), 1e-4);         // km per pixel here
    gKpp = kpp / uDetail;                                // lower quality: fine texture fades out sooner
    float near = 1.0 - smoothstep(0.05, 0.6, gKpp);      // 1 when close enough for fine texture
    float tpp = length(fwidth(vM / uTexel));            // height texels per pixel
    float hlod = max(0.0, log2(tpp));
    vec2 dx = dFdx(vM), dy = dFdy(vM);
    vec2 wp = vW.xz;
    vec3 V = normalize(cameraPosition - vW);
    float tt = uTime * uMotion;
    float cloud = smoothstep(0.52, 0.78, fbmk(wp + vec2(uTime * 0.26, uTime * 0.1) * uMotion, 0.0042, 0.21));

    // ---------------- coast (from the sea of this year) ----------------
    float fl = floodAt(vM, hlod) - uSea;
    float px = fl / max(fwidth(fl), 1e-5);              // first estimate of the signed distance in pixels
    if (abs(px) < 8.0) {
      // near the coast: the screen gradient of the smooth field, so the line is clean rather than stepped
      vec2 e = uTexel * 0.5;
      vec2 gUv = vec2(floodAt(vM + vec2(e.x, 0.0), hlod) - uSea - fl, floodAt(vM + vec2(0.0, e.y), hlod) - uSea - fl) / e;
      px = fl / max(length(vec2(dot(gUv, dx), dot(gUv, dy))), 1e-5);
    }
    float coastOk = smoothstep(0.25, 0.9, edgeFade(vM));
    float wd = px * kpp;                                // signed distance to the coast in km, + = land
    float landA = clamp(px + 0.5, 0.0, 1.0) * smoothstep(0.0, 0.6, edgeFade(vM));
    float sunVis = surf.b * (1.0 - 0.38 * cloud);

    // ---------------- land ----------------
    vec3 lit = vec3(0.0);
    if (landA > 0.0 || px > -2.0) {
      vec2 slope = decSlope(rel.rg);                     // true rise over run, +x east, +z south
      float ridge = (rel.b - 0.5) * 80.0;                // local relief (m): + ridge, - hollow
      float steep = length(slope);
      // fine procedural relief: random slope perturbation, stronger on rough upland, gone on level lowland
      float rough = smoothstep(0.02, 0.22, steep) * 0.9 + smoothstep(120.0, 500.0, a) * 0.5;
      vec4 nz = n4k(wp, 0.11, vec2(0.0)) - 0.5;
    #ifdef LOWQ
      vec4 nz2 = vec4(0.0), nz3 = vec4(0.0);                     // Low quality: the coarse layer only
    #else
      vec4 nz2 = n4k(ROT * wp, 0.53, vec2(0.2)) - 0.5;
      vec4 nz3 = n4k(ROT * (ROT * wp), 2.2, vec2(0.7)) - 0.5;      // gullies and scree, close up
    #endif
      vec2 micro = (nz.xy * 0.05 + nz2.zw * 0.04 + nz3.xy * 0.05 * smoothstep(0.15, 0.45, steep)) * rough;

      float wet = surf.g;
      // land cover: ground colour by height, slope and wetness (rules on today's surface, not a survey)
      float g1 = fbmk(wp, 0.021, 0.0);
      vec3 ground = mix(cGrass, cDown, smoothstep(40.0, 180.0, a) * smoothstep(-2.0, 20.0, ridge) * (1.0 - smoothstep(320.0, 420.0, a)) * 0.8);
      ground = mix(ground, cHeath, smoothstep(230.0, 380.0, a + g1 * 90.0));
      ground = mix(ground, cMoor, smoothstep(380.0, 560.0, a + g1 * 120.0 - ridge * 1.5) * (1.0 - smoothstep(0.35, 0.6, steep)));
      float rockA = smoothstep(0.32, 0.62, steep + max(a - 650.0, 0.0) * 0.0007 + max(ridge, 0.0) * 0.004);
      vec3 rockC = cRock * (0.86 + 0.28 * nk(ROT * wp, 1.3, 0.2)) * (0.92 + 0.16 * nz3.z);
      ground = mix(ground, rockC, rockA);

      // generic farmland patchwork on open lowland, more of it as the woodland figure falls
      float farmVis = uFarm * (1.0 - smoothstep(180.0, 320.0, a)) * (1.0 - smoothstep(0.08, 0.2, steep)) * (1.0 - wet);
      float fnear = 1.0 - smoothstep(0.025, 0.16, gKpp); // the patchwork only resolves close up
      vec3 farmTone = ground;
    #ifndef LOWQ
      if (farmVis * fnear > 0.002) {
        float fe;
        vec3 fc = fields(wp * 1.25, fe);
        farmTone = mix(ground, fc, 0.3 * fnear);
        farmTone = mix(farmTone, ground * 0.9, fnear * (1.0 - smoothstep(0.0, 0.04, fe)) * 0.35);
      }
    #endif
      // seen from afar, farmed country is a patchy mix of crop, grass and fallow rather than one green (generic)
      float m1 = fbmk(wp, 0.045, 5.1), m2 = fbmk(ROT * wp, 0.11, 2.9);
      vec3 mottle = mix(mix(cFieldD, cFieldB, smoothstep(0.42, 0.6, m1)), mix(cFieldA, cFieldC, smoothstep(0.45, 0.6, m2)), smoothstep(0.5, 0.62, m2 * 0.6 + m1 * 0.4));
      farmTone = mix(farmTone, mix(farmTone, mottle, 0.45), 1.0 - fnear * 0.6);
      ground = mix(ground, farmTone * vec3(1.03, 1.0, 0.94), farmVis * 0.85);

      // woodland: the year's national cover fraction, placed by a generic, warped noise mask where trees can grow
      float suit = (1.0 - smoothstep(330.0, 520.0, a + g1 * 80.0)) * (1.0 - smoothstep(0.3, 0.55, steep)) * (1.0 - wet * 0.85) * smoothstep(1.0, 12.0, a);
      vec2 wq = wp + (n4k(wp, 0.004, vec2(0.37)).gb - 0.5) * 18.0;
      float wn = fbmk(wq, 0.013, 3.7) * 0.5 + fbmk(ROT * wq, 0.031, 1.1) * 0.3 + nk(ROT * (ROT * wp), 0.09, 0.6) * 0.2;
      float soft = 0.018 + 0.03 * (1.0 - near);
      wn += (nk(ROT * wp, 0.8, 0.3) - 0.5) * 0.05;          // ragged edges close up
      float wood = smoothstep(uWoodThr - soft, uWoodThr + soft, wn) * smoothstep(0.15, 0.5, suit);
      // tree crowns: a fine bump that catches the low sun, close up only
    #ifndef LOWQ
      micro += (n4k(ROT * wp, 7.0, vec2(0.9)).xy - 0.5) * 0.16 * wood;
    #endif
      vec3 N = normalize(vec3(-(slope.x + micro.x) * uLight, 1.0, -(slope.y + micro.y) * uLight));
      vec3 canopy = mix(cWood, cWood2, nk(wp, 2.7, 0.0) * 0.8 + g1 * 0.5 - 0.3);
      canopy *= 1.0 - 0.16 * smoothstep(0.45, 0.75, nk(ROT * wp, 6.1, 0.0));   // crowns and gaps, close up
      ground = mix(ground, canopy, wood * 0.88);

      // fen, levels and moss: wet throughout the period; carr woodland in the early millennia (terrain notes)
      float wetA = smoothstep(0.25, 0.75, wet + (nk(wp, 0.2, 0.9) - 0.5) * 0.35);
      float mere = 0.0;
      if (wetA > 0.0) {
        vec3 reed = mix(cReed, cSedge, smoothstep(0.38, 0.62, fbmk(wp, 0.09, 2.2)));
        vec3 fen = mix(reed, cCarr, uCarr * mix(0.55, 1.0, smoothstep(0.4, 0.6, fbmk(ROT * wp, 0.022, 0.4))));
        vec2 fq = wp + (n4k(wp, 0.02, vec2(1.7)).rg - 0.5) * 4.0;
        mere = smoothstep(0.655, 0.685, fbmk(fq, 0.03, 1.3)) * (1.0 - uCarr * 0.5) * wetA;
        fen = mix(fen, cLake * 0.85, mere);
        ground = mix(ground, fen, wetA);
      }

      // beaches and wet sand along the shore of this year
      float beachW = max(0.14, kpp * 0.9);
      float beach = (1.0 - smoothstep(beachW * 0.5, beachW, wd)) * (1.0 - smoothstep(4.0, 14.0, a)) * (1.0 - smoothstep(0.06, 0.2, steep)) * coastOk;
      ground = mix(ground, mix(cSand, cWetSand, 1.0 - smoothstep(0.0, beachW * 0.35, wd)), beach * (1.0 - wet * 0.5) * mix(0.55, 1.0, near));

      // light: low sun with baked cast shadow and drifting cloud shade, sky light by openness
      float ndl = max(dot(N, uSunDir), 0.0);
      float cav = clamp(0.5 + ridge * 0.012, 0.0, 1.0);
      float sky = mix(0.55, 1.0, surf.r) * (0.6 + 0.4 * N.y) * (0.82 + 0.36 * cav);
      lit = ground * (uSunCol * ndl * sunVis + uSkyCol * sky);
      float fres = pow(1.0 - max(V.y, 0.0), 5.0);
      lit += uSkyCol * (mere * (0.15 + 0.6 * fres));     // meres catch the sky

      // rivers and lakes, drawn into the surface so they drape exactly
      float tpw = tpp * 2.0;                             // water-field texels (4096 grid) per pixel
      float dPx = wat.r * 8.0 / tpw;                     // distance to the water course in pixels
      float rsz = wat.g;
      float halfKm = 0.006 + 0.11 * rsz * rsz;           // indicative half width (km), grows with catchment
      float halfTex = max(halfKm / ((uCell.x + uCell.y) * 0.25), 0.6);   // never thinner than the field can draw
      float halfPx = max(halfTex / tpw, 0.32 + 1.05 * rsz);
      float show = smoothstep(0.0, 0.25, rsz + 0.5 - kpp * 0.55);   // small streams only appear closer in
      float river = (1.0 - smoothstep(halfPx - 0.6, halfPx + 0.6, dPx)) * show * step(0.002, rsz + 0.002);
      float lake = smoothstep(0.42, 0.58, surf.a);
      vec3 waterCol = mix(cRiver, uSkyCol * 0.5, 0.25 + 0.5 * fres);
      float spec = pow(max(dot(reflect(-uSunDir, vec3(0.0, 1.0, 0.0)), V), 0.0), 60.0);
      vec3 riverLit = waterCol * (0.45 + 0.4 * sunVis) + uSunCol * spec * 0.35 * sunVis;
      lit = mix(lit, riverLit, river * 0.92);
      lit = mix(lit, mix(cLake, uSkyCol * 0.55, 0.2 + 0.6 * fres) * (0.55 + 0.35 * sunVis) + uSunCol * spec * 0.5 * sunVis, lake);

      // indicative territories: a soft tint that keeps the relief readable
      vec3 polc = pol.rgb / max(pol.a, 0.001);
      lit = mix(lit, lit * mix(vec3(1.0), polc * 1.9, 0.7) + polc * 0.03, pol.a * uPolOn);
    }

    // ---------------- sea ----------------
    vec3 seaLit = vec3(0.0);
    if (landA < 1.0) {
      float d = max(-a, 0.0);                            // depth below the sea of the year (m)
      vec3 seaC = mix(cShallow, cShelf, smoothstep(1.5, 22.0, d));
      seaC = mix(seaC, cDeep, smoothstep(20.0, 110.0, d));
      seaC = mix(seaC, cTurbid, (1.0 - smoothstep(1.0, 9.0, d)) * 0.45);
      seaC = mix(seaC, cOpen, 1.0 - edgeFade(vM));     // the data stop at the grid edge: melt into open sea
      vec3 skyR; float sfres;
      seaLit = seaSurface(seaC, wp, V, near, cloud, uMotion, skyR, sfres);
      // intertidal flats: ground within a couple of metres below the mean sea of the year shows through
      float flat_ = (1.0 - smoothstep(0.4, 2.6, d + (fbmk(wp, 0.09, 0.0) - 0.5) * 1.6)) * smoothstep(0.0, 1.5, -px) * coastOk;
      vec3 flatC = mix(cMud, cWetSand, smoothstep(0.3, 0.7, fbmk(wp, 0.05, 2.0)));
      vec3 flatLit = flatC * (uSunCol * 0.42 * (1.0 - 0.3 * cloud) + uSkyCol * 0.75) + skyR * sfres * 0.35;
      seaLit = mix(seaLit, flatLit, flat_ * 0.82);
      // surf: lines of breaking water parallel to the shore, broken up by noise; a fine bright line far out
      float sd = -wd;                                    // km out to sea
      float seaSide = (1.0 - smoothstep(-0.6, 0.4, px)) * coastOk;
      float band = (1.0 - smoothstep(0.0, 0.32 + kpp * 1.2, sd)) * seaSide;
      float lines = smoothstep(0.55, 0.95, sin((sd * 26.0 - tt * 0.9) * 6.2831) * 0.5 + 0.5) * smoothstep(0.35, 0.65, nk(wp, 1.7, tt * 0.01));
      float foam = band * mix(0.55, lines, near) * (1.0 - flat_ * 0.7);
      float hair = (1.0 - smoothstep(0.0, 1.2, -px)) * seaSide * (1.0 - near) * 0.3;
      seaLit = mix(seaLit, cFoam * (0.7 + 0.3 * sunVis), clamp(foam * 0.75 + hair, 0.0, 0.85));
    }

    // ---------------- combine ----------------
    vec3 col = mix(seaLit, lit, landA);
    col = tonemap(col);
    col = mix(col, uHaze, hazeAmount(vW));
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;

/** Open sea beyond the height grid, out to the horizon. */
export const OCEAN_VS = /* glsl */ `
  varying vec3 vW;
  void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }
`;
export const OCEAN_FS = /* glsl */ `
  ${LIB}
  uniform vec3 cOpen;
  uniform float uMotion;
  varying vec3 vW;
  void main(){
    vec3 V = normalize(cameraPosition - vW);
    float kpp = max(length(fwidth(vW.xz)), 1e-4);
    gKpp = kpp;
    float near = 1.0 - smoothstep(0.05, 0.6, kpp);
    vec3 skyR; float sfres;
    vec3 c = seaSurface(cOpen, vW.xz, V, near, 0.0, uMotion, skyR, sfres);
    c = tonemap(c);
    c = mix(c, uHaze, hazeAmount(vW));
    gl_FragColor = vec4(c, 1.0);
    #include <colorspace_fragment>
  }
`;

export const SKY_VS = /* glsl */ `
  varying vec3 vD;
  void main(){ vD = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
export const SKY_FS = /* glsl */ `
  uniform vec3 uHaze, cTop, uSunDir;
  varying vec3 vD;
  void main(){
    vec3 d = normalize(vD);
    vec3 c = mix(uHaze, cTop, smoothstep(0.0, 0.6, d.y));
    float sun = max(dot(d, uSunDir), 0.0);
    c += vec3(1.0, 0.86, 0.66) * (pow(sun, 8.0) * 0.18 + pow(sun, 120.0) * 0.5);
    c = mix(c, uHaze * 1.04, exp(-abs(d.y) * 18.0) * 0.5);
    gl_FragColor = vec4(c, 1.0);
    #include <colorspace_fragment>
  }
`;

/**
 * Markers: one instanced quad per place, drawn from the symbol atlas (src/national/icons.ts).
 * aInst: x, y, z (world);  aStyle: size px, atlas cell, alpha, flags (1 abandoned, 2 enterable, 4 selected, 8 hovered);
 * aTint: ground colour (paper, or the evidence colour), aAcc: accent colour.
 */
export const MARKER_VS = /* glsl */ `
  attribute vec3 aInst;
  attribute vec4 aStyle;
  attribute vec3 aTint;
  attribute vec3 aAcc;
  uniform vec2 uViewport;   // CSS pixels
  varying vec2 vUv;
  varying vec4 vStyle;
  varying vec3 vTint;
  varying vec3 vAcc;
  varying float vPad;
  void main(){
    vStyle = aStyle; vTint = aTint; vAcc = aAcc;
    float flags = aStyle.w;
    bool site = mod(floor(flags / 2.0), 2.0) > 0.5;
    bool sel = mod(floor(flags / 4.0), 2.0) > 0.5;
    bool hov = mod(floor(flags / 8.0), 2.0) > 0.5;
    float grow = sel ? 1.18 : hov ? 1.12 : 1.0;
    // the quad is padded so a beacon or a selection ring fits around the symbol
    vPad = site ? 3.0 : (sel || hov) ? 1.9 : 1.25;
    float size = aStyle.x * grow * vPad;
    vec4 c = projectionMatrix * modelViewMatrix * vec4(aInst, 1.0);
    vUv = position.xy * vPad;    // -pad..pad; the symbol itself spans -1..1
    c.xy += position.xy * size / uViewport * c.w;
    gl_Position = aStyle.z > 0.004 ? c : vec4(2.0, 2.0, 2.0, 1.0);
  }
`;

export const MARKER_FS = /* glsl */ `
  uniform sampler2D uAtlas;
  uniform float uTime;
  uniform float uMotion;
  uniform float uCols;
  uniform vec3 cInk, cGilt;
  varying vec2 vUv;
  varying vec4 vStyle;
  varying vec3 vTint;
  varying vec3 vAcc;
  varying float vPad;
  vec4 cell(vec2 uv, float bias){
    if (any(greaterThan(abs(uv), vec2(1.0)))) return vec4(0.0);
    float i = vStyle.y;
    vec2 base = vec2(mod(i, uCols), floor(i / uCols));
    vec2 t = (base + vec2(uv.x * 0.5 + 0.5, 0.5 - uv.y * 0.5)) / uCols;
    return texture2D(uAtlas, t, bias);
  }
  void main(){
    float flags = vStyle.w;
    bool site = mod(floor(flags / 2.0), 2.0) > 0.5;
    bool sel = mod(floor(flags / 4.0), 2.0) > 0.5;
    bool hov = mod(floor(flags / 8.0), 2.0) > 0.5;
    vec2 uv = vUv;
    float r = length(uv);
    float px = 2.0 / (vStyle.x * vPad);        // uv units per pixel, roughly
    vec4 c = vec4(0.0);

    // soft drop shadow: the symbol's coverage, blurred by a coarser mip and nudged down-right
    vec2 su = uv - vec2(0.07, -0.1);
    float sh = cell(su, 1.6).a * (1.0 - smoothstep(0.62, 0.9, max(abs(su.x), abs(su.y))));
    c = vec4(cInk, sh * 0.42);

    // enterable site: a slow gold beacon (still when motion is reduced) and a steady gilt ring
    if (site) {
      float ph = fract(uTime * 0.38 * uMotion + 0.15);
      float rr = 1.15 + ph * 1.75;
      float ring = (1.0 - smoothstep(0.0, 0.09 + px, abs(r - rr))) * (1.0 - ph) * (1.0 - ph) * 0.85 * step(0.5, uMotion);
      float glow = exp(-pow(max(r - 1.2, 0.0) * 2.6, 2.0)) * 0.28 * smoothstep(1.0, 1.25, r);
      c.rgb = mix(c.rgb, cGilt, max(ring, glow));
      c.a = max(c.a, max(ring, glow));
      float rw = sel ? 0.085 : 0.055;
      float steady = 1.0 - smoothstep(0.0, px * 1.2, abs(r - 1.2) - rw);
      float steadyBack = 1.0 - smoothstep(0.0, px * 1.2, abs(r - 1.2) - rw - 0.06);
      c = mix(c, vec4(cInk, 0.85), steadyBack * 0.8);
      c = mix(c, vec4(cGilt * 1.15, 1.0), steady);
    }
    // selected: a paper ring; hovered: a soft light halo
    if (sel && !site) {
      float ring = 1.0 - smoothstep(0.0, px * 1.2, abs(r - 1.3) - 0.06);
      float back = 1.0 - smoothstep(0.0, px * 1.2, abs(r - 1.3) - 0.12);
      c = mix(c, vec4(cInk, 0.9), back);
      c = mix(c, vec4(1.0, 0.98, 0.92, 1.0), ring);
    } else if (hov) {
      float halo = exp(-pow(max(r - 0.85, 0.0) * 2.4, 2.0)) * 0.55;
      c = mix(c, vec4(1.0, 0.97, 0.88, halo), halo * (1.0 - c.a * 0.5));
    }

    // the symbol: repaint each channel (ground, ink, accent) and keep the antialiasing between them
    vec4 s = cell(uv, -0.4);
    s *= 1.0 - smoothstep(0.88, 0.99, max(abs(uv.x), abs(uv.y)));   // never anything from a neighbouring cell
    if (s.a > 0.002) {
      vec3 w = s.rgb / s.a;
      w /= max(w.r + w.g + w.b, 1e-3);
      vec3 col = vTint * w.r + cInk * w.g + vAcc * w.b;
      // a faint engraved sheen: lighter at the top of the symbol
      col *= 0.94 + 0.1 * smoothstep(-1.0, 1.0, uv.y);
      c.rgb = mix(c.rgb, col, s.a);
      c.a = s.a + c.a * (1.0 - s.a);
    }
    c.a *= vStyle.z;
    if (c.a < 0.004) discard;
    gl_FragColor = c;
    #include <colorspace_fragment>
  }
`;
