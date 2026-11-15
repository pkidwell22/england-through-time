import * as THREE from "three";

/**
 * Measurements taken from a photographed (equirectangular, linear HDR) sky, so that the sun, the sky fill,
 * the haze and the cloud shadows all agree with the photograph rather than with hand-set constants.
 *
 * Units: whatever the HDR is in. The caller scales everything by one factor (see `sceneScale`), so ratios
 * (sun to sky, horizon colour to zenith) are the photograph's own.
 */
export interface SkyInfo {
  width: number;
  height: number;
  /** Sun position in the image: longitude angle (radians, image convention) and elevation (radians). */
  sunLon: number;
  sunEl: number;
  /** True when a distinct sun disc was found (false for overcast skies). */
  hasSun: boolean;
  /** Irradiance from the sun disc on a surface facing the sun (linear RGB). */
  sunIrr: THREE.Color;
  /** Irradiance from the rest of the sky on a horizontal surface (linear RGB). */
  skyIrr: THREE.Color;
  /** Mean radiance of the horizon band (1..6 degrees up) looking away from and towards the sun. */
  horizonAway: THREE.Color;
  horizonToward: THREE.Color;
  /** Mean radiance of the whole horizon band. */
  horizon: THREE.Color;
  /** Fraction of the sky (8..70 degrees up) that reads as cloud. */
  cloudCover: number;
  /** Pixel indices of the sun disc (for removing it from the lighting copy). */
  sunPixels: Uint32Array;
}

const lum = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

export function analyseSky(data: Float32Array, width: number, height: number): SkyInfo {
  const ch = data.length / (width * height);
  const N = width * height;
  const L = new Float32Array(N);
  let max = 0, mi = 0;
  for (let i = 0; i < N; i++) {
    const l = lum(data[i * ch], data[i * ch + 1], data[i * ch + 2]);
    L[i] = l;
    if (l > max) { max = l; mi = i; }
  }
  // the 99.9th percentile by sampling (a full sort of 2M floats is slow)
  const sample: number[] = [];
  for (let i = 0; i < N; i += 37) sample.push(L[i]);
  sample.sort((a, b) => a - b);
  const p999 = sample[Math.floor(sample.length * 0.999)];
  const sx = mi % width, sy = Math.floor(mi / width);
  const sunLon = (((sx + 0.5) / width) - 0.5) * Math.PI * 2;
  const sunEl = (0.5 - (sy + 0.5) / height) * Math.PI;
  // a sun disc is a few pixels far brighter than anything else in the sky
  const hasSun = max > p999 * 40 && max > 50;
  const thr = Math.max(p999 * 3, max * 0.02);
  const sunIrr = new THREE.Color(0, 0, 0), skyIrr = new THREE.Color(0, 0, 0);
  const hA = new THREE.Color(0, 0, 0), hT = new THREE.Color(0, 0, 0), hAll = new THREE.Color(0, 0, 0);
  let nA = 0, nT = 0, nAll = 0, sky = 0, cloud = 0;
  const sunPx: number[] = [];
  const sunDirX = Math.cos(sunLon), sunDirZ = Math.sin(sunLon);
  for (let y = 0; y < height; y++) {
    const el = (0.5 - (y + 0.5) / height) * Math.PI;
    const dOm = ((2 * Math.PI) / width) * (Math.PI / height) * Math.cos(el);
    const elDeg = (el * 180) / Math.PI;
    for (let x = 0; x < width; x++) {
      const i = y * width + x, k = i * ch;
      const r = data[k], g = data[k + 1], b = data[k + 2];
      if (hasSun && L[i] > thr) {
        // only pixels near the brightest one count as the sun
        const dx = Math.min(Math.abs(x - sx), width - Math.abs(x - sx)), dy = Math.abs(y - sy);
        if (dx < width / 60 && dy < height / 30) {
          sunIrr.r += r * dOm; sunIrr.g += g * dOm; sunIrr.b += b * dOm;
          sunPx.push(i);
          continue;
        }
      }
      if (el > 0) {
        const s = Math.sin(el) * dOm;
        skyIrr.r += r * s; skyIrr.g += g * s; skyIrr.b += b * s;
        if (elDeg > 1 && elDeg < 6) {
          const lon = (((x + 0.5) / width) - 0.5) * Math.PI * 2;
          const c = Math.cos(lon) * sunDirX + Math.sin(lon) * sunDirZ;
          const rr = Math.min(r, 8), gg = Math.min(g, 8), bb = Math.min(b, 8);
          hAll.r += rr; hAll.g += gg; hAll.b += bb; nAll++;
          if (c > 0.8) { hT.r += rr; hT.g += gg; hT.b += bb; nT++; }
          else if (c < 0) { hA.r += rr; hA.g += gg; hA.b += bb; nA++; }
        }
        if (elDeg > 8 && elDeg < 70 && (x & 3) === 0) {
          // blue sky is saturated; cloud (lit or shaded) is close to neutral
          const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
          const sat = mx > 0 ? 1 - mn / mx : 0;
          sky++;
          if (sat < 0.22) cloud++;
        }
      }
    }
  }
  hA.multiplyScalar(1 / Math.max(1, nA));
  hT.multiplyScalar(1 / Math.max(1, nT));
  hAll.multiplyScalar(1 / Math.max(1, nAll));
  return {
    width, height, sunLon, sunEl, hasSun, sunIrr, skyIrr, horizonAway: hA, horizonToward: hT, horizon: hAll,
    cloudCover: sky ? cloud / sky : 0, sunPixels: Uint32Array.from(sunPx),
  };
}

