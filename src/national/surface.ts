import * as THREE from "three";
import type { NationalTerrain } from "./types";

/**
 * The derived relief products (scripts/national/build-surface.py) and the generic noise used for texture.
 * Each image is data, not a picture: decoded with no colour management and uploaded as raw bytes.
 * A product that cannot be loaded is replaced by a neutral 1 x 1 stand-in, so the map still draws (flatter).
 */

export interface SurfaceTextures {
  relief: THREE.Texture;
  surface: THREE.Texture;
  water: THREE.Texture;
  noise: THREE.DataTexture;
  /** Noise bytes (RGBA, NOISE_SIZE square) for CPU-side estimates that must agree with the shader. */
  noiseData: Uint8Array;
  missing: string[];
}

export const SURFACE_DEFAULTS = {
  relief: "/assets/national/relief.jpg",
  surface: "/assets/national/surface.png",
  water: "/assets/national/water.png",
};

async function loadData(url: string, fallback: [number, number, number, number], mip: boolean, aniso: number): Promise<{ tex: THREE.Texture; ok: boolean }> {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const bmp = await createImageBitmap(await res.blob(), { colorSpaceConversion: "none", premultiplyAlpha: "none", imageOrientation: "none" });
    const tex = new THREE.Texture(bmp as unknown as HTMLImageElement);
    tex.flipY = false;
    tex.colorSpace = THREE.NoColorSpace;
    tex.premultiplyAlpha = false;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = mip ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
    tex.generateMipmaps = mip;
    tex.anisotropy = aniso;
    tex.needsUpdate = true;
    return { tex, ok: true };
  } catch (e) {
    console.info(`national terrain: ${url} not usable (${(e as Error).message}); drawing without it`);
    const t = new THREE.DataTexture(new Uint8Array(fallback), 1, 1, THREE.RGBAFormat);
    t.needsUpdate = true;
    return { tex: t, ok: false };
  }
}

export const NOISE_SIZE = 256;
const NOISE_PERIOD = 8;

/** Four channels of tileable gradient noise (period NOISE_PERIOD cells across the tile), 0..1 around 0.5. */
export function makeNoise(): Uint8Array {
  const N = NOISE_SIZE, out = new Uint8Array(N * N * 4);
  for (let ch = 0; ch < 4; ch++) {
    let seed = 1013 + ch * 7919;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const gx = new Float32Array(NOISE_PERIOD * NOISE_PERIOD), gy = new Float32Array(NOISE_PERIOD * NOISE_PERIOD);
    for (let i = 0; i < gx.length; i++) {
      const a = rnd() * Math.PI * 2;
      gx[i] = Math.cos(a);
      gy[i] = Math.sin(a);
    }
    const g = (ix: number, iy: number, fx: number, fy: number) => {
      const k = ((iy % NOISE_PERIOD) + NOISE_PERIOD) % NOISE_PERIOD * NOISE_PERIOD + (((ix % NOISE_PERIOD) + NOISE_PERIOD) % NOISE_PERIOD);
      return gx[k] * fx + gy[k] * fy;
    };
    const q = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const px = (x / N) * NOISE_PERIOD, py = (y / N) * NOISE_PERIOD;
      const ix = Math.floor(px), iy = Math.floor(py), fx = px - ix, fy = py - iy;
      const u = q(fx), v = q(fy);
      const a = g(ix, iy, fx, fy), b = g(ix + 1, iy, fx - 1, fy), c = g(ix, iy + 1, fx, fy - 1), d = g(ix + 1, iy + 1, fx - 1, fy - 1);
      const n = (a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v;
      out[(y * N + x) * 4 + ch] = Math.max(0, Math.min(255, Math.round((0.5 + n * 0.85) * 255)));
    }
  }
  return out;
}

/** Bilinear, wrapping lookup of one noise channel at texture coordinate (u, v), as the shader's texture2D does at mip 0. */
export function noiseAt(data: Uint8Array, u: number, v: number, ch = 0): number {
  const N = NOISE_SIZE;
  const x = u * N - 0.5, y = v * N - 0.5;
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
  const at = (i: number, j: number) => data[((((j % N) + N) % N) * N + (((i % N) + N) % N)) * 4 + ch] / 255;
  return (at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx) * (1 - fy) + (at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx) * fy;
}

export async function loadSurface(terrain: NationalTerrain, aniso: number): Promise<SurfaceTextures> {
  const s = { ...SURFACE_DEFAULTS, ...(terrain.surface ?? {}) };
  const [relief, surface, water] = await Promise.all([
    loadData(s.relief, [128, 128, 128, 255], true, aniso),
    loadData(s.surface, [230, 0, 255, 0], true, 1),
    loadData(s.water, [255, 0, 0, 255], true, 4),
  ]);
  const noiseData = makeNoise();
  const noise = new THREE.DataTexture(noiseData, NOISE_SIZE, NOISE_SIZE, THREE.RGBAFormat);
  noise.wrapS = noise.wrapT = THREE.RepeatWrapping;
  noise.magFilter = THREE.LinearFilter;
  noise.minFilter = THREE.LinearMipmapLinearFilter;
  noise.generateMipmaps = true;
  noise.colorSpace = THREE.NoColorSpace;
  noise.anisotropy = 8;
  noise.needsUpdate = true;
  const missing = [relief.ok ? "" : "relief", surface.ok ? "" : "surface", water.ok ? "" : "water"].filter(Boolean);
  return { relief: relief.tex, surface: surface.tex, water: water.tex, noise, noiseData, missing };
}
