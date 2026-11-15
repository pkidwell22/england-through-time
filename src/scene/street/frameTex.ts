import * as THREE from "three";
import { rng } from "@/lib/geo";

/**
 * Timber-frame bay textures for modelled houses ("fwall-<design>" materials).
 *
 * One texture repeat is ONE BAY wide and ONE STOREY high: the house builder gives framed walls UVs in
 * bays (u) and storeys (v), so studs, rails and braces always land at storey scale whatever the wall's size.
 * Each design is composited at load time from two CC0 scans (lime plaster for the panels, weathered oak
 * for the members; see data/assets.json `composites.frame`), with a height canvas from which a normal map
 * is derived, and a roughness map. Until the scans arrive (or if they are absent) a procedural version shows.
 *
 * The designs are generic patterns seen in surviving London-region town houses and in the period views
 * (close studding, square panelling with or without braces); none reproduces a recorded building.
 * Windows and doors are NOT painted in: they are modelled.
 */

export const BAY_DESIGNS = ["square", "close", "rail", "small", "brace"] as const;
export type BayDesign = (typeof BAY_DESIGNS)[number];

const S = 1024;
/** The plaster scan covers 2 m; one bay is about 3 m wide. */
const PLASTER_K = 2 / 3;

interface Member { x0: number; y0: number; x1: number; y1: number; w: number }
interface BayMaps { map: THREE.CanvasTexture; normalMap: THREE.CanvasTexture; roughnessMap: THREE.CanvasTexture; c: HTMLCanvasElement; n: HTMLCanvasElement; r: HTMLCanvasElement }

/** Member layout in canvas pixels (y down = top of the storey at 0). Posts sit on x = 0 / S and wrap. */
function layout(design: BayDesign): { members: Member[]; pegs: [number, number][] } {
  const m: Member[] = [];
  const P = 34; // post (~0.1 m face showing of a 0.2 m post per side, shared by two bays)
  const plate = 46;
  const stud = 30;
  const H = (y: number, w: number, x0 = -40, x1 = S + 40) => m.push({ x0, y0: y, x1, y1: y, w });
  const V = (x: number, w: number, y0 = 0, y1 = S) => m.push({ x0: x, y0, x1: x, y1, w });
  H(plate / 2, plate); // head plate
  H(S - 22, 44); // sill
  V(0, P * 2);
  switch (design) {
    case "square": // two by two square panels, one short brace
      H(S * 0.5, 30);
      V(S * 0.5, stud);
      m.push({ x0: S * 0.5, y0: S * 0.5 + 10, x1: S * 0.84, y1: S - 30, w: 26 });
      break;
    case "close": // close studding, full height
      for (let i = 1; i < 6; i++) V((i * S) / 6, stud);
      break;
    case "rail": // close studding with a middle rail (common on ground storeys)
      H(S * 0.47, 32);
      for (let i = 1; i < 7; i++) V((i * S) / 7, 26);
      break;
    case "small": // small square panels, three by three
      H(S / 3, 26);
      H((2 * S) / 3, 26);
      V(S / 3, 26);
      V((2 * S) / 3, 26);
      break;
    case "brace": // square panels with long tension braces up to the head plate
      H(S * 0.52, 30);
      V(S * 0.5, stud);
      m.push({ x0: 30, y0: S * 0.52 - 8, x1: S * 0.46, y1: plate, w: 28 });
      m.push({ x0: S - 30, y0: S * 0.52 - 8, x1: S * 0.54, y1: plate, w: 28 });
      break;
  }
  // a pair of oak pegs at each joint between a vertical member and a horizontal one
  const pegs: [number, number][] = [];
  const hs = m.filter((q) => q.y0 === q.y1).map((q) => q.y0);
  for (const v of m.filter((q) => q.x0 === q.x1)) {
    for (const y of hs) {
      if (y < v.y0 - 1 || y > v.y1 + 1) continue;
      const dy = y < S / 2 ? 34 : -34;
      pegs.push([v.x0 - 6, y + dy], [v.x0 + 6, y + dy * 1.7]);
    }
  }
  return { members: m, pegs };
}

/** Draw fn at the nine wrapped offsets so members on the bay edges tile seamlessly. */
function wrapped(fn: (ox: number, oy: number) => void) {
  for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) fn(ox, oy);
}

