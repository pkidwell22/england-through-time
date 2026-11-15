import type { NationalTerrain } from "./types";

/** Elevation grid in metres. Row 0 = latMax, column 0 = lonMin (equirectangular). */
export interface HeightGrid {
  width: number;
  height: number;
  data: Float32Array;
  /**
   * "Flood level" per cell (m): the lowest sea level at which the cell is joined to the open sea
   * through cells that are themselves under water. A cell is sea in a given year when this is
   * below that year's sea level. Low ground cut off from the sea (drained fen, now below 0 m)
   * therefore stays land.
   */
  flood: Float32Array;
  bounds: { latMin: number; latMax: number; lonMin: number; lonMax: number };
  /** True when the real height image could not be loaded and a rough generated stand-in is shown. */
  procedural: boolean;
  min: number;
  max: number;
}

/** Bilinear elevation (m) at a latitude/longitude; clamped at the edges. */
export function sampleHeight(g: HeightGrid, lat: number, lon: number): number {
  const b = g.bounds;
  const fx = Math.min(g.width - 1, Math.max(0, ((lon - b.lonMin) / (b.lonMax - b.lonMin)) * g.width - 0.5));
  const fy = Math.min(g.height - 1, Math.max(0, ((b.latMax - lat) / (b.latMax - b.latMin)) * g.height - 0.5));
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const x1 = Math.min(g.width - 1, x0 + 1), y1 = Math.min(g.height - 1, y0 + 1);
  const u = fx - x0, v = fy - y0, d = g.data, w = g.width;
  return (d[y0 * w + x0] * (1 - u) + d[y0 * w + x1] * u) * (1 - v) + (d[y1 * w + x0] * (1 - u) + d[y1 * w + x1] * u) * v;
}

/**
 * Load the height image described by terrain.json. If it is missing or cannot be
 * decoded, a generated stand-in is returned instead (flagged `procedural`), so the
 * viewer keeps working; the real file is used automatically once it exists.
 */