/**
 * The copy of the sky used for image-based lighting: the sun disc removed (the shadow-casting directional
 * light carries the sun, so leaving it in would light everything twice, and without shadows), and the lower
 * hemisphere replaced by light bounced off the ground: the ground's albedo times what falls on it, so walls
 * pick up the colour of the earth, grass or water in front of them instead of the photograph's stand-in.
 */
export function lightingSky(data: Float32Array, info: SkyInfo, groundAlbedo: THREE.Color, sunOnGround: number): Float32Array {
  const { width, height } = info;
  const ch = data.length / (width * height);
  const out = new Float32Array(width * height * 4);
  for (let i = 0, n = width * height; i < n; i++) {
    out[i * 4] = data[i * ch];
    out[i * 4 + 1] = data[i * ch + 1];
    out[i * 4 + 2] = data[i * ch + 2];
    out[i * 4 + 3] = 1;
  }
  if (info.sunPixels.length) {
    // fill the disc with the mean of a ring around it
    const ring = new THREE.Color(0, 0, 0);
    let n = 0;
    const sx = Math.round(((info.sunLon / (Math.PI * 2)) + 0.5) * width - 0.5), sy = Math.round((0.5 - info.sunEl / Math.PI) * height - 0.5);
    const R = Math.max(6, Math.round(width / 90));
    for (let a = 0; a < 64; a++) {
      const x = (sx + Math.round(Math.cos((a / 64) * Math.PI * 2) * R) + width) % width;
      const y = Math.min(height - 1, Math.max(0, sy + Math.round(Math.sin((a / 64) * Math.PI * 2) * R)));
      const k = (y * width + x) * 4;
      ring.r += Math.min(out[k], 20); ring.g += Math.min(out[k + 1], 20); ring.b += Math.min(out[k + 2], 20);
      n++;
    }
    ring.multiplyScalar(1 / n);
    for (const i of info.sunPixels) {
      out[i * 4] = ring.r; out[i * 4 + 1] = ring.g; out[i * 4 + 2] = ring.b;
    }
  }
  // ground: a Lambertian plane under sun and sky
  const eGround = info.skyIrr.clone().add(info.sunIrr.clone().multiplyScalar(sunOnGround));
  const g = eGround.multiply(groundAlbedo).multiplyScalar(1 / Math.PI);
  for (let y = 0; y < height; y++) {
    const el = (0.5 - (y + 0.5) / height) * 180;
    if (el > 1.5) continue;
    // blend across the horizon so there is no hard line in reflections of the lighting
    const w = THREE.MathUtils.smoothstep(-el, -1.5, 3);
    for (let x = 0; x < width; x++) {
      const k = (y * width + x) * 4;
      out[k] += (g.r - out[k]) * w;
      out[k + 1] += (g.g - out[k + 1]) * w;
      out[k + 2] += (g.b - out[k + 2]) * w;
    }
  }
  return out;
}

/** Mean colour of an image (sRGB-encoded, as loaded), returned linear. Used to measure ground albedo. */
export function meanLinearColor(img: CanvasImageSource & { width: number; height: number }): THREE.Color | null {
  try {
    const cv = document.createElement("canvas");
    cv.width = cv.height = 16;
    const ctx = cv.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, 16, 16);
    const d = ctx.getImageData(0, 0, 16, 16).data;
    const c = new THREE.Color(0, 0, 0);
    const toLin = (v: number) => {
      const s = v / 255;
      return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    };
    for (let i = 0; i < d.length; i += 4) { c.r += toLin(d[i]); c.g += toLin(d[i + 1]); c.b += toLin(d[i + 2]); }
    return c.multiplyScalar(1 / 256);
  } catch {
    return null;
  }
}