function memberPath(ctx: CanvasRenderingContext2D, q: Member, ox: number, oy: number, grow = 0) {
  const dx = q.x1 - q.x0, dy = q.y1 - q.y0;
  const len = Math.hypot(dx, dy) || 1;
  const nx = (-dy / len) * (q.w / 2 + grow), ny = (dx / len) * (q.w / 2 + grow);
  const ex = (dx / len) * grow, ey = (dy / len) * grow;
  ctx.beginPath();
  ctx.moveTo(q.x0 + ox + nx - ex, q.y0 + oy + ny - ey);
  ctx.lineTo(q.x1 + ox + nx + ex, q.y1 + oy + ny + ey);
  ctx.lineTo(q.x1 + ox - nx + ex, q.y1 + oy - ny + ey);
  ctx.lineTo(q.x0 + ox - nx - ex, q.y0 + oy - ny - ey);
  ctx.closePath();
}

/** Fill a member with a pattern whose grain runs along the member. */
function fillAlong(ctx: CanvasRenderingContext2D, q: Member, pat: CanvasPattern | string, ox: number, oy: number, k: number, off: number) {
  ctx.save();
  memberPath(ctx, q, ox, oy);
  ctx.clip();
  const ang = Math.atan2(q.y1 - q.y0, q.x1 - q.x0) - Math.PI / 2; // grain (pattern v) along the member
  ctx.translate(q.x0 + ox, q.y0 + oy);
  ctx.rotate(ang);
  if (typeof pat !== "string") pat.setTransform(new DOMMatrix().translateSelf(off, off * 0.7).scaleSelf(k, k));
  ctx.fillStyle = pat;
  ctx.fillRect(-S * 2, -S * 2, S * 4, S * 4);
  ctx.restore();
}

function canvas(): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = c.height = S;
  return [c, c.getContext("2d", { willReadFrequently: true })!];
}

/** Smooth value noise drawn by upscaling a small random canvas. */
function noiseCanvas(cells: number, r: () => number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = c.height = cells;
  const x = c.getContext("2d")!;
  const id = x.createImageData(cells, cells);
  for (let i = 0; i < cells * cells; i++) {
    const v = Math.floor(r() * 255);
    id.data[i * 4] = id.data[i * 4 + 1] = id.data[i * 4 + 2] = v;
    id.data[i * 4 + 3] = 255;
  }
  x.putImageData(id, 0, 0);
  return c;
}

/** Procedural stand-ins for the two scans, used until (or instead of) the photographs. */
function proceduralSources(): { plaster: CanvasImageSource; oak: CanvasImageSource } {
  const r = rng(4242);
  const [p, px] = canvas();
  px.fillStyle = "#d9cfbb";
  px.fillRect(0, 0, S, S);
  px.globalAlpha = 0.25;
  px.imageSmoothingEnabled = true;
  px.drawImage(noiseCanvas(24, r), 0, 0, S, S);
  px.globalAlpha = 0.12;
  px.drawImage(noiseCanvas(160, r), 0, 0, S, S);
  const [o, ox] = canvas();
  ox.fillStyle = "#6b5a46";
  ox.fillRect(0, 0, S, S);
  for (let i = 0; i < 900; i++) {
    ox.fillStyle = `rgba(${r() < 0.5 ? "30,22,14" : "150,135,115"},${0.05 + r() * 0.12})`;
    ox.fillRect(r() * S, r() * S, 1 + r() * 3, 40 + r() * 300);
  }
  return { plaster: p, oak: o };
}