export async function loadHeights(terrain: NationalTerrain): Promise<HeightGrid> {
  try {
    if (terrain.encoding !== "rg16") throw new Error(`unsupported encoding ${terrain.encoding}`);
    const res = await fetch(terrain.image, { cache: "no-cache" });
    const type = res.headers.get("content-type") ?? "";
    if (!res.ok || !type.startsWith("image/")) throw new Error(`HTTP ${res.status} (${type || "no type"})`);
    const blob = await res.blob();
    // No colour management and no alpha premultiplication: the bytes are data, not a picture.
    const bmp = await createImageBitmap(blob, { colorSpaceConversion: "none", premultiplyAlpha: "none" });
    const w = bmp.width, h = bmp.height;
    const cv = document.createElement("canvas");
    cv.width = w;
    cv.height = h;
    const ctx = cv.getContext("2d", { willReadFrequently: true, colorSpace: "srgb" })!;
    ctx.drawImage(bmp, 0, 0);
    bmp.close();
    const px = ctx.getImageData(0, 0, w, h).data;
    const data = new Float32Array(w * h);
    let min = Infinity, max = -Infinity;
    for (let i = 0; i < w * h; i++) {
      const v = (px[i * 4] * 256 + px[i * 4 + 1]) * terrain.scale + terrain.offset;
      data[i] = v;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    if (!(max > min)) throw new Error("height image is blank");
    if (w !== terrain.width || h !== terrain.height) console.warn(`national terrain: image is ${w}×${h}, terrain.json says ${terrain.width}×${terrain.height}; using the image size`);
    return { width: w, height: h, data, flood: floodLevels(data, w, h), bounds: terrain.bounds, procedural: false, min, max };
  } catch (e) {
    console.info(`national terrain: ${terrain.image} not usable (${(e as Error).message}); showing a generated stand-in`);
    return proceduralHeights(terrain.bounds);
  }
}

/** Highest sea level the flood fill considers (m). Ground at or above this is never sea. */
const FLOOD_TOP = 1;
const FLOOD_BOTTOM = -7;
const FLOOD_STEP = 0.1;

/**
 * Priority flood from the map edge (bucket queue, linear time). Returns, per cell, the lowest
 * sea level that would drown it by a connected route from the edge; land that can never be
 * reached below FLOOD_TOP gets max(elevation, FLOOD_TOP).
 */
export function floodLevels(h: Float32Array, w: number, ht: number): Float32Array {
  const n = w * ht;
  const out = new Float32Array(n).fill(NaN);
  const nb = Math.ceil((FLOOD_TOP - FLOOD_BOTTOM) / FLOOD_STEP) + 1;
  const head = new Int32Array(nb).fill(-1);
  const next = new Int32Array(n);
  const push = (i: number, level: number) => {
    out[i] = level;
    const b = Math.max(0, Math.min(nb - 1, Math.floor((level - FLOOD_BOTTOM) / FLOOD_STEP)));
    next[i] = head[b];
    head[b] = i;
  };
  const seed = (i: number) => {
    if (h[i] < FLOOD_TOP && Number.isNaN(out[i])) push(i, h[i]);
  };
  for (let x = 0; x < w; x++) {
    seed(x);
    seed((ht - 1) * w + x);
  }
  for (let y = 0; y < ht; y++) {
    seed(y * w);
    seed(y * w + w - 1);
  }
  for (let b = 0; b < nb; b++) {
    while (head[b] >= 0) {
      const i = head[b];
      head[b] = next[i];
      const lv = out[i];
      const x = i % w, y = (i - x) / w;
      for (let k = 0; k < 4; k++) {
        const nx = k === 0 ? x - 1 : k === 1 ? x + 1 : x, ny = k === 2 ? y - 1 : k === 3 ? y + 1 : y;
        if (nx < 0 || ny < 0 || nx >= w || ny >= ht) continue;
        const j = ny * w + nx;
        if (!Number.isNaN(out[j]) || !(h[j] < FLOOD_TOP)) continue;
        push(j, Math.max(h[j], lv)); // never lower than the current bucket, so the order stays valid
      }
    }
  }
  for (let i = 0; i < n; i++) if (Number.isNaN(out[i])) out[i] = Math.max(h[i], FLOOD_TOP);
  return out;
}

/** Bilinear flood level (m) at a latitude/longitude: below the year's sea level means open water. */
export function sampleFlood(g: HeightGrid, lat: number, lon: number): number {
  return sampleHeight({ ...g, data: g.flood }, lat, lon);
}

// ---------------------------------------------------------------------------
// Stand-in terrain. A very coarse hand-typed outline of southern Britain and a
// few upland blobs: enough to develop against, and plainly not a survey.
// ---------------------------------------------------------------------------

const OUTLINE: [number, number][] = [
  [56.0, -2.5], [55.77, -2.0], [55.6, -1.63], [55.0, -1.42], [54.69, -1.18], [54.49, -0.61], [54.28, -0.39], [54.12, -0.08], [53.75, -0.05],
  [53.58, 0.14], [53.45, 0.2], [53.14, 0.35], [52.95, 0.08], [52.8, 0.25], [52.95, 0.5], [52.97, 0.95], [52.94, 1.3], [52.7, 1.7], [52.48, 1.76],
  [52.1, 1.58], [51.95, 1.3], [51.78, 1.15], [51.73, 0.95], [51.55, 0.8], [51.47, 0.45], [51.45, 0.75], [51.38, 1.44], [51.13, 1.37], [50.91, 0.97],
  [50.85, 0.58], [50.73, 0.25], [50.82, -0.14], [50.78, -0.6], [50.72, -0.79], [50.8, -1.1], [50.7, -1.55], [50.6, -1.95], [50.61, -2.45], [50.52, -2.45],
  [50.72, -2.95], [50.6, -3.45], [50.4, -3.5], [50.22, -3.65], [50.35, -4.15], [50.33, -4.75], [50.15, -5.05], [49.96, -5.2], [50.1, -5.55], [50.07, -5.7],
  [50.22, -5.48], [50.42, -5.08], [50.55, -4.95], [50.8, -4.55], [51.02, -4.52], [51.08, -4.2], [51.2, -4.12], [51.22, -3.5], [51.2, -3.05], [51.35, -2.98],
  [51.55, -2.68], [51.7, -2.5], [51.55, -2.95], [51.45, -3.17], [51.4, -3.5], [51.48, -3.75], [51.6, -3.9], [51.55, -4.25], [51.68, -4.3], [51.72, -4.7],
  [51.63, -4.95], [51.68, -5.2], [51.88, -5.3], [52.02, -4.98], [52.13, -4.68], [52.25, -4.25], [52.42, -4.08], [52.72, -4.06], [52.9, -4.12], [52.82, -4.5],
  [52.8, -4.75], [53.0, -4.4], [53.12, -4.33], [53.2, -4.6], [53.3, -4.65], [53.42, -4.45], [53.32, -4.05], [53.33, -3.83], [53.3, -3.5], [53.35, -3.2],
  [53.25, -3.05], [53.45, -3.05], [53.65, -3.0], [53.75, -2.95], [53.92, -3.02], [54.05, -2.85], [54.2, -2.8], [54.1, -3.2], [54.4, -3.48], [54.5, -3.62],
  [54.85, -3.4], [54.95, -3.1], [54.88, -3.6], [54.78, -4.0], [54.68, -4.4], [54.63, -4.85], [54.85, -5.1], [55.0, -5.15], [55.3, -4.85], [55.6, -4.7],
  [56.0, -4.8],
];
/** lat, lon, radius km, height m */
const UPLANDS: [number, number, number, number][] = [
  [53.07, -4.0, 25, 900], [52.4, -3.7, 45, 520], [51.88, -3.4, 25, 720], [54.5, -3.1, 24, 850], [54.7, -2.3, 35, 680], [54.2, -2.2, 35, 600],
  [53.4, -1.8, 25, 520], [54.4, -0.9, 20, 380], [55.45, -2.2, 25, 700], [55.4, -3.5, 50, 620], [50.6, -3.95, 15, 520], [51.15, -3.65, 15, 430],
  [51.85, -2.0, 30, 230], [51.75, -0.8, 25, 200], [51.25, 0.2, 30, 160], [50.92, -0.5, 25, 180],
];

function hash(x: number, y: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function noise(x: number, y: number): number {
  const xi = Math.floor(x), yi = Math.floor(y);
  const u = x - xi, v = y - yi;
  const su = u * u * (3 - 2 * u), sv = v * v * (3 - 2 * v);
  return (hash(xi, yi) * (1 - su) + hash(xi + 1, yi) * su) * (1 - sv) + (hash(xi, yi + 1) * (1 - su) + hash(xi + 1, yi + 1) * su) * sv;
}
function fbm(x: number, y: number): number {
  let a = 0.5, s = 0;
  for (let i = 0; i < 5; i++) {
    s += a * noise(x, y);
    x = x * 2.03 + 11.3;
    y = y * 2.03 + 7.1;
    a *= 0.5;
  }
  return s;
}

export function proceduralHeights(bounds: HeightGrid["bounds"], width = 420): HeightGrid {
  const latMid = (bounds.latMin + bounds.latMax) / 2;
  const kx = 111.195 * Math.cos((latMid * Math.PI) / 180), kz = 111.195;
  const height = Math.max(8, Math.round((width * (bounds.latMax - bounds.latMin) * kz) / ((bounds.lonMax - bounds.lonMin) * kx)));
  const data = new Float32Array(width * height);
  const poly = OUTLINE.map(([la, lo]) => [lo * kx, -la * kz] as [number, number]);
  let min = Infinity, max = -Infinity;
  for (let j = 0; j < height; j++) {
    const lat = bounds.latMax - ((j + 0.5) / height) * (bounds.latMax - bounds.latMin);
    for (let i = 0; i < width; i++) {
      const lon = bounds.lonMin + ((i + 0.5) / width) * (bounds.lonMax - bounds.lonMin);
      const x = lon * kx, z = -lat * kz;
      let inside = false, d2 = Infinity;
      for (let a = 0, b = poly.length - 1; a < poly.length; b = a++) {
        const [x0, z0] = poly[a], [x1, z1] = poly[b];
        if (z0 > z !== z1 > z && x < ((x1 - x0) * (z - z0)) / (z1 - z0) + x0) inside = !inside;
        const ex = x1 - x0, ez = z1 - z0;
        const tt = Math.max(0, Math.min(1, ((x - x0) * ex + (z - z0) * ez) / (ex * ex + ez * ez || 1)));
        const dx = x - (x0 + ex * tt), dz = z - (z0 + ez * tt);
        d2 = Math.min(d2, dx * dx + dz * dz);
      }
      // wobble the typed outline a little so the coast is not made of straight segments
      const dist = Math.sqrt(d2) * (inside ? 1 : -1) + (fbm(x / 14, z / 14) - 0.5) * 9;
      let h: number;
      if (dist > 0) {
        h = Math.min(70, dist * 5) * (0.5 + fbm(x / 40, z / 40)) + 2;
        for (const [la, lo, r, top] of UPLANDS) {
          const ux = (lon - lo) * kx, uz = (lat - la) * kz;
          const q = (ux * ux + uz * uz) / (r * r);
          if (q < 6) h += top * Math.exp(-q * 1.3) * (0.55 + 0.9 * fbm(x / 9, z / 9)) * Math.min(1, dist / 6);
        }
      } else h = -Math.min(110, 1.5 - dist * 2.2);
      data[j * width + i] = h;
      if (h < min) min = h;
      if (h > max) max = h;
    }
  }
  return { width, height, data, flood: floodLevels(data, width, height), bounds, procedural: true, min, max };
}
