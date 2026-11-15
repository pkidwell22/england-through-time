import * as THREE from "three";
import { Sky } from "three/examples/jsm/objects/Sky.js";

/**
 * Lighting for the path tracer, taken from the live scene.
 *
 *  - Photographed HDR sky (the normal case): the same image lights the scene and fills the background. The HDR is
 *    unclipped (the sun disc peaks near 73,000 and carries about half the sky's energy), so the sun is the photograph's
 *    own sun with its true size: soft shadow edges and correct sun/sky balance come for free. The image is turned so
 *    its sun sits exactly where the live view's shadow-casting light is. The path tracer stores the map as half floats
 *    (max 65,504), so the data are divided by a scale that keeps the sun in range and the intensity is multiplied back.
 *    If the live sun's height differs from the photograph's (a site may fix the sun), the sun disc is taken out of
 *    the image and replaced by a directional light of the same energy at the live direction.
 *  - Analytic sky (dawn/dusk sites keep three.js's Sky shader): the sky is rendered to a cube map with the same
 *    parameters, and the live sun is added as a directional light (hard-edged shadows).
 */

export interface PhotoEnv {
  kind: "hdr" | "hdr-relit" | "analytic" | "flat";
  texture: THREE.Texture;
  intensity: number;
  backgroundIntensity: number;
  rotationY: number;
  sun: THREE.DirectionalLight | null;
  /** World direction towards the sun used by the photograph. */
  sunDir: THREE.Vector3;
  /** Diagnostics for the status line and the tests. */
  info: Record<string, number | string | boolean>;
  dispose(): void;
}

/** The live sun as engine.getSun() reports it. */
export interface LiveSun {
  direction: THREE.Vector3;
  color: THREE.Color;
  intensity: number;
  irradiance: THREE.Color;
  visible: boolean;
}

function liveSun(scene: THREE.Scene): THREE.DirectionalLight | null {
  let best: THREE.DirectionalLight | null = null;
  scene.traverse((o) => {
    const l = o as THREE.DirectionalLight;
    if (l.isDirectionalLight && l.visible && (!best || l.intensity > best.intensity)) best = l;
  });
  return best;
}

const az = (v: THREE.Vector3) => Math.atan2(v.x, v.z);