function paint(maps: BayMaps, design: BayDesign, src: { plaster: CanvasImageSource; oak: CanvasImageSource }) {
  const seed = BAY_DESIGNS.indexOf(design) * 977 + 31;
  const r = rng(seed);
  const { members, pegs } = layout(design);
  const cx = maps.c.getContext("2d")!;
  const [h, hx] = canvas();
  const rx = maps.r.getContext("2d")!;
  const lowN = noiseCanvas(10, r), midN = noiseCanvas(40, r), fineN = noiseCanvas(200, r);

  // ---- plaster panels: limewashed lime plaster, uneven, with dirt low down and run-off under the rails
  const plaster = cx.createPattern(src.plaster as CanvasImageSource, "repeat")!;
  const po = [r() * 500, r() * 500];
  plaster.setTransform(new DOMMatrix().translateSelf(po[0], po[1]).scaleSelf(PLASTER_K, PLASTER_K));
  cx.globalCompositeOperation = "source-over";
  cx.globalAlpha = 1;
  cx.filter = "blur(1.2px)";
  cx.fillStyle = plaster;
  cx.fillRect(0, 0, S, S);
  cx.filter = "none";
  cx.fillStyle = "rgba(232,214,178,0.62)"; // limewash coat over the plaster, warm
  cx.fillRect(0, 0, S, S);
  cx.globalCompositeOperation = "multiply";
  cx.globalAlpha = 0.16;
  cx.drawImage(lowN, 0, 0, S, S);
  cx.globalAlpha = 0.08;
  cx.drawImage(midN, 0, 0, S, S);
  cx.globalAlpha = 1;
  cx.globalCompositeOperation = "source-over";
  const splash = cx.createLinearGradient(0, S * 0.8, 0, S);
  splash.addColorStop(0, "rgba(90,74,52,0)");
  splash.addColorStop(1, "rgba(90,74,52,0.32)");
  cx.fillStyle = splash;
  cx.fillRect(0, 0, S, S);
  for (const q of members) {
    if (q.y0 !== q.y1 || q.y0 > S - 60) continue;
    const g = cx.createLinearGradient(0, q.y0 + q.w / 2, 0, q.y0 + q.w / 2 + 90);
    g.addColorStop(0, "rgba(80,66,46,0.28)");
    g.addColorStop(1, "rgba(80,66,46,0)");
    cx.fillStyle = g;
    for (let i = 0; i < 26; i++) {
      const x = r() * S;
      cx.fillRect(x, q.y0, 3 + r() * 14, 40 + r() * 80);
    }
  }
  // contact shadow / grime line where the daub meets the timber
  cx.save();
  cx.shadowColor = "rgba(40,30,18,0.55)";
  cx.shadowBlur = 16;
  cx.fillStyle = "#3a2e22";
  wrapped((ox, oy) => members.forEach((q) => { memberPath(cx, q, ox, oy, 2); cx.fill(); }));
  cx.restore();

  // ---- oak members
  const oak = cx.createPattern(src.oak as CanvasImageSource, "repeat")!;
  wrapped((ox, oy) =>
    members.forEach((q, i) => {
      const rr = rng(seed + i * 13);
      fillAlong(cx, q, oak, ox, oy, 0.62 + rr() * 0.2, rr() * 600);
      cx.save();
      memberPath(cx, q, ox, oy);
      cx.clip();
      const tone = 0.62 + rr() * 0.22;
      cx.fillStyle = `rgba(${Math.round(120 * tone)},${Math.round(92 * tone)},${Math.round(62 * tone)},0.3)`;
      cx.fillRect(0, 0, S, S);
      // arris highlight on the upper/left edge, shade on the lower/right edge
      cx.lineWidth = 3;
      cx.strokeStyle = "rgba(255,240,215,0.12)";
      cx.stroke();
      cx.restore();
    }),
  );
  for (const [px, py] of pegs) {
    wrapped((ox, oy) => {
      cx.beginPath();
      cx.arc(px + ox, py + oy, 4.5, 0, Math.PI * 2);
      cx.fillStyle = "rgba(34,26,18,0.85)";
      cx.fill();
    });
  }
  // grime overall, darker at the base
  cx.globalCompositeOperation = "multiply";
  cx.globalAlpha = 0.1;
  cx.drawImage(fineN, 0, 0, S, S);
  cx.globalAlpha = 1;
  cx.globalCompositeOperation = "source-over";

  // ---- height: panels slightly domed and uneven, members proud with a soft arris, pegs, grain
  hx.fillStyle = "rgb(92,92,92)";
  hx.fillRect(0, 0, S, S);
  const plasterH = hx.createPattern(src.plaster as CanvasImageSource, "repeat")!;
  plasterH.setTransform(new DOMMatrix().translateSelf(po[0], po[1]).scaleSelf(PLASTER_K, PLASTER_K));
  const oakH = hx.createPattern(src.oak as CanvasImageSource, "repeat")!;
  hx.globalAlpha = 0.16;
  hx.filter = "grayscale(1) contrast(0.6)";
  hx.fillStyle = plasterH;
  hx.fillRect(0, 0, S, S);
  hx.filter = "none";
  hx.globalAlpha = 0.3;
  hx.drawImage(midN, 0, 0, S, S);
  hx.globalAlpha = 0.07;
  hx.drawImage(fineN, 0, 0, S, S);
  hx.globalAlpha = 1;
  hx.filter = "blur(3px)";
  hx.fillStyle = "rgb(60,60,60)"; // the panel edge is pressed back against the timber
  wrapped((ox, oy) => members.forEach((q) => { memberPath(hx, q, ox, oy, 6); hx.fill(); }));
  hx.filter = "blur(2px)";
  hx.fillStyle = "rgb(205,205,205)";
  wrapped((ox, oy) => members.forEach((q) => { memberPath(hx, q, ox, oy, 0); hx.fill(); }));
  hx.filter = "blur(1px)";
  hx.fillStyle = "rgb(222,222,222)";
  wrapped((ox, oy) => members.forEach((q) => { memberPath(hx, q, ox, oy, -5); hx.fill(); }));
  hx.filter = "grayscale(1) contrast(1.6)";
  hx.globalAlpha = 0.3;
  wrapped((ox, oy) => members.forEach((q, i) => fillAlong(hx, q, oakH, ox, oy, 0.62 + rng(seed + i * 13)() * 0.2, rng(seed + i * 13 + 1)() * 600)));
  hx.filter = "none";
  hx.globalAlpha = 1;
  for (const [px, py] of pegs) wrapped((ox, oy) => { hx.beginPath(); hx.arc(px + ox, py + oy, 4, 0, Math.PI * 2); hx.fillStyle = "rgb(200,200,200)"; hx.fill(); });

  // ---- roughness: matt lime, slightly less rough oak, damp base
  rx.fillStyle = "rgb(232,232,232)";
  rx.fillRect(0, 0, S, S);
  rx.globalAlpha = 0.25;
  rx.drawImage(midN, 0, 0, S, S);
  rx.globalAlpha = 1;
  rx.fillStyle = "rgb(196,196,196)";
  wrapped((ox, oy) => members.forEach((q) => { memberPath(rx, q, ox, oy, 0); rx.fill(); }));
  const damp = rx.createLinearGradient(0, S * 0.85, 0, S);
  damp.addColorStop(0, "rgba(255,255,255,0)");
  damp.addColorStop(1, "rgba(255,255,255,0.4)");
  rx.fillStyle = damp;
  rx.fillRect(0, 0, S, S);

  // ---- normal map from the height canvas (Sobel), tangent space, OpenGL convention
  const hd = hx.getImageData(0, 0, S, S).data;
  const nx2 = maps.n.getContext("2d")!;
  const out = nx2.createImageData(S, S);
  const strength = 3.2;
  const at = (x: number, y: number) => hd[(((y + S) % S) * S + ((x + S) % S)) * 4] / 255;
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const dx = at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x - 1, y) - at(x - 1, y + 1);
      const dy = at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1);
      let vx = -dx * strength, vy = dy * strength; // canvas y runs down, texture v up
      const vz = 1;
      const l = Math.hypot(vx, vy, vz);
      vx /= l; vy /= l;
      const i = (y * S + x) * 4;
      out.data[i] = Math.round((vx * 0.5 + 0.5) * 255);
      out.data[i + 1] = Math.round((vy * 0.5 + 0.5) * 255);
      out.data[i + 2] = Math.round((vz / l * 0.5 + 0.5) * 255);
      out.data[i + 3] = 255;
    }
  nx2.putImageData(out, 0, 0);
  maps.map.needsUpdate = maps.normalMap.needsUpdate = maps.roughnessMap.needsUpdate = true;
}

