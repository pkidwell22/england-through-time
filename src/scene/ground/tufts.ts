import * as THREE from "three";
import { rng } from "@/lib/geo";

/** Grey-scale alpha-tested blade clusters; the colour comes from the layer's tint. Light tips, dark bases. */
export function makeTuftTexture(kind: "grass" | "reed"): THREE.CanvasTexture {
  const W = kind === "grass" ? 256 : 128;
  const H = kind === "grass" ? 256 : 512;
  const cv = document.createElement("canvas");
  cv.width = W;
  cv.height = H;
  const g = cv.getContext("2d")!;
  g.clearRect(0, 0, W, H);
  const r = rng(kind === "grass" ? 1234 : 4321);
  const blade = (x0: number, w: number, h: number, lean: number, tone: number) => {
    const grad = g.createLinearGradient(0, H, 0, H - h);
    const lo = Math.round(120 + tone * 40), hi = Math.min(255, Math.round(215 + tone * 40));
    grad.addColorStop(0, `rgb(${lo},${lo},${lo})`);
    grad.addColorStop(1, `rgb(${hi},${hi},${hi})`);
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(x0 - w / 2, H);
    const mx = x0 + lean * 0.35, tx = x0 + lean;
    g.quadraticCurveTo(mx - w * 0.45, H - h * 0.55, tx, H - h);
    g.quadraticCurveTo(mx + w * 0.45, H - h * 0.55, x0 + w / 2, H);
    g.closePath();
    g.fill();
  };
  if (kind === "grass") {
    const n = 34;
    for (let i = 0; i < n; i++) {
      const x = W * (0.5 + (r() - 0.5) * 0.7);
      const h = H * (0.45 + r() * 0.52);
      blade(x, 7 + r() * 8, h, (r() - 0.5) * W * 0.5 * (0.4 + h / H), r());
    }
  } else {
    // reeds and sedge: many slim tapering leaves and a few narrow seed-heads
    const n = 16;
    for (let i = 0; i < n; i++) {
      const x = W * (0.5 + (r() - 0.5) * 0.5);
      const h = H * (0.55 + r() * 0.43);
      const lean = (r() - 0.5) * W * 0.34;
      blade(x, 3 + r() * 3, h, lean, r());
      if (r() < 0.3) {
        const tx = x + lean, ty = H - h;
        g.fillStyle = "rgb(150,140,125)";
        g.beginPath();
        g.ellipse(tx, ty + 22, 2.2 + r() * 1.5, 16 + r() * 8, 0, 0, Math.PI * 2);
        g.fill();
      }
    }
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.anisotropy = 4;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

/** Two crossed (or three, if `quads` is 3), two-segment vertical quads: x in -0.5..0.5, y in 0..1. */
export function tuftGeometry(quads: number): { pos: Float32Array; uv: Float32Array; idx: Uint16Array } {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (let q = 0; q < quads; q++) {
    const a = (q / quads) * Math.PI;
    const dx = Math.cos(a) * 0.5, dz = Math.sin(a) * 0.5;
    const base = pos.length / 3;
    for (let s = 0; s <= 2; s++) {
      const y = s / 2;
      pos.push(-dx, y, -dz, dx, y, dz);
      uv.push(0, y, 1, y);
    }
    for (let s = 0; s < 2; s++) {
      const a0 = base + s * 2;
      idx.push(a0, a0 + 1, a0 + 2, a0 + 1, a0 + 3, a0 + 2);
    }
  }
  return { pos: new Float32Array(pos), uv: new Float32Array(uv), idx: new Uint16Array(idx) };
}

/** A rounded, flattened pebble (low-poly), radius ~0.5. */
export function pebbleGeometry(seed: number): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(0.5, 0);
  const r = rng(seed);
  const p = g.attributes.position as THREE.BufferAttribute;
  const key = new Map<string, number>();
  for (let i = 0; i < p.count; i++) {
    const k = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
    let m = key.get(k);
    if (m === undefined) {
      m = 0.78 + r() * 0.4;
      key.set(k, m);
    }
    p.setXYZ(i, p.getX(i) * m, Math.max(p.getY(i), -0.12) * m, p.getZ(i) * m);
  }
  g.computeVertexNormals();
  return g;
}

/** A plank or log: 1 m long on z, ~0.1 m across. */
export function plankGeometry(): THREE.BufferGeometry {
  return new THREE.BoxGeometry(0.14, 0.09, 1, 1, 1, 1).translate(0, 0.045, 0);
}