export function buildEnvironment(renderer: THREE.WebGLRenderer, scene: THREE.Scene, live: LiveSun | null): PhotoEnv {
  const sunL = liveSun(scene);
  const liveDir = live ? live.direction.clone().normalize() : sunL ? sunL.position.clone().sub(sunL.target.position).normalize() : new THREE.Vector3(0.5, 0.6, -0.5).normalize();
  // the live view shows the photograph at this scale (its "scene units"); the photo uses the same units, so the haze
  // colours and the metered exposure of the live view apply to it unchanged
  const k = scene.backgroundIntensity ?? 1;
  const bg = scene.background as THREE.DataTexture | null;
  const img = bg && (bg as THREE.DataTexture).isDataTexture ? (bg.image as { data: Float32Array | Uint16Array; width: number; height: number }) : null;
  if (bg && img && bg.mapping === THREE.EquirectangularReflectionMapping && img.data instanceof Float32Array) {
    const { width: W, height: H } = img;
    const ch = img.data.length / (W * H);
    // copy to RGBA float, find the sun
    const data = new Float32Array(W * H * 4);
    let peak = 0, pi = 0;
    for (let i = 0; i < W * H; i++) {
      const r = img.data[i * ch], g = img.data[i * ch + 1], b = img.data[i * ch + 2];
      data[i * 4] = r; data[i * 4 + 1] = g; data[i * 4 + 2] = b; data[i * 4 + 3] = 1;
      const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      if (l > peak) {
        peak = l;
        pi = i;
      }
    }
    // texture direction of the sun in the path tracer's equirect convention (data row 0 = top when flipY is set)
    const px = pi % W, py = Math.floor(pi / W);
    const v = bg.flipY ? 1 - (py + 0.5) / H : (py + 0.5) / H;
    const theta = ((px + 0.5) / W - 0.5) * 2 * Math.PI, phi = (1 - v) * Math.PI;
    const sTex = new THREE.Vector3(Math.sin(phi) * Math.cos(theta), Math.cos(phi), Math.sin(phi) * Math.sin(theta));
    const rotationY = az(liveDir) - az(sTex);
    const elevTex = Math.asin(THREE.MathUtils.clamp(sTex.y, -1, 1));
    const elevLive = Math.asin(THREE.MathUtils.clamp(liveDir.y, -1, 1));
    let kind: PhotoEnv["kind"] = "hdr";
    let sun: THREE.DirectionalLight | null = null;
    const sunDir = new THREE.Vector3().copy(sTex).applyAxisAngle(new THREE.Vector3(0, 1, 0), rotationY);
    const info: PhotoEnv["info"] = {
      k: +k.toFixed(5), rotationY: +rotationY.toFixed(4), liveBackgroundRotationY: +scene.backgroundRotation.y.toFixed(4),
      hdrSunElevDeg: +THREE.MathUtils.radToDeg(elevTex).toFixed(1), liveSunElevDeg: +THREE.MathUtils.radToDeg(elevLive).toFixed(1),
      azimuthErrorDeg: +THREE.MathUtils.radToDeg(Math.abs(Math.atan2(Math.sin(az(sunDir) - az(liveDir)), Math.cos(az(sunDir) - az(liveDir))))).toFixed(2),
      liveSunVisible: !!live?.visible,
    };
    // The sun's energy: the disc (pixels within 4° of the peak, above the bright-sky level) against the live sun's
    // irradiance. Where they disagree by more than 15 % the disc is rescaled, so the sun/sky balance is the live one
    // and the shadows keep the photograph's soft edge.
    const thrSky = (() => {
      const sm: number[] = [];
      for (let i = 0; i < W * H; i += 37) sm.push(0.2126 * data[i * 4] + 0.7152 * data[i * 4 + 1] + 0.0722 * data[i * 4 + 2]);
      sm.sort((a, b) => a - b);
      return Math.max(sm[Math.floor(sm.length * 0.999)] * 3, peak * 0.02);
    })();
    const discCos = Math.cos(THREE.MathUtils.degToRad(4));
    const dv = new THREE.Vector3();
    const discEach = (fn: (i: number, w: number) => void) => {
      for (let y = 0; y < H; y++) {
        const vv = bg.flipY ? 1 - (y + 0.5) / H : (y + 0.5) / H;
        const ph = (1 - vv) * Math.PI;
        if (Math.abs(ph - phi) > 0.1) continue;
        const dOmega = ((2 * Math.PI) / W) * (Math.PI / H) * Math.sin(ph);
        for (let x = 0; x < W; x++) {
          const th = ((x + 0.5) / W - 0.5) * 2 * Math.PI;
          dv.set(Math.sin(ph) * Math.cos(th), Math.cos(ph), Math.sin(ph) * Math.sin(th));
          const c = dv.dot(sTex);
          if (c < discCos) continue;
          fn((y * W + x) * 4, dOmega * c);
        }
      }
    };
    if (live && live.visible && Math.abs(elevTex - elevLive) <= THREE.MathUtils.degToRad(3)) {
      let E = 0;
      discEach((i, w) => {
        const l = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
        if (l > thrSky) E += (l - thrSky) * w;
      });
      const liveE = 0.2126 * live.irradiance.r + 0.7152 * live.irradiance.g + 0.0722 * live.irradiance.b;
      const ratio = E * k > 0 ? (E * k) / liveE : 0;
      info.sunEnergyPhotoOverLive = +ratio.toFixed(3);
      if (ratio > 0 && (ratio < 0.87 || ratio > 1.15)) {
        const f = 1 / ratio;
        discEach((i) => {
          for (let c = 0; c < 3; c++) if (data[i + c] > thrSky) data[i + c] = thrSky + (data[i + c] - thrSky) * f;
        });
        peak = thrSky + (peak - thrSky) * f;
        info.sunRescaled = +f.toFixed(3);
      }
    }
    if (Math.abs(elevTex - elevLive) > THREE.MathUtils.degToRad(3)) {
      // take the sun disc out (everything within 4° of the peak above a threshold) and relight with a directional sun
      kind = "hdr-relit";
      const cosR = Math.cos(THREE.MathUtils.degToRad(4));
      const E = [0, 0, 0];
      const thr = 40;
      const d = new THREE.Vector3();
      for (let y = 0; y < H; y++) {
        const vv = bg.flipY ? 1 - (y + 0.5) / H : (y + 0.5) / H;
        const ph = (1 - vv) * Math.PI;
        const dOmega = ((2 * Math.PI) / W) * (Math.PI / H) * Math.sin(ph);
        for (let x = 0; x < W; x++) {
          const th = ((x + 0.5) / W - 0.5) * 2 * Math.PI;
          d.set(Math.sin(ph) * Math.cos(th), Math.cos(ph), Math.sin(ph) * Math.sin(th));
          if (d.dot(sTex) < cosR) continue;
          const i = (y * W + x) * 4;
          for (let k = 0; k < 3; k++) {
            const ex = Math.max(0, data[i + k] - thr);
            E[k] += ex * dOmega * Math.max(0, d.dot(sTex));
            data[i + k] -= ex;
          }
        }
      }
      const m = Math.max(E[0], E[1], E[2], 1e-6);
      // the live sun where the engine reports it (scene units), else the energy taken out of the photograph
      sun = live ? new THREE.DirectionalLight(live.color.clone(), live.intensity) : new THREE.DirectionalLight(new THREE.Color(E[0] / m, E[1] / m, E[2] / m), m * k);
      sun.position.copy(liveDir).multiplyScalar(1000);
      sun.target.position.set(0, 0, 0);
      sunDir.copy(liveDir);
      peak = thr;
    }
    const scale = Math.max(1, peak / 60000);
    if (scale > 1) for (let i = 0; i < data.length; i++) if ((i & 3) !== 3) data[i] /= scale;
    const tex = new THREE.DataTexture(data, W, H, THREE.RGBAFormat, THREE.FloatType);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    tex.flipY = bg.flipY;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    tex.colorSpace = THREE.LinearSRGBColorSpace;
    tex.needsUpdate = true;
    info.kind = kind;
    return {
      kind, texture: tex, intensity: scale * k, backgroundIntensity: scale * k, rotationY, sun, sunDir, info,
      dispose: () => tex.dispose(),
    };
  }

  // analytic sky
  let liveSky: Sky | null = null;
  scene.traverse((o) => {
    const m = (o as THREE.Mesh).material as THREE.ShaderMaterial | undefined;
    if (!liveSky && m && m.uniforms && m.uniforms.sunPosition && m.uniforms.turbidity && (o as THREE.Mesh).visible) liveSky = o as Sky;
  });
  const sun = live ? new THREE.DirectionalLight(live.color.clone(), live.intensity) : sunL ? new THREE.DirectionalLight(sunL.color.clone(), sunL.intensity) : null;
  if (sun) {
    sun.position.copy(liveDir).multiplyScalar(1000);
    sun.target.position.set(0, 0, 0);
  }
  if (liveSky) {
    const sky = new Sky();
    sky.scale.setScalar(1000);
    const src = ((liveSky as Sky).material as THREE.ShaderMaterial).uniforms;
    for (const k of Object.keys(sky.material.uniforms)) {
      const v = src[k]?.value;
      if (v == null) continue;
      const dst = sky.material.uniforms[k];
      if (typeof v === "object" && "copy" in v) (dst.value as { copy: (x: unknown) => void }).copy(v);
      else dst.value = v;
    }
    const cubeRT = new THREE.WebGLCubeRenderTarget(512, { type: THREE.HalfFloatType, generateMipmaps: false });
    const cc = new THREE.CubeCamera(1, 5000, cubeRT);
    const tmp = new THREE.Scene();
    tmp.add(sky, cc);
    const prevTM = renderer.toneMapping;
    renderer.toneMapping = THREE.NoToneMapping;
    cc.update(renderer, tmp);
    renderer.toneMapping = prevTM;
    sky.geometry.dispose();
    sky.material.dispose();
    return {
      kind: "analytic", texture: cubeRT.texture, intensity: scene.environmentIntensity ?? 1, backgroundIntensity: 1, rotationY: 0, sun, sunDir: liveDir.clone(), info: { kind: "analytic" },
      dispose: () => cubeRT.dispose(),
    };
  }
  // no sky at all: an even grey-blue dome from the fog colour
  const fog = (scene.fog as THREE.FogExp2 | null)?.color ?? new THREE.Color(0.66, 0.73, 0.8);
  const data = new Float32Array(4 * 8 * 4);
  for (let i = 0; i < 32; i++) {
    data[i * 4] = fog.r; data[i * 4 + 1] = fog.g; data[i * 4 + 2] = fog.b; data[i * 4 + 3] = 1;
  }
  const tex = new THREE.DataTexture(data, 8, 4, THREE.RGBAFormat, THREE.FloatType);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.needsUpdate = true;
  return { kind: "flat", texture: tex, intensity: 1, backgroundIntensity: 1, rotationY: 0, sun, sunDir: liveDir.clone(), info: { kind: "flat" }, dispose: () => tex.dispose() };
}