const cache = new Map<BayDesign, BayMaps>();
let scans: Promise<{ plaster: HTMLImageElement; oak: HTMLImageElement } | null> | null = null;
let aniso = 8;

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = rej;
    im.src = url;
  });
}

/** Maps for one bay design, built once and shared by every house. `scanBase`/`scanOak` are asset ids. */
export function bayMaps(design: BayDesign, scanBase: string | null, scanOak: string | null): BayMaps {
  let m = cache.get(design);
  if (m) return m;
  const [c] = canvas(), [n] = canvas(), [r] = canvas();
  const tex = (cv: HTMLCanvasElement, srgb: boolean) => {
    const t = new THREE.CanvasTexture(cv);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = aniso;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  m = { c, n, r, map: tex(c, true), normalMap: tex(n, false), roughnessMap: tex(r, false) };
  cache.set(design, m);
  if (scanBase && scanOak) {
    // The photographs arrive a moment after the scene: until then a flat plaster tone stands in (painting the
    // procedural frame first, only to paint over it, cost about a second of every load). The procedural frame is
    // still what is drawn if the photographs cannot be loaded.
    const fill = (cv: HTMLCanvasElement, css: string) => { const x = cv.getContext("2d")!; x.fillStyle = css; x.fillRect(0, 0, cv.width, cv.height); };
    fill(c, "#d9cfbb");
    fill(n, "#8080ff");
    fill(r, "#d0d0d0");
    scans ??= Promise.all([loadImage(`/assets/textures/${scanBase}/diff.jpg`), loadImage(`/assets/textures/${scanOak}/diff.jpg`)])
      .then(([plaster, oak]) => ({ plaster, oak }))
      .catch(() => null);
    const mm = m;
    scans.then((s) => paint(mm, design, s ?? proceduralSources()));
  } else paint(m, design, proceduralSources());
  return m;
}

export function setBayAnisotropy(n: number) {
  aniso = n;
  for (const m of cache.values()) for (const t of [m.map, m.normalMap, m.roughnessMap]) { t.anisotropy = n; t.needsUpdate = true; }
}
