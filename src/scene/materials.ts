import * as THREE from "three";
import { rng } from "@/lib/geo";
import assetsJson from "@data/assets.json";
import { BAY_DESIGNS, bayMaps, setBayAnisotropy, type BayDesign } from "./street/frameTex";
import { specialMaterial, specialTile } from "./street/specialTex";

interface ScanDef { asset: string; tile: number; color?: string }
const ASSETS = assetsJson as unknown as {
  materials: Record<string, ScanDef>;
  composites: Record<string, { base: string; beams: string; tile: number }>;
  terrain: Record<string, string | number>;
  sky: { asset: string };
};
/** Set false to force the built-in procedural surfaces (e.g. if public/assets is absent). */
let useScans = true;
export function setUseScans(v: boolean) {
  useScans = v;
}
export const SKY_URL = `/assets/sky/${ASSETS.sky.asset}_2k.hdr`;
export const TERRAIN_ASSETS = ASSETS.terrain;
const loader = typeof window !== "undefined" ? new THREE.TextureLoader() : null;
const scanCache = new Map<string, THREE.Texture>();
export function scanTexture(asset: string, map: "diff" | "nor" | "rough"): THREE.Texture {
  const key = `${asset}/${map}`;
  let t = scanCache.get(key);
  if (!t) {
    t = loader!.load(`/assets/textures/${asset}/${map}.jpg`);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = maxAniso;
    if (map === "diff") t.colorSpace = THREE.SRGBColorSpace;
    scanCache.set(key, t);
  }
  return t;
}

/**
 * Procedural material library. Every surface is generated in code so the
 * prototype has no external assets; each entry can later be replaced by a
 * scanned/authored PBR set without touching the builders (they only use names).
 *
 * `tile` is the real-world size in metres that one texture repeat covers.
 * Builders emit UVs in metres, so textures keep a constant physical scale.
 */

export interface MatDef {
  tile: number;
  roughness: number;
  metalness?: number;
  bump?: number;
  color?: number;
  draw: (ctx: CanvasRenderingContext2D, s: number, r: () => number) => void;
}

function fill(ctx: CanvasRenderingContext2D, s: number, c: string) {
  ctx.fillStyle = c;
  ctx.fillRect(0, 0, s, s);
}

function speckle(ctx: CanvasRenderingContext2D, s: number, r: () => number, n: number, light: string, dark: string, size = 2) {
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = r() > 0.5 ? light : dark;
    ctx.globalAlpha = 0.05 + r() * 0.12;
    const d = 1 + r() * size;
    ctx.fillRect(r() * s, r() * s, d, d);
  }
  ctx.globalAlpha = 1;
}

function shade(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16);
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v * f)));
  return `rgb(${c((n >> 16) & 255)},${c((n >> 8) & 255)},${c(n & 255)})`;
}

/** Coursed blocks with varied tone. */
function courses(
  ctx: CanvasRenderingContext2D,
  s: number,
  r: () => number,
  rows: number,
  avgCols: number,
  base: string,
  joint: string,
  vary: number,
  irregular = 0,
) {
  fill(ctx, s, joint);
  const rh = s / rows;
  for (let j = 0; j < rows; j++) {
    let x = -r() * (s / avgCols);
    while (x < s) {
      const w = (s / avgCols) * (0.6 + r() * 0.8);
      ctx.fillStyle = shade(base, 1 - vary / 2 + r() * vary);
      const inset = 1 + r() * irregular;
      ctx.fillRect(x + inset, j * rh + inset, w - inset * 2, rh - inset * 2);
      x += w;
    }
  }
}

