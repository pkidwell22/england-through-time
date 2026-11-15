// Eye-level street views and the standard wide views, for the close-range streets and facades workstream.
// Usage: node tests/street-shots.mjs <label> [filter] [benchRuns]
//   writes docs/screenshots/london-realism/streets/<label>/*.png and stats.json
// The dev server must already be running (http://127.0.0.1:4310 unless LTT_URL is set).
// Eye-level cameras are given as ground positions (x, z in site metres) plus an eye height; the ground
// height is read from the live terrain model so the shots stay at eye level whatever the terrain does.
import { chromium } from "playwright-core";
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = process.env.LTT_URL ?? "http://127.0.0.1:4310";
const label = process.argv[2] ?? "current";
const only = process.argv[3] && process.argv[3] !== "all" ? process.argv[3] : null;
const benchRuns = parseInt(process.argv[4] ?? "3", 10);

// [name, year, eye [x, z], look-at [x, z], pitch (radians, + looks up)]. Eye height 1.7 m (walk mode).
const EYE = [
  ["fish-street-hill-1616", 1616, [63, -184], [40, -118], 0.07],
  ["thames-street-1616", 1616, [-150, -101], [-20, -68], 0.05],
  ["lane-1616", 1616, [112, -128], [117, -220], 0.08],
  ["fish-street-hill-1300", 1300, [63, -184], [40, -118], 0.07],
  ["fish-street-hill-1050", 1050, [63, -184], [40, -118], 0.07],
  ["fish-street-hill-150", 150, [63, -184], [40, -118], 0.07],
  ["borough-high-street-1616", 1616, [-150, 410], [-96, 300], 0.06],
];
const WIDE = [
  ["view-bridgehead-1616", 1616, "bridgehead"],
  ["view-bridge-1616", 1616, "bridge"],
  ["view-city-1616", 1616, "city"],
  ["view-overview-1616", 1616, "overview"],
  ["view-city-150", 150, "city"],
];

const dir = `docs/screenshots/london-realism/streets/${label}`;
mkdirSync(dir, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
page.on("pageerror", (e) => console.error("PAGE ERROR", e.message));
page.on("console", (m) => { if (m.type() === "error") console.log("console:", m.text().slice(0, 300)); });
const stats = {};

async function open(year, view) {
  await page.goto(`${BASE}/?site=london&year=${year}&view=${view}&quality=high&ui=0&labels=0`, { timeout: 120000 });
  await page.waitForFunction(() => window.__ltt && window.__ltt.getState().ready, null, { timeout: 90000 });
  await page.waitForTimeout(2500);
}
async function measure() {
  return page.evaluate(async (runs) => {
    const e = window.__ltt;
    const b = [];
    for (let i = 0; i < runs; i++) { b.push(e.benchmark(20).msPerFrame); await new Promise((r) => setTimeout(r, 150)); }
    const s = e.stats();
    return { benchMin: Math.min(...b), bench: b, triangles: s.triangles, calls: s.calls, instances: s.instances };
  }, benchRuns);
}

await open(1616, "bridgehead"); // warm-up load (shader compilation, texture fetches)
for (const [name, year, eye, look, pitch] of EYE) {
  if (only && !name.includes(only)) continue;
  await open(year, "bridgehead");
  await page.evaluate(([eye, look, pitch]) => {
    const e = window.__ltt;
    const tr = e.terrain;
    const yp = tr.yearParams(e.getT());
    const gy = tr.floor(tr.heightFrom(tr.staticSample(eye[0], eye[1]), yp));
    const dx = look[0] - eye[0], dz = look[1] - eye[1], l = Math.hypot(dx, dz);
    // walk mode stands the camera on the orbit target, facing away from the old camera position
    e.setCamera([eye[0] - (dx / l) * 30, gy + 20, eye[1] - (dz / l) * 30], [eye[0], gy, eye[1]]);
    if (e.getState().mode === "walk") e.setMode("orbit");
    e.setMode("walk");
    e.pitch = pitch;
  }, [eye, look, pitch]);
  await page.waitForTimeout(1500);
  await page.evaluate(([eye, look, pitch]) => {
    const e = window.__ltt;
    const tr = e.terrain;
    const yp = tr.yearParams(e.getT());
    const gy = tr.floor(tr.heightFrom(tr.staticSample(eye[0], eye[1]), yp));
    const dx = look[0] - eye[0], dz = look[1] - eye[1], l = Math.hypot(dx, dz);
    // walk mode stands the camera on the orbit target, facing away from the old camera position
    e.setCamera([eye[0] - (dx / l) * 30, gy + 20, eye[1] - (dz / l) * 30], [eye[0], gy, eye[1]]);
    if (e.getState().mode === "walk") e.setMode("orbit");
    e.setMode("walk");
    e.pitch = pitch;
  }, [eye, look, pitch]);
  await page.waitForTimeout(2500);
  stats[name] = await measure();
  await page.screenshot({ path: `${dir}/${name}.png` });
  console.log(name, JSON.stringify(stats[name]));
}
for (const [name, year, view] of WIDE) {
  if (only && !name.includes(only)) continue;
  await open(year, view);
  await page.waitForTimeout(1000);
  stats[name] = await measure();
  await page.screenshot({ path: `${dir}/${name}.png` });
  console.log(name, JSON.stringify(stats[name]));
}
writeFileSync(`${dir}/stats.json`, JSON.stringify(stats, null, 2));
await browser.close();
