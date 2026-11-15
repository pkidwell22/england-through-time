import * as THREE from "three";
import { rng } from "@/lib/geo";

/**
 * Small procedural materials for facade fittings that no scan covers:
 *  - "glass-leaded": diamond quarries of slightly green, uneven crown/cylinder glass in lead cames. Each quarry
 *    gets its own small tilt in the normal map, so the sky reflection breaks up pane by pane as old glass does.
 *    One repeat = 0.6 m.
 *  - "sign": an atlas of 4 x 2 painted boards with generic emblems (bush, bell, sun, star, key, moon, cup, crown).
 *    No lettering. Builders address a cell by UV.
 *  - "iron": wrought-iron straps, hinges and sign brackets (dark, slightly rusty).
 */

const cache = new Map<string, THREE.MeshStandardMaterial>();

function cv(w: number, h = w): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return [c, c.getContext("2d")!];
}

function tex(c: HTMLCanvasElement, srgb: boolean): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function glass(): THREE.MeshStandardMaterial {
  const S = 512;
  const [c, x] = cv(S), [n, nx] = cv(S), [r, rx] = cv(S);
  const rnd = rng(9137);
  // quarries: 4 across, 3 rows of diamonds per repeat (each ~0.15 x 0.2 m)
  const cols = 4, rows = 3;
  const qw = S / cols, qh = S / rows;
  x.fillStyle = "#15191a";
  x.fillRect(0, 0, S, S);
  nx.fillStyle = "rgb(128,128,255)";
  nx.fillRect(0, 0, S, S);
  rx.fillStyle = "rgb(150,150,150)";
  rx.fillRect(0, 0, S, S);
  const diamond = (ctx: CanvasRenderingContext2D, cx: number, cy: number, inset: number) => {
    ctx.beginPath();
    ctx.moveTo(cx, cy - qh / 2 + inset);
    ctx.lineTo(cx + qw / 2 - inset, cy);
    ctx.lineTo(cx, cy + qh / 2 - inset);
    ctx.lineTo(cx - qw / 2 + inset, cy);
    ctx.closePath();
  };
  for (let j = -1; j <= rows; j++)
    for (let i = -1; i <= cols; i++)
      for (const [ox, oy] of [[0, 0], [qw / 2, qh / 2]]) {
        const cx = i * qw + ox, cy = j * qh + oy;
        const tint = 26 + rnd() * 22;
        x.fillStyle = `rgb(${Math.round(tint * 0.9)},${Math.round(tint * 1.08)},${Math.round(tint)})`;
        diamond(x, cx, cy, 3);
        x.fill();
        // per-quarry tilt (old glass is never flat), and a faint bullseye ripple
        const tx = (rnd() - 0.5) * 0.36, ty = (rnd() - 0.5) * 0.36;
        nx.fillStyle = `rgb(${Math.round((tx * 0.5 + 0.5) * 255)},${Math.round((ty * 0.5 + 0.5) * 255)},245)`;
        diamond(nx, cx, cy, 3);
        nx.fill();
        const g = Math.round(18 + rnd() * 30);
        rx.fillStyle = `rgb(${g},${g},${g})`;
        diamond(rx, cx, cy, 3);
        rx.fill();
      }
  // lead cames: the background showing between quarries is lead (dark grey, rough); give them a rounded profile
  x.strokeStyle = "#2d2f31";
  x.lineWidth = 2;
  for (let j = -1; j <= rows; j++) for (let i = -1; i <= cols; i++) for (const [ox, oy] of [[0, 0], [qw / 2, qh / 2]]) { diamond(x, i * qw + ox, j * qh + oy, 2); x.stroke(); }
  const m = new THREE.MeshStandardMaterial({
    map: tex(c, true), normalMap: tex(n, false), roughnessMap: tex(r, false), roughness: 1, metalness: 0.3, color: 0xd8dcd4, envMapIntensity: 1.2,
  });
  m.normalScale.set(1, 1);
  return m;
}

const EMBLEMS = ["bush", "bell", "sun", "star", "key", "moon", "cup", "crown"] as const;
const BOARDS = ["#6e2a22", "#25384f", "#2f4a2c", "#1e1c1a", "#7a5a22", "#5b2c3c", "#2c4448", "#4a3b28"];