export const MATERIALS: Record<string, MatDef> = {
  ragstone: {
    tile: 4, roughness: 0.95, bump: 0.6,
    draw(ctx, s, r) {
      courses(ctx, s, r, 12, 7, "#9a9482", "#6f6a5c", 0.35, 2.5);
      speckle(ctx, s, r, 2500, "#c4bfae", "#4d4a40");
    },
  },
  "roman-rubble": {
    tile: 4, roughness: 0.95, bump: 0.6,
    draw(ctx, s, r) {
      courses(ctx, s, r, 16, 8, "#a39c88", "#6e685a", 0.3, 2);
      // red tile bonding courses
      for (const row of [3, 4, 11, 12]) {
        const y = (row * s) / 16;
        let x = 0;
        while (x < s) {
          const w = 18 + r() * 14;
          ctx.fillStyle = shade("#a4553a", 0.85 + r() * 0.3);
          ctx.fillRect(x + 1, y + 2, w - 2, s / 16 - 4);
          x += w;
        }
      }
      speckle(ctx, s, r, 2000, "#cfc8b5", "#4f4a40");
    },
  },
  caen: {
    tile: 5, roughness: 0.85, bump: 0.25,
    draw(ctx, s, r) {
      courses(ctx, s, r, 10, 6, "#d8cfb4", "#a89f86", 0.14, 0.4);
      speckle(ctx, s, r, 2500, "#f0e8d0", "#8f8770");
      // weather streaks
      for (let i = 0; i < 30; i++) {
        ctx.fillStyle = "rgba(70,65,50,0.06)";
        ctx.fillRect(r() * s, 0, 2 + r() * 6, s);
      }
    },
  },
  ashlar: {
    tile: 5, roughness: 0.75, bump: 0.15,
    draw(ctx, s, r) {
      courses(ctx, s, r, 8, 5, "#e2dccb", "#b8b19c", 0.08, 0.2);
      speckle(ctx, s, r, 1500, "#f4efe2", "#9a947f");
    },
  },
  brick: {
    tile: 2.4, roughness: 0.9, bump: 0.35,
    draw(ctx, s, r) {
      fill(ctx, s, "#b9ad98");
      const rows = 32;
      const rh = s / rows;
      const bw = s / 10;
      for (let j = 0; j < rows; j++) {
        const off = j % 2 ? bw / 2 : 0;
        for (let i = -1; i < 11; i++) {
          const dark = r() < 0.12;
          ctx.fillStyle = dark ? shade("#5a3a35", 0.9 + r() * 0.3) : shade("#a2513a", 0.8 + r() * 0.4);
          ctx.fillRect(i * bw + off + 1, j * rh + 1, bw - 2, rh - 2);
        }
      }
      speckle(ctx, s, r, 1500, "#c98a70", "#4a2a22");
    },
  },
  timber: {
    tile: 3, roughness: 0.9, bump: 0.5,
    draw(ctx, s, r) {
      fill(ctx, s, "#4a3b2a");
      const planks = 8;
      for (let i = 0; i < planks; i++) {
        ctx.fillStyle = shade("#5c4a35", 0.75 + r() * 0.5);
        ctx.fillRect((i * s) / planks + 1, 0, s / planks - 2, s);
      }
      for (let i = 0; i < 400; i++) {
        ctx.fillStyle = `rgba(20,14,8,${0.05 + r() * 0.15})`;
        ctx.fillRect(r() * s, r() * s, 1, 10 + r() * 60);
      }
    },
  },
  "timber-weathered": {
    tile: 3, roughness: 0.95, bump: 0.5,
    draw(ctx, s, r) {
      fill(ctx, s, "#6d675c");
      const planks = 8;
      for (let i = 0; i < planks; i++) {
        ctx.fillStyle = shade("#7d766a", 0.75 + r() * 0.45);
        ctx.fillRect((i * s) / planks + 1, 0, s / planks - 2, s);
      }
      for (let i = 0; i < 500; i++) {
        ctx.fillStyle = `rgba(30,28,22,${0.05 + r() * 0.15})`;
        ctx.fillRect(r() * s, r() * s, 1, 10 + r() * 60);
      }
    },
  },
  /** Timber-frame wall: one repeat = one bay (3 m wide) by one storey (2.8 m high). */
  frame: {
    tile: 3, roughness: 0.92, bump: 0.25,
    draw(ctx, s, r) {
      fill(ctx, s, "#cdbd9c");
      speckle(ctx, s, r, 3500, "#e2d6b8", "#9a8c6e", 3);
      // weather staining under the plate and above the sill
      const g = ctx.createLinearGradient(0, 0, 0, s);
      g.addColorStop(0, "rgba(70,56,36,0.3)");
      g.addColorStop(0.3, "rgba(70,56,36,0)");
      g.addColorStop(0.8, "rgba(70,56,36,0)");
      g.addColorStop(1, "rgba(60,48,30,0.35)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, s, s);
      const beam = (x: number, y: number, w: number, h: number) => {
        ctx.fillStyle = shade("#5e4a36", 0.8 + r() * 0.35);
        ctx.fillRect(x, y, w, h);
      };
      const t = s * 0.05;
      beam(0, 0, s, t * 1.3);
      beam(0, s - t, s, t);
      const studs = 6;
      for (let i = 0; i <= studs; i++) beam((i * (s - t)) / studs, 0, t * 0.7, s);
      // one small mullioned window per bay
      const wx = ((s - t) / studs) * 2 + t * 0.7;
      const ww = ((s - t) / studs) * 2 - t * 0.7;
      const wy = s * 0.32;
      const wh = s * 0.27;
      ctx.fillStyle = "#3b4144";
      ctx.fillRect(wx, wy, ww, wh);
      ctx.fillStyle = "rgba(150,165,170,0.3)";
      ctx.fillRect(wx, wy, ww, wh * 0.45);
      for (let i = 0; i <= 3; i++) beam(wx + (i * ww) / 3 - 1.5, wy, 3, wh);
      beam(wx - 2, wy - 3, ww + 4, 4);
      beam(wx - 2, wy + wh - 1, ww + 4, 5);
      beam(0, s * 0.64, wx, t * 0.6);
      beam(wx + ww, s * 0.64, s - wx - ww, t * 0.6);
      // a diagonal brace
      ctx.strokeStyle = "#5a4634";
      ctx.lineWidth = t * 0.6;
      ctx.beginPath();
      ctx.moveTo(s * 0.86, s * 0.64);
      ctx.lineTo(s * 0.98, s * 0.95);
      ctx.stroke();
    },
  },
  /** Earlier, plainer timber-and-daub wall. */
  daub: {
    tile: 3, roughness: 0.96, bump: 0.3,
    draw(ctx, s, r) {
      fill(ctx, s, "#b9a889");
      speckle(ctx, s, r, 5000, "#d4c6a6", "#84765c", 4);
      ctx.fillStyle = "#4a3b2b";
      ctx.fillRect(0, 0, s, s * 0.05);
      ctx.fillRect(0, s * 0.95, s, s * 0.05);
      for (let i = 0; i < 3; i++) ctx.fillRect((i * s) / 3, 0, s * 0.04, s);
      ctx.fillStyle = "#1c1814";
      ctx.fillRect(s * 0.45, s * 0.35, s * 0.12, s * 0.22);
      const g = ctx.createLinearGradient(0, s * 0.7, 0, s);
      g.addColorStop(0, "rgba(60,48,30,0)");
      g.addColorStop(1, "rgba(60,48,30,0.4)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, s, s);
    },
  },
  plaster: {
    tile: 4, roughness: 0.9, bump: 0.1,
    draw(ctx, s, r) {
      fill(ctx, s, "#cfc5ad");
      speckle(ctx, s, r, 4000, "#e2dac4", "#998f78", 4);
      for (let i = 0; i < 25; i++) {
        ctx.fillStyle = "rgba(80,70,50,0.05)";
        ctx.fillRect(r() * s, 0, 3 + r() * 8, s);
      }
    },
  },
  whitewash: {
    tile: 5, roughness: 0.85, bump: 0.2,
    draw(ctx, s, r) {
      courses(ctx, s, r, 10, 6, "#efeadb", "#d2cbb8", 0.06, 0.3);
      speckle(ctx, s, r, 1500, "#ffffff", "#a8a290");
    },
  },
  thatch: {
    tile: 3, roughness: 1, bump: 0.8,
    draw(ctx, s, r) {
      fill(ctx, s, "#8c7b52");
      for (let i = 0; i < 2600; i++) {
        ctx.strokeStyle = shade(r() > 0.5 ? "#a8956a" : "#6b5d3c", 0.7 + r() * 0.6);
        ctx.globalAlpha = 0.5;
        ctx.beginPath();
        const x = r() * s;
        const y = r() * s;
        ctx.moveTo(x, y);
        ctx.lineTo(x + (r() - 0.5) * 3, y + 8 + r() * 26);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      for (let j = 1; j < 4; j++) {
        ctx.fillStyle = "rgba(40,32,18,0.25)";
        ctx.fillRect(0, (j * s) / 4, s, 3);
      }
    },
  },
  "thatch-old": {
    tile: 3, roughness: 1, bump: 0.8, color: 0x8f8a78,
    draw(ctx, s, r) {
      MATERIALS.thatch.draw(ctx, s, r);
      ctx.fillStyle = "rgba(70,74,60,0.35)";
      ctx.fillRect(0, 0, s, s);
    },
  },
  tile: {
    tile: 2.4, roughness: 0.88, bump: 0.5,
    draw(ctx, s, r) {
      fill(ctx, s, "#5c3024");
      const rows = 16;
      const cols = 14;
      for (let j = 0; j < rows; j++) {
        for (let i = -1; i <= cols; i++) {
          const x = (i + (j % 2) * 0.5) * (s / cols);
          const k = r();
          ctx.fillStyle = shade(k < 0.14 ? "#6a4a3c" : k < 0.3 ? "#7d4633" : "#96513a", 0.75 + r() * 0.4);
          ctx.fillRect(x + 0.5, (j * s) / rows, s / cols - 1, s / rows - 1.5);
        }
        ctx.fillStyle = "rgba(30,12,8,0.4)";
        ctx.fillRect(0, ((j + 1) * s) / rows - 2, s, 2);
      }
      speckle(ctx, s, r, 1200, "#b98568", "#33261f", 3);
      // lichen and soot streaks
      for (let i = 0; i < 22; i++) {
        ctx.fillStyle = r() > 0.5 ? "rgba(90,96,60,0.16)" : "rgba(30,24,20,0.14)";
        ctx.fillRect(r() * s, r() * s, 4 + r() * 14, 30 + r() * 90);
      }
    },
  },
  tegula: {
    tile: 2.4, roughness: 0.85, bump: 0.7,
    draw(ctx, s, r) {
      fill(ctx, s, "#a4583c");
      const cols = 6;
      const rows = 5;
      for (let j = 0; j < rows; j++)
        for (let i = 0; i < cols; i++) {
          ctx.fillStyle = shade("#b05f40", 0.8 + r() * 0.35);
          ctx.fillRect((i * s) / cols, (j * s) / rows, s / cols, s / rows - 2);
        }
      for (let i = 0; i < cols; i++) {
        const x = (i * s) / cols;
        const g = ctx.createLinearGradient(x - 7, 0, x + 7, 0);
        g.addColorStop(0, "#6f3423");
        g.addColorStop(0.5, "#c9785a");
        g.addColorStop(1, "#6f3423");
        ctx.fillStyle = g;
        ctx.fillRect(x - 7, 0, 14, s);
      }
      for (let j = 1; j <= rows; j++) {
        ctx.fillStyle = "rgba(40,15,8,0.4)";
        ctx.fillRect(0, (j * s) / rows - 3, s, 3);
      }
    },
  },
  lead: {
    tile: 4, roughness: 0.55, metalness: 0.35, bump: 0.5,
    draw(ctx, s, r) {
      fill(ctx, s, "#80858a");
      speckle(ctx, s, r, 3000, "#a4a9ad", "#5a5e63", 4);
      for (let i = 0; i < 6; i++) {
        const x = (i * s) / 6;
        const g = ctx.createLinearGradient(x - 5, 0, x + 5, 0);
        g.addColorStop(0, "#5e6368");
        g.addColorStop(0.5, "#aeb3b8");
        g.addColorStop(1, "#5e6368");
        ctx.fillStyle = g;
        ctx.fillRect(x - 5, 0, 10, s);
      }
    },
  },
  shingle: {
    tile: 2.4, roughness: 0.95, bump: 0.6,
    draw(ctx, s, r) {
      fill(ctx, s, "#4a4136");
      const rows = 14;
      const cols = 16;
      for (let j = 0; j < rows; j++)
        for (let i = -1; i <= cols; i++) {
          ctx.fillStyle = shade("#7a6d5a", 0.7 + r() * 0.5);
          ctx.fillRect((i + (j % 2) * 0.5) * (s / cols) + 0.5, (j * s) / rows, s / cols - 1, s / rows - 2);
        }
    },
  },
  slate: {
    tile: 2.4, roughness: 0.7, bump: 0.4,
    draw(ctx, s, r) {
      fill(ctx, s, "#3d434a");
      const rows = 14;
      const cols = 12;
      for (let j = 0; j < rows; j++)
        for (let i = -1; i <= cols; i++) {
          ctx.fillStyle = shade("#5b636c", 0.75 + r() * 0.4);
          ctx.fillRect((i + (j % 2) * 0.5) * (s / cols) + 0.5, (j * s) / rows, s / cols - 1, s / rows - 1.5);
        }
    },
  },
  earth: {
    tile: 6, roughness: 1, bump: 0.4,
    draw(ctx, s, r) {
      fill(ctx, s, "#8a7a62");
      speckle(ctx, s, r, 9000, "#b3a488", "#5a4d3a", 4);
    },
  },
  gravel: {
    tile: 5, roughness: 1, bump: 0.5,
    draw(ctx, s, r) {
      fill(ctx, s, "#9a8f7a");
      speckle(ctx, s, r, 12000, "#c9bfa8", "#5f574a", 3);
    },
  },
  cobble: {
    tile: 3, roughness: 0.95, bump: 0.8,
    draw(ctx, s, r) {
      fill(ctx, s, "#4d4a44");
      for (let i = 0; i < 900; i++) {
        ctx.fillStyle = shade("#8d887c", 0.7 + r() * 0.5);
        ctx.beginPath();
        ctx.ellipse(r() * s, r() * s, 5 + r() * 5, 4 + r() * 4, r() * 3, 0, 7);
        ctx.fill();
      }
    },
  },
  glass: {
    tile: 2, roughness: 0.25, metalness: 0.2, bump: 0.2,
    draw(ctx, s, r) {
      fill(ctx, s, "#27323a");
      ctx.strokeStyle = "#11161a";
      ctx.lineWidth = 3;
      for (let i = -8; i < 16; i++) {
        ctx.beginPath();
        ctx.moveTo((i * s) / 8, 0);
        ctx.lineTo((i * s) / 8 + s, s);
        ctx.moveTo((i * s) / 8 + s, 0);
        ctx.lineTo((i * s) / 8, s);
        ctx.stroke();
      }
      speckle(ctx, s, r, 300, "#7fa0b0", "#000000", 6);
    },
  },
  dark: {
    tile: 2, roughness: 1,
    draw(ctx, s) {
      fill(ctx, s, "#15120f");
    },
  },
  gold: {
    tile: 2, roughness: 0.4, metalness: 0.8,
    draw(ctx, s) {
      fill(ctx, s, "#c9a23a");
    },
  },
  water: {
    tile: 6, roughness: 0.12, bump: 0.15, color: 0x8fa39a,
    draw(ctx, s, r) {
      fill(ctx, s, "#4d5f58");
      speckle(ctx, s, r, 2500, "#7f968c", "#2f3f3a", 8);
    },
  },
  foliage: {
    tile: 4, roughness: 1, bump: 0.6,
    draw(ctx, s, r) {
      fill(ctx, s, "#4d6a34");
      speckle(ctx, s, r, 9000, "#7a9a4a", "#28401c", 6);
    },
  },
};

for (const [name, base, color] of [
  ["frame-ochre", "frame", 0xf0e2bc], ["frame-grey", "frame", 0xd6d4cc], ["frame-rose", "frame", 0xecd8ca], ["frame-dark", "frame", 0xc4b69c],
  ["tile-old", "tile", 0xb8a393], ["tile-bright", "tile", 0xffd9c4],
  // procedural fallbacks for the names the street workstream added (used only when the scans are absent)
  ["oak", "timber", 0xc8b8a0], ["planks", "timber", 0xe0d4c0], ["rubble", "ragstone", 0xffffff], ["brick-tudor", "brick", 0xffffff],
  ["street-earth", "earth", 0xe8dcc8], ["street-cobble", "cobble", 0xb0a490], ["street-gravel", "gravel", 0xffffff], ["kennel", "earth", 0x7a6e60],
] as const) MATERIALS[name] = { ...MATERIALS[base], color };

const texCache = new Map<string, THREE.CanvasTexture>();
let maxAniso = 4;
export function setAnisotropy(n: number) {
  maxAniso = n;
  setBayAnisotropy(n);
  for (const t of scanCache.values()) {
    t.anisotropy = n;
    t.needsUpdate = true;
  }
  for (const t of texCache.values()) {
    t.anisotropy = n;
    t.needsUpdate = true;
  }
}

export function getTexture(name: string): THREE.CanvasTexture {
  const baseName = name.startsWith("frame-") ? "frame" : name.startsWith("tile-") ? "tile" : name;
  let t = texCache.get(baseName);
  if (t) return t;
  const def = MATERIALS[baseName];
  name = baseName;
  const s = name === "frame" ? 1024 : 512;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = s;
  const ctx = canvas.getContext("2d")!;
  def.draw(ctx, s, rng(name.length * 7919 + name.charCodeAt(0) * 31));
  t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = maxAniso;
  texCache.set(name, t);
  return t;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = rej;
    im.src = url;
  });
}

let framePromise: Promise<void> | null = null;
/**
 * Timber-frame wall, composited from scans: lime-plaster panels with oak
 * framing and a small leaded window. One repeat = a 3 m bay, one storey high.
 */
function frameTexture(): THREE.CanvasTexture {
  const t = getTexture("frame"); // procedural version shows until the scans arrive
  const c = ASSETS.composites.frame;
  if (!framePromise && useScans && c) {
    framePromise = Promise.all([loadImage(`/assets/textures/${c.base}/diff.jpg`), loadImage(`/assets/textures/${c.beams}/diff.jpg`)])
      .then(([plaster, wood]) => {
        const s = 1024;
        const cv = t.image as HTMLCanvasElement;
        const ctx = cv.getContext("2d")!;
        const r = rng(1577);
        ctx.drawImage(plaster, 0, 0, s, s);
        // limewash: lift and unify the plaster, then weather it
        ctx.fillStyle = "rgba(226,214,190,0.5)";
        ctx.fillRect(0, 0, s, s);
        const g = ctx.createLinearGradient(0, 0, 0, s);
        g.addColorStop(0, "rgba(58,46,30,0.42)");
        g.addColorStop(0.22, "rgba(58,46,30,0)");
        g.addColorStop(0.72, "rgba(58,46,30,0)");
        g.addColorStop(1, "rgba(48,40,26,0.5)");
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, s, s);
        for (let i = 0; i < 40; i++) {
          ctx.fillStyle = `rgba(60,52,38,${0.03 + r() * 0.06})`;
          ctx.fillRect(r() * s, r() * s * 0.5, 4 + r() * 18, 120 + r() * 500);
        }
        const pat = ctx.createPattern(wood, "repeat")!;
        const beam = (x: number, y: number, w: number, h: number, vertical: boolean) => {
          // soft contact shadow so the timber sits proud of the panel
          ctx.fillStyle = "rgba(20,14,8,0.38)";
          ctx.fillRect(x + 3, y + 4, w, h);
          ctx.save();
          ctx.translate(x, y);
          if (!vertical) {
            ctx.rotate(Math.PI / 2);
            ctx.translate(0, -w);
            ctx.fillStyle = pat;
            ctx.fillRect(0, 0, h, w);
          } else {
            ctx.fillStyle = pat;
            ctx.fillRect(0, 0, w, h);
          }
          ctx.restore();
          ctx.fillStyle = `rgba(30,20,10,${0.25 + r() * 0.2})`;
          ctx.fillRect(x, y, w, h);
          ctx.fillStyle = "rgba(255,240,210,0.08)";
          ctx.fillRect(x, y, vertical ? 2 : w, vertical ? h : 2);
        };
        const tk = s * 0.05;
        const studs = 6;
        const pitch = (s - tk) / studs;
        for (let i = 0; i <= studs; i++) beam(i * pitch, 0, tk * 0.72, s, true);
        const wx = pitch * 2 + tk * 0.72, ww = pitch * 2 - tk * 0.72, wy = s * 0.3, wh = s * 0.3;
        beam(0, s * 0.63, wx, tk * 0.6, false);
        beam(wx + ww, s * 0.63, s - wx - ww, tk * 0.6, false);
        // leaded window
        ctx.fillStyle = "#1b2024";
        ctx.fillRect(wx, wy, ww, wh);
        const sky = ctx.createLinearGradient(0, wy, 0, wy + wh);
        sky.addColorStop(0, "rgba(150,170,180,0.55)");
        sky.addColorStop(1, "rgba(60,70,72,0.15)");
        ctx.fillStyle = sky;
        ctx.fillRect(wx, wy, ww, wh);
        ctx.strokeStyle = "rgba(15,15,15,0.7)";
        ctx.lineWidth = 1.5;
        for (let k = -8; k < 16; k++) {
          ctx.beginPath();
          ctx.moveTo(wx + k * 14, wy);
          ctx.lineTo(wx + k * 14 + wh, wy + wh);
          ctx.moveTo(wx + k * 14 + wh, wy);
          ctx.lineTo(wx + k * 14, wy + wh);
          ctx.save();
          ctx.beginPath();
          ctx.rect(wx, wy, ww, wh);
          ctx.clip();
          ctx.beginPath();
          ctx.moveTo(wx + k * 14, wy);
          ctx.lineTo(wx + k * 14 + wh, wy + wh);
          ctx.moveTo(wx + k * 14 + wh, wy);
          ctx.lineTo(wx + k * 14, wy + wh);
          ctx.stroke();
          ctx.restore();
        }
        for (let i = 0; i <= 3; i++) beam(wx + (i * ww) / 3 - tk * 0.18, wy, tk * 0.36, wh, true);
        beam(wx - 4, wy - tk * 0.4, ww + 8, tk * 0.4, false);
        beam(wx - 6, wy + wh, ww + 12, tk * 0.5, false);
        // plate (jetty bressummer) and sill
        beam(0, 0, s, tk * 1.35, false);
        beam(0, s - tk, s, tk, false);
        t.needsUpdate = true;
      })
      .catch(() => undefined);
  }
  return t;
}

