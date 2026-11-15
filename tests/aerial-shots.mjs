// Fixed views for the aerial realism round (ground and air seen from above).
// Usage: node tests/aerial-shots.mjs <label> [--only=substr,substr] [--quality=high]
//   writes docs/screenshots/realism/aerial/<label>/<shot>.png
// The dev server must already be running (http://127.0.0.1:4310 unless LTT_URL is set).
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

const BASE = process.env.LTT_URL ?? "http://127.0.0.1:4310";
const args = process.argv.slice(2);
const label = args.find((a) => !a.startsWith("--")) ?? "current";
const opt = (k, d) => {
  const a = args.find((x) => x.startsWith(`--${k}=`));
  return a ? a.slice(k.length + 3) : d;
};
const quality = opt("quality", "high");
const only = opt("only", null);

// [name, site, year, view | null, look | null, eye-level camera {eye:[x,z], look:[x,z], pitch}]
const SHOTS = [];
for (const y of ["4000 BCE", "150", "900", "1300", "1616"])
  for (const v of ["overview", "city"]) SHOTS.push([`london-${v}-${y.replace(" ", "")}`, "london", y, v, null]);
for (const l of ["golden", "overcast", "dawn"]) SHOTS.push([`london-overview-1616-${l}`, "london", "1616", "overview", l]);
SHOTS.push(["london-westminster-1300", "london", "1300", "westminster", null]);
SHOTS.push(["barnet-1471", "barnet", "1471", null, null]);
SHOTS.push(["brentford-1016", "brentford", "1016", "overview", null]);
SHOTS.push(["stonehenge-2400bce", "stonehenge", "2400 BCE", "landscape", null]);
SHOTS.push(["london-walk-fields-1300", "london", "1300", "city", null, { eye: [-1150, -1150], look: [-700, -950], pitch: -0.02 }]);
SHOTS.push(["london-4000bce-mid", "london", "4000 BCE", null, null, { pos: [-1500, 90, 700], target: [-1100, 0, 150] }]);
SHOTS.push(["barnet-1471-low", "barnet", "1471", "low-green", null]);
SHOTS.push(["stonehenge-1620-low", "stonehenge", "1620", null, null, { pos: [2300, 25, -500], target: [2800, 0, -1200] }]);
SHOTS.push(["london-walk-street-1300", "london", "1300", "bridgehead", null, { eye: [63, -184], look: [40, -118], pitch: 0.07 }]);

const dir = `docs/screenshots/realism/aerial/${label}`;
mkdirSync(dir, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
page.on("pageerror", (e) => console.error("PAGE ERROR", e.message));
page.on("console", (m) => { if (m.type() === "error") console.log("console:", m.text().slice(0, 300)); });

async function open(site, year, view, look) {
  const q = [`site=${site}`, `year=${encodeURIComponent(year)}`, view ? `view=${view}` : "", `quality=${quality}`, "ui=0", "labels=0", look ? `look=${look}` : ""].filter(Boolean).join("&");
  await page.goto(`${BASE}/?${q}`, { timeout: 120000 });
  await page.waitForFunction(() => window.__ltt && window.__ltt.getState().ready, null, { timeout: 120000 });
  // the photographed sky sets the light: wait for it (the analytic stand-in has k = 1)
  await page.waitForFunction(() => window.__ltt.lookInfo().k !== 1, null, { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(3000);
}
async function freeCam(cam) {
  await page.evaluate(({ pos: p, target: t }) => {
    const e = window.__ltt, tr = e.terrain, yp = tr.yearParams(e.getT());
    const g = (x, z) => tr.floor(tr.heightFrom(tr.staticSample(x, z), yp));
    e.setCamera([p[0], g(p[0], p[2]) + p[1], p[2]], [t[0], g(t[0], t[2]) + t[1], t[2]]);
  }, cam);
  await page.waitForTimeout(1500);
}
async function eyeLevel(cam) {
  for (let pass = 0; pass < 2; pass++) {
    await page.evaluate(({ eye, look, pitch }) => {
      const e = window.__ltt;
      const tr = e.terrain;
      const yp = tr.yearParams(e.getT());
      const gy = tr.floor(tr.heightFrom(tr.staticSample(eye[0], eye[1]), yp));
      const dx = look[0] - eye[0], dz = look[1] - eye[1], l = Math.hypot(dx, dz);
      e.setCamera([eye[0] - (dx / l) * 30, gy + 20, eye[1] - (dz / l) * 30], [eye[0], gy, eye[1]]);
      if (e.getState().mode === "walk") e.setMode("orbit");
      e.setMode("walk");
      e.pitch = pitch;
    }, cam);
    await page.waitForTimeout(1500);
  }
}

for (const [name, site, year, view, look, cam] of SHOTS) {
  if (only && !only.split(",").some((o) => name.includes(o))) continue;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await open(site, year, view, look);
      if (cam?.pos) await freeCam(cam);
      else if (cam) await eyeLevel(cam);
      await page.waitForTimeout(1500);
      await page.screenshot({ path: `${dir}/${name}.png` });
      console.log("ok", name);
      break;
    } catch (e) {
      console.error("retry", name, e.message.split("\n")[0]);
    }
  }
}
await browser.close();
