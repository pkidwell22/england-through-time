/**
 * Local projection: metres east (x) and south (z) of the site origin.
 * Equirectangular approximation, accurate to well under a metre over the few
 * kilometres modelled here. Three.js convention: +x east, +y up, +z south.
 */
export interface Projector {
  toLocal(lat: number, lon: number): [number, number];
  toLatLon(x: number, z: number): [number, number];
}

const M_PER_DEG_LAT = 111_250;

export function makeProjector(originLat: number, originLon: number): Projector {
  const mPerDegLon = 111_320 * Math.cos((originLat * Math.PI) / 180);
  return {
    toLocal(lat, lon) {
      return [(lon - originLon) * mPerDegLon, -(lat - originLat) * M_PER_DEG_LAT];
    },
    toLatLon(x, z) {
      return [originLat - z / M_PER_DEG_LAT, originLon + x / mPerDegLon];
    },
  };
}

/** Deterministic PRNG (mulberry32) so procedural placement is identical on every load. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function hash2(x: number, z: number): number {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(z | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smooth value noise, 0..1. */
export function noise2(x: number, z: number): number {
  const xi = Math.floor(x);
  const zi = Math.floor(z);
  const xf = x - xi;
  const zf = z - zi;
  const u = xf * xf * (3 - 2 * xf);
  const v = zf * zf * (3 - 2 * zf);
  const a = hash2(xi, zi);
  const b = hash2(xi + 1, zi);
  const c = hash2(xi, zi + 1);
  const d = hash2(xi + 1, zi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

export function fbm(x: number, z: number, octaves = 4): number {
  let amp = 0.5;
  let f = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise2(x * f, z * f);
    norm += amp;
    amp *= 0.5;
    f *= 2.03;
  }
  return sum / norm;
}

export function smoothstep(a: number, b: number, v: number): number {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** Distance from point to segment, plus position along it (0..1) and which side (+1 = left of a->b). */
export function pointSegment(
  px: number,
  pz: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): { d: number; f: number; side: number } {
  const dx = bx - ax;
  const dz = bz - az;
  const len2 = dx * dx + dz * dz || 1e-9;
  let f = ((px - ax) * dx + (pz - az) * dz) / len2;
  f = f < 0 ? 0 : f > 1 ? 1 : f;
  const cx = ax + dx * f;
  const cz = az + dz * f;
  const ex = px - cx;
  const ez = pz - cz;
  // In x-east / z-south coordinates, "left of the direction of travel" has cross > 0.
  const cross = dx * (pz - az) - dz * (px - ax);
  return { d: Math.hypot(ex, ez), f, side: cross < 0 ? 1 : -1 };
}

export function pointInPolygon(x: number, z: number, poly: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i];
    const [xj, zj] = poly[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