/** A fresh material instance (so each landmark can be clipped/tinted independently); textures are shared. */
export function makeMaterial(name: string): THREE.MeshStandardMaterial {
  if (name.startsWith("flat:")) {
    // "flat:<css colour>[:<opacity>]": an untextured tint, used for abstract stand-ins and map-style overlays
    const [, color, op] = name.split(":");
    const opacity = op ? parseFloat(op) : 1;
    const fm = new THREE.MeshStandardMaterial({ color: new THREE.Color(color || "#888888"), roughness: 0.95, metalness: 0 });
    // Opaque tints are stand-ins (figures, tents), not surfaces: a little self-light keeps the tint readable in shade,
    // at dawn and at a distance, where a plain matt colour sinks to grey. A legibility device, not a dye.
    if (opacity >= 1) fm.emissive.copy(fm.color).multiplyScalar(0.3);
    if (opacity < 1) {
      fm.transparent = true;
      fm.opacity = opacity;
      fm.depthWrite = false;
      fm.polygonOffset = true;
      fm.polygonOffsetFactor = -2;
      fm.polygonOffsetUnits = -2;
    }
    fm.name = name;
    return fm;
  }
  if (name === "opening") {
    // an unglazed window opening of a fabric house: the fabric shader draws the room behind it (street/houseShader.ts);
    // anywhere else it is a plain dark opening
    const om = new THREE.MeshStandardMaterial({ color: 0x15120f, roughness: 1, metalness: 0 });
    om.name = name;
    return om;
  }
  const special = specialMaterial(name);
  if (special) {
    special.name = name;
    return special;
  }
  if (name.startsWith("fwall-")) {
    // timber-frame bay composite for modelled houses: UVs are in bays and storeys (tile 1)
    const design = (BAY_DESIGNS as readonly string[]).includes(name.slice(6)) ? (name.slice(6) as BayDesign) : "square";
    const c = ASSETS.composites.frame;
    const maps = bayMaps(design, useScans && c ? c.base : null, useScans && c ? c.beams : null);
    const fm = new THREE.MeshStandardMaterial({ map: maps.map, normalMap: maps.normalMap, roughnessMap: maps.roughnessMap, roughness: 1, metalness: 0 });
    fm.normalScale.set(1, 1);
    fm.name = name;
    return fm;
  }
  const base = name.startsWith("frame-") ? "frame" : name;
  const def = MATERIALS[name] ?? MATERIALS[base] ?? MATERIALS.plaster;
  const scan = useScans ? ASSETS.materials[name] : undefined;
  let m: THREE.MeshStandardMaterial;
  if (scan) {
    m = new THREE.MeshStandardMaterial({
      map: scanTexture(scan.asset, "diff"), normalMap: scanTexture(scan.asset, "nor"), roughnessMap: scanTexture(scan.asset, "rough"),
      roughness: 1, metalness: 0, color: scan.color ?? "#ffffff",
    });
    m.normalScale.set(1.1, 1.1);
  } else if (base === "frame") {
    const map = frameTexture();
    m = new THREE.MeshStandardMaterial({ map, bumpMap: map, bumpScale: 0.5, roughness: 0.92, metalness: 0, color: def.color ?? 0xffffff });
  } else {
    const map = getTexture(MATERIALS[name] ? name : "plaster");
    m = new THREE.MeshStandardMaterial({ map, roughness: def.roughness, metalness: def.metalness ?? 0, color: def.color ?? 0xffffff });
    if (def.bump) {
      m.bumpMap = map;
      m.bumpScale = def.bump;
    }
  }
  m.name = name;
  return m;
}

export function tileOf(name: string): number {
  if (name.startsWith("fwall-") || name === "opening") return 1;
  const sp = specialTile(name);
  if (sp != null) return sp;
  const scan = useScans ? ASSETS.materials[name] : undefined;
  if (scan) return scan.tile;
  const base = name.startsWith("frame-") ? "frame" : name;
  return (MATERIALS[name] ?? MATERIALS[base] ?? MATERIALS.plaster).tile;
}