function sign(): THREE.MeshStandardMaterial {
  const W = 1024, H = 512;
  const [c, x] = cv(W, H);
  const cw = W / 4, ch = H / 2;
  const rnd = rng(733);
  EMBLEMS.forEach((e, k) => {
    const ox = (k % 4) * cw, oy = Math.floor(k / 4) * ch;
    x.save();
    x.translate(ox, oy);
    // board with a moulded frame, weathered paint
    x.fillStyle = "#3a2c1e";
    x.fillRect(0, 0, cw, ch);
    x.fillStyle = BOARDS[k];
    x.fillRect(14, 14, cw - 28, ch - 28);
    for (let i = 0; i < 260; i++) {
      x.fillStyle = `rgba(${rnd() < 0.5 ? "255,250,235" : "0,0,0"},${0.03 + rnd() * 0.06})`;
      x.fillRect(14 + rnd() * (cw - 28), 14 + rnd() * (ch - 28), 2 + rnd() * 18, 1 + rnd() * 3);
    }
    x.strokeStyle = "#b8963e";
    x.lineWidth = 4;
    x.strokeRect(22, 22, cw - 44, ch - 44);
    const gold = "#c9a646", pale = "#e7dcc0";
    const cx = cw / 2, cy = ch / 2;
    x.lineWidth = 6;
    switch (e) {
      case "bush": // the vintner's bush: a ball of greenery
        for (let i = 0; i < 40; i++) {
          const a = rnd() * Math.PI * 2, d = rnd() * 60;
          x.fillStyle = rnd() < 0.5 ? "#4f6b2e" : "#6d8a3a";
          x.beginPath(); x.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d * 0.9, 14 + rnd() * 10, 0, 7); x.fill();
        }
        break;
      case "bell":
        x.fillStyle = gold;
        x.beginPath(); x.moveTo(cx - 55, cy + 50); x.quadraticCurveTo(cx - 45, cy - 60, cx, cy - 62); x.quadraticCurveTo(cx + 45, cy - 60, cx + 55, cy + 50); x.closePath(); x.fill();
        x.beginPath(); x.arc(cx, cy + 58, 12, 0, 7); x.fill();
        break;
      case "sun":
        x.fillStyle = gold;
        for (let i = 0; i < 16; i++) { x.save(); x.translate(cx, cy); x.rotate((i * Math.PI) / 8); x.beginPath(); x.moveTo(-9, 0); x.lineTo(0, 82); x.lineTo(9, 0); x.fill(); x.restore(); }
        x.beginPath(); x.arc(cx, cy, 48, 0, 7); x.fill();
        break;
      case "star":
        x.fillStyle = pale;
        x.beginPath();
        for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + (i * Math.PI) / 5, d = i % 2 ? 30 : 78; x.lineTo(cx + Math.cos(a) * d, cy + Math.sin(a) * d); }
        x.closePath(); x.fill();
        break;
      case "key":
        x.strokeStyle = gold; x.lineWidth = 14;
        x.beginPath(); x.arc(cx - 50, cy, 26, 0, 7); x.stroke();
        x.beginPath(); x.moveTo(cx - 24, cy); x.lineTo(cx + 75, cy); x.stroke();
        x.fillStyle = gold; x.fillRect(cx + 40, cy, 14, 34); x.fillRect(cx + 62, cy, 12, 26);
        break;
      case "moon":
        x.fillStyle = pale;
        x.beginPath(); x.arc(cx, cy, 70, 0, 7); x.fill();
        x.fillStyle = BOARDS[k];
        x.beginPath(); x.arc(cx + 34, cy - 14, 62, 0, 7); x.fill();
        break;
      case "cup":
        x.fillStyle = gold;
        x.beginPath(); x.moveTo(cx - 50, cy - 60); x.lineTo(cx + 50, cy - 60); x.quadraticCurveTo(cx + 45, cy + 5, cx + 8, cy + 15); x.lineTo(cx + 8, cy + 45); x.lineTo(cx + 35, cy + 60); x.lineTo(cx - 35, cy + 60); x.lineTo(cx - 8, cy + 45); x.lineTo(cx - 8, cy + 15); x.quadraticCurveTo(cx - 45, cy + 5, cx - 50, cy - 60); x.fill();
        break;
      case "crown":
        x.fillStyle = gold;
        x.beginPath(); x.moveTo(cx - 70, cy + 40); x.lineTo(cx - 70, cy - 30); x.lineTo(cx - 35, cy + 5); x.lineTo(cx, cy - 50); x.lineTo(cx + 35, cy + 5); x.lineTo(cx + 70, cy - 30); x.lineTo(cx + 70, cy + 40); x.closePath(); x.fill();
        x.fillRect(cx - 74, cy + 40, 148, 18);
        break;
    }
    x.restore();
  });
  const t = tex(c, true);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return new THREE.MeshStandardMaterial({ map: t, roughness: 0.8, metalness: 0 });
}

function iron(): THREE.MeshStandardMaterial {
  const [c, x] = cv(128);
  const rnd = rng(55);
  x.fillStyle = "#26221f";
  x.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 300; i++) {
    x.fillStyle = `rgba(${rnd() < 0.4 ? "120,62,30" : "60,56,52"},${0.1 + rnd() * 0.3})`;
    x.fillRect(rnd() * 128, rnd() * 128, 1 + rnd() * 4, 1 + rnd() * 4);
  }
  return new THREE.MeshStandardMaterial({ map: tex(c, true), roughness: 0.7, metalness: 0.55 });
}

/** Dim interior seen through shop openings and open doors: dark boarded room, darker at the top. */
function interior(): THREE.MeshStandardMaterial {
  const [c, x] = cv(256);
  const rnd = rng(77);
  const g = x.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, "#0b0907");
  g.addColorStop(1, "#2a2119");
  x.fillStyle = g;
  x.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 9; i++) {
    x.fillStyle = `rgba(0,0,0,${0.25 + rnd() * 0.2})`;
    x.fillRect(i * 28 + rnd() * 4, 0, 2, 256);
  }
  for (let i = 0; i < 160; i++) {
    x.fillStyle = `rgba(${rnd() < 0.5 ? "80,62,44" : "0,0,0"},${0.05 + rnd() * 0.1})`;
    x.fillRect(rnd() * 256, rnd() * 256, 1 + rnd() * 3, 6 + rnd() * 30);
  }
  return new THREE.MeshStandardMaterial({ map: tex(c, true), roughness: 1, metalness: 0 });
}

export const SPECIAL = ["glass-leaded", "sign", "iron", "interior"];
export const SIGN_CELLS = EMBLEMS.length;

/** Base material (cloned by the caller) for one of the special names, or null. */
export function specialMaterial(name: string): THREE.MeshStandardMaterial | null {
  if (!SPECIAL.includes(name)) return null;
  let m = cache.get(name);
  if (!m) {
    m = name === "glass-leaded" ? glass() : name === "sign" ? sign() : name === "interior" ? interior() : iron();
    cache.set(name, m);
  }
  return m.clone();
}

export function specialTile(name: string): number | null {
  return name === "glass-leaded" ? 0.6 : name === "sign" ? 1 : name === "iron" ? 0.5 : name === "interior" ? 2.5 : null;
}
