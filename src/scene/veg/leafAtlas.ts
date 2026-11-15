import * as THREE from "three";

/**
 * One generated texture atlas (1024x1024, no external assets):
 *   top-left   (u 0-.5,  v 0-.5)  leaf cluster A: broad leaves (oak, lime, hazel, thorn)
 *   top-right  (u .5-1,  v 0-.5)  leaf cluster B: narrow leaves (willow, alder)
 *   bottom     (v .55-.95)         bark
 * Greys with a slight warm green so the per-vertex species tint carries the colour. Transparent texels keep a
 * leaf colour (DataTexture, not canvas) so mip-mapping leaves no dark fringe.
 */
let cached: THREE.DataTexture | null = null;

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function paintCluster(ctx: CanvasRenderingContext2D, ox: number, oy: number, narrow: boolean, seed: number) {
  const r = rng(seed);
  const S = 512, cx = ox + S / 2, cy = oy + S / 2;
  const gauss = () => (r() + r() + r() - 1.5) / 1.5;
  const leaf = (x: number, y: number, len: number, wid: number, ang: number, l: number) => {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(ang);
    ctx.beginPath();
    ctx.moveTo(-len / 2, 0);
    ctx.quadraticCurveTo(-len * 0.1, -wid, len / 2, 0);
    ctx.quadraticCurveTo(-len * 0.1, wid, -len / 2, 0);
    ctx.closePath();
    ctx.fillStyle = `hsl(${88 + r() * 22}, ${14 + r() * 14}%, ${l}%)`;
    ctx.fill();
    ctx.strokeStyle = "rgba(20,28,10,0.35)";
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-len / 2, 0);
    ctx.lineTo(len / 2, 0);
    ctx.strokeStyle = `hsla(70,20%,${l + 18}%,0.55)`;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
  };
  const passes: [number, number, number, number][] = narrow
    ? [[90, 38, 7, 0.40], [260, 54, 8, 0.62], [200, 52, 7, 0.84]]
    : [[70, 56, 16, 0.38], [150, 62, 17, 0.6], [130, 58, 15, 0.84]];
  const spread = narrow ? [0.15, 0.4] : [0.34, 0.34];
  for (const [n, len, wid, lAvg] of passes)
    for (let i = 0; i < n; i++) {
      const gx = gauss(), gy = gauss();
      const x = cx + gx * S * spread[0], y = cy + gy * S * spread[1] * (narrow ? 1.05 : 1);
      // blob: pull in anything outside the disc so the cut-out edge stays inside the cell
      const d = Math.hypot(x - cx, y - cy) / (S * 0.44);
      const k = d > 1 ? 1 / d : 1;
      const ang = narrow ? Math.PI / 2 + (r() - 0.5) * 0.9 : r() * Math.PI * 2;
      leaf(cx + (x - cx) * k, cy + (y - cy) * k, len * (0.8 + r() * 0.4), wid * (0.8 + r() * 0.4), ang, Math.max(20, Math.min(97, lAvg * 100 + (r() - 0.5) * 24)));
    }
}

export function leafAtlas(): THREE.DataTexture {
  if (cached) return cached;
  const S = 1024;
  const cv = document.createElement("canvas");
  cv.width = cv.height = S;
  const ctx = cv.getContext("2d", { willReadFrequently: true })!;
  ctx.clearRect(0, 0, S, S);
  paintCluster(ctx, 0, 0, false, 11);
  paintCluster(ctx, 512, 0, true, 23);
  // bark: vertical fissured streaks
  const br = rng(5);
  const bx0 = 40, bx1 = S - 40, by0 = 563, by1 = 972;
  ctx.fillStyle = "#8a8378";
  ctx.fillRect(bx0, by0, bx1 - bx0, by1 - by0);
  for (let i = 0; i < 420; i++) {
    const x = bx0 + br() * (bx1 - bx0), w = 2 + br() * 10;
    const y = by0 + br() * (by1 - by0 - 40), len = 40 + br() * 220;
    const l = 30 + br() * 60;
    ctx.fillStyle = `hsla(30,${6 + br() * 10}%,${l}%,${0.35 + br() * 0.4})`;
    ctx.fillRect(x, y, w, Math.min(len, by1 - y));
  }
  const img = ctx.getImageData(0, 0, S, S);
  const d = img.data;
  // un-premultiplied fill for transparent texels: leaf grey-green
  for (let i = 0; i < d.length; i += 4) {
    const px = (i >> 2) % S, py = Math.floor(i / 4 / S);
    const bark = py >= 563 && py <= 972 && px >= 40 && px <= S - 40;
    if (bark) {
      d[i + 3] = 255;
    } else if (d[i + 3] < 24) {
      d[i] = 150; d[i + 1] = 165; d[i + 2] = 120; d[i + 3] = 0;
    } else if (d[i + 3] < 250) {
      // canvas edges are anti-aliased: harden to keep a crisp alpha test edge
      d[i + 3] = Math.min(255, d[i + 3] * 1.5);
    }
  }
  const tex = new THREE.DataTexture(new Uint8Array(d.buffer.slice(0)), S, S, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  cached = tex;
  return tex;
}
