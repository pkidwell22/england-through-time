/**
 * A regular height grid in a site's local metres (x east, z south), decoded from a 16-bit-in-RG PNG:
 *   value = (R * 256 + G) * scale + offset
 * and an optional trust mask in the blue channel (B / 255, 0..1).
 *
 * The grid is node-registered: pixel (i, j) sits exactly at
 *   x = xMin + i * (xMax - xMin) / (width - 1),  z = zMin + j * (zMax - zMin) / (height - 1)
 * so row 0 is the north edge (zMin) and column 0 the west edge (xMin).
 *
 * Pure: nothing here knows about sites, rivers or years. Built by scripts/lidar/build.py.
 */

export interface GridBounds {
  xMin: number;
  xMax: number;
  zMin: number;
  zMax: number;
}

export class Heightmap {
  readonly dx: number;
  readonly dz: number;

  constructor(
    readonly width: number,
    readonly height: number,
    readonly bounds: GridBounds,
    readonly data: Float32Array,
    /** 0..1 per node; null = trusted everywhere. */
    readonly mask: Float32Array | null = null,
  ) {
    if (!(width >= 2 && height >= 2)) throw new Error(`heightmap must be at least 2 x 2 (got ${width} x ${height})`);
    if (data.length !== width * height) throw new Error(`heightmap data has ${data.length} values, expected ${width * height}`);
    if (mask && mask.length !== width * height) throw new Error("heightmap mask size does not match the grid");
    if (!(bounds.xMax > bounds.xMin && bounds.zMax > bounds.zMin)) throw new Error("heightmap bounds are empty or inverted");
    this.dx = (bounds.xMax - bounds.xMin) / (width - 1);
    this.dz = (bounds.zMax - bounds.zMin) / (height - 1);
  }

  /** Decode RGBA (or RGB with channels = 3) bytes. `useMask`: read the blue channel as the trust mask. */
  static fromRGBA(px: ArrayLike<number>, width: number, height: number, bounds: GridBounds, scale: number, offset: number, useMask = false, channels = 4): Heightmap {
    const n = width * height;
    if (px.length < n * channels) throw new Error(`heightmap image has ${px.length} bytes, expected ${n * channels}`);
    const data = new Float32Array(n);
    const mask = useMask ? new Float32Array(n) : null;
    for (let i = 0; i < n; i++) {
      const o = i * channels;
      data[i] = (px[o] * 256 + px[o + 1]) * scale + offset;
      if (mask) mask[i] = px[o + 2] / 255;
    }
    return new Heightmap(width, height, bounds, data, mask);
  }

  contains(x: number, z: number): boolean {
    const b = this.bounds;
    return x >= b.xMin && x <= b.xMax && z >= b.zMin && z <= b.zMax;
  }

  private bilinear(arr: Float32Array, x: number, z: number): number {
    const b = this.bounds;
    const fx = Math.min(this.width - 1, Math.max(0, (x - b.xMin) / this.dx));
    const fz = Math.min(this.height - 1, Math.max(0, (z - b.zMin) / this.dz));
    const i0 = Math.min(this.width - 2, Math.floor(fx));
    const j0 = Math.min(this.height - 2, Math.floor(fz));
    const u = fx - i0, v = fz - j0, w = this.width;
    const k = j0 * w + i0;
    return (arr[k] * (1 - u) + arr[k + 1] * u) * (1 - v) + (arr[k + w] * (1 - u) + arr[k + w + 1] * u) * v;
  }

  /** Bilinear value at (x, z); NaN outside the grid. */
  sample(x: number, z: number): number {
    return this.contains(x, z) ? this.bilinear(this.data, x, z) : NaN;
  }

  /** Bilinear value at the nearest point of the grid (edge values continue outwards). */
  sampleClamped(x: number, z: number): number {
    return this.bilinear(this.data, x, z);
  }

  /** Bilinear mask value (0..1) at (x, z); 0 outside the grid, 1 everywhere inside when there is no mask. */
  sampleMask(x: number, z: number): number {
    if (!this.contains(x, z)) return 0;
    return this.mask ? this.bilinear(this.mask, x, z) : 1;
  }

  /** Mask value continued outwards from the nearest edge (1 when there is no mask). */
  sampleMaskClamped(x: number, z: number): number {
    return this.mask ? this.bilinear(this.mask, x, z) : 1;
  }

  /** Distance (m) from (x, z) to the grid rectangle; 0 inside. */
  distanceOutside(x: number, z: number): number {
    const b = this.bounds;
    const dx = Math.max(b.xMin - x, 0, x - b.xMax), dz = Math.max(b.zMin - z, 0, z - b.zMax);
    return Math.hypot(dx, dz);
  }

  /** 0 at the grid's outer edge rising smoothly to 1 at `blend` metres inside it (1 everywhere if blend <= 0). */
  edgeWeight(x: number, z: number, blend: number): number {
    if (!this.contains(x, z)) return 0;
    if (!(blend > 0)) return 1;
    const b = this.bounds;
    const d = Math.min(x - b.xMin, b.xMax - x, z - b.zMin, b.zMax - z);
    const t = Math.min(1, Math.max(0, d / blend));
    return t * t * (3 - 2 * t);
  }
}

/** Encode values to RGBA bytes (R, G = 16-bit value; B = mask * 255, or 255; A = 255). The inverse of fromRGBA. */
export function encodeRGBA(values: ArrayLike<number>, scale: number, offset: number, mask?: ArrayLike<number>): Uint8ClampedArray {
  const out = new Uint8ClampedArray(values.length * 4);
  for (let i = 0; i < values.length; i++) {
    const v = Math.min(65535, Math.max(0, Math.round((values[i] - offset) / scale)));
    out[i * 4] = v >> 8;
    out[i * 4 + 1] = v & 255;
    out[i * 4 + 2] = mask ? Math.round(Math.min(1, Math.max(0, mask[i])) * 255) : 255;
    out[i * 4 + 3] = 255;
  }
  return out;
}

/**
 * Browser only: fetch and decode a height PNG on the CPU via a canvas, with colour management and alpha
 * premultiplication switched off (the bytes are data, not a picture).
 */
export async function loadHeightmapImage(url: string, width: number, height: number, bounds: GridBounds, scale: number, offset: number, useMask: boolean): Promise<Heightmap> {
  const res = await fetch(url);
  const type = res.headers.get("content-type") ?? "";
  if (!res.ok || !type.startsWith("image/")) throw new Error(`${url}: HTTP ${res.status} (${type || "no type"})`);
  const bmp = await createImageBitmap(await res.blob(), { colorSpaceConversion: "none", premultiplyAlpha: "none" });
  try {
    if (bmp.width !== width || bmp.height !== height) throw new Error(`${url} is ${bmp.width} x ${bmp.height}, the sidecar says ${width} x ${height}`);
    const cv = document.createElement("canvas");
    cv.width = width;
    cv.height = height;
    const ctx = cv.getContext("2d", { willReadFrequently: true, colorSpace: "srgb" });
    if (!ctx) throw new Error("no 2D canvas");
    ctx.drawImage(bmp, 0, 0);
    return Heightmap.fromRGBA(ctx.getImageData(0, 0, width, height).data, width, height, bounds, scale, offset, useMask);
  } finally {
    bmp.close();
  }
}
