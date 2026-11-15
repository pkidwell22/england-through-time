// Fixed-view captures for the tree/vegetation realism work (docs/VEGETATION.md).
// Usage: node tests/tree-shots.mjs <label> [--only=substr,substr] [--looks=clear,golden] [--w=1600 --h=900]
//   writes docs/screenshots/realism/trees/<label>/<shot>-<look>.png
// Waits for the scanned trees to be swapped in before capturing. Needs the dev server (LTT_URL, default :4310).
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

const BASE = process.env.LTT_URL ?? "http://127.0.0.1:4310";
const args = process.argv.slice(2);
const label = args.find((a) => !a.startsWith("--")) ?? "current";
const opt = (k, d) => {
  const a = args.find((x) => x.startsWith(`--${k}=`));
  return a ? a.slice(k.length + 3) : d;
};
const looks = opt("looks", "clear,golden").split(",");
const only = opt("only", null);
const W = parseInt(opt("w", "1600"), 10), H = parseInt(opt("h", "900"), 10);

// [name, site, year, view | null, camera: {eye:[x,z], look:[x,z], pitch} (walk) | {pos:[x,y,z], target:[x,y,z]} (free, y above ground)]
const SHOTS = [
  ["london-4000bce-overview", "london", "4000 BCE", "overview"],
  ["london-4000bce-mid", "london", "4000 BCE", null, { pos: [-1500, 90, 700], target: [-1100, 0, 150] }],
  ["london-4000bce-walk", "london", "4000 BCE", null, { eye: [-1900, -900], look: [-1500, -700], pitch: 0.04 }],
  ["london-1616-overview", "london", "1616", "overview"],
  ["london-1616-city", "london", "1616", "city"],
  ["london-1616-cityedge", "london", "1616", null, { pos: [-1300, 70, -1150], target: [-700, 0, -600] }],
  ["barnet-1471", "barnet", "1471", null],
  ["barnet-1471-low", "barnet", "1471", "low-green"],
  ["stonehenge-2400bce", "stonehenge", "2400 BCE", null],
  ["stonehenge-2400bce-durrington", "stonehenge", "2400 BCE", "durrington"],
  ["stonehenge-1620-durrington", "stonehenge", "1620", "durrington"],
  ["stonehenge-1620-low", "stonehenge", "1620", null, { pos: [2300, 25, -500], target: [2800, 0, -1200] }],
];

const dir = `docs/screenshots/realism/trees/${label}`;
mkdirSync(dir, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
page.on("pageerror", (e) => console.error("PAGE ERROR", e.message));
page.on("console", (m) => { if (m.type() === "error") console.log("console:", m.text().slice(0, 300)); });

async function open(site, year, view, look) {
  const q = [`site=${site}`, `year=${encodeURIComponent(year)}`, view ? `view=${view}` : "", "quality=high", "ui=0", "labels=0", `look=${look}`].filter(Boolean).join("&");
  await page.goto(`${BASE}/?${q}`, { timeout: 120000 });
  await page.waitForFunction(() => window.__ltt && window.__ltt.getState().ready, null, { timeout: 120000 });
  await page.waitForFunction(() => { const d = window.__ltt.trees?.userData?.debug?.(); return d && (d.scanned || d.instances === 0); }, null, { timeout: 60000 }).catch(() => console.log("  (scanned trees not reported)"));
  await page.waitForTimeout(2500);
}
async function camera(cam) {
  for (let pass = 0; pass < 2; pass++) {
    await page.evaluate((cam) => {
      const e = window.__ltt;
      const tr = e.terrain;
      const yp = tr.yearParams(e.getT());
      const g = (x, z) => tr.floor(tr.heightFrom(tr.staticSample(x, z), yp));
      if (cam.eye) {
        const { eye, look, pitch } = cam;
        const gy = g(eye[0], eye[1]);
        const dx = look[0] - eye[0], dz = look[1] - eye[1], l = Math.hypot(dx, dz);
        e.setCamera([eye[0] - (dx / l) * 30, gy + 20, eye[1] - (dz / l) * 30], [eye[0], gy, eye[1]]);
        if (e.getState().mode === "walk") e.setMode("orbit");
        e.setMode("walk");
        e.pitch = pitch;
      } else {
        if (e.getState().mode === "walk") e.setMode("orbit");
        const p = cam.pos, t = cam.target;
        e.setCamera([p[0], g(p[0], p[2]) + p[1], p[2]], [t[0], g(t[0], t[2]) + t[1], t[2]]);
      }
    }, cam);
    await page.waitForTimeout(1500);
  }
}

for (const [name, site, year, view, cam] of SHOTS) {
  if (only && !only.split(",").some((o) => name.includes(o))) continue;
  for (const look of looks) {
    try {
      await open(site, year, view, look);
      if (cam) await camera(cam);
      await page.waitForTimeout(1500);
      const d = await page.evaluate(() => window.__ltt.trees?.userData?.debug?.());
      await page.screenshot({ path: `${dir}/${name}-${look}.png` });
      console.log(name, look, JSON.stringify({ src: d?.source, n: d?.instances, lv: d?.perLevel, tri: d?.triangles }));
    } catch (e) {
      console.error("FAILED", name, look, e.message.split("\n")[0]);
    }
  }
}
await browser.close();
