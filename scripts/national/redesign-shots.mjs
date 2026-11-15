// Fixed-view screenshots of the national map, for design review.
// Usage: node scripts/national/redesign-shots.mjs <label> [--only=name,name] [--dsf=2]
// Writes docs/screenshots/national-redesign/<label>/*.png and timing.json (load time, frame times).
import { chromium } from "playwright-core";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const BASE = process.env.LTT_URL ?? "http://127.0.0.1:4310";
const label = process.argv[2] ?? "after";
const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7).split(",");
const dsf = +(process.argv.find((a) => a.startsWith("--dsf="))?.slice(6) ?? 1);
const OUT = fileURLToPath(new URL(`../../docs/screenshots/national-redesign/${label}/`, import.meta.url));
mkdirSync(OUT, { recursive: true });

// camera helper evaluated in the page: look at (lat, lon) from `dist` km away, `tilt` radians from vertical, `yaw` radians
const CAM = (lat, lon, dist, tilt = 0.75, yaw = 0) =>
  `(()=>{const n=window.__nat;const [x,z]=n.toXZ(${lat},${lon});const d=${dist},t=${tilt},w=${yaw};n.setCamera([x+Math.sin(w)*Math.sin(t)*d,Math.cos(t)*d,z+Math.cos(w)*Math.sin(t)*d],[x,0,z]);})()`;

const JOBS = [
  { name: "map-3000bce", q: "map=1&year=-3000" },
  { name: "map-150", q: "map=1&year=150" },
  { name: "map-800", q: "map=1&year=800" },
  { name: "map-1300", q: "map=1&year=1300" },
  { name: "map-1600", q: "map=1&year=1600" },
  { name: "zoom-thames-1300", q: "map=1&year=1300", js: CAM(51.48, 0.55, 150, 0.8, 0.25) },
  { name: "zoom-london-150", q: "map=1&year=150", js: CAM(51.5, -0.05, 95, 0.75, 0.1) },
  { name: "zoom-snowdonia-1300", q: "map=1&year=1300", js: CAM(53.05, -4.05, 120, 0.9, -0.35) },
  { name: "zoom-fens-1300", q: "map=1&year=1300", js: CAM(52.75, 0.15, 190, 0.7, 0) },
  { name: "zoom-fens-3000bce", q: "map=1&year=-3000", js: CAM(52.75, 0.15, 190, 0.7, 0) },
  { name: "zoom-southcoast-150", q: "map=1&year=150", js: CAM(50.75, -1.35, 130, 0.95, 0.15) },
  { name: "zoom-close-lakes-1300", q: "map=1&year=1300", js: CAM(54.42, -3.05, 70, 0.85, 0.3) },
  { name: "selected-london-1300", q: "map=1&year=1300&place=london" },
  { name: "icons-wales-1300-2x", q: "map=1&year=1300", js: CAM(52.95, -3.6, 140, 0.55, 0), dsf: 2 },
  { name: "icons-south-150-2x", q: "map=1&year=150&polities=0", js: CAM(51.3, -1.2, 200, 0.5, 0), dsf: 2 },
  { name: "selected-york-900", q: "map=1&year=900&place=york" },
  { name: "hover-stonehenge-2000bce", q: "map=1&year=-2000", js: CAM(51.18, -1.83, 260, 0.6, 0), hover: "stonehenge" },
  { name: "key-open-1300", q: "map=1&year=1300", click: '[data-testid="key-toggle"]' },
  { name: "evidence-1300", q: "map=1&year=1300&evidence=1" },
  { name: "bare-1600", q: "map=1&year=1600&ui=0&labels=0&polities=0" },
  { name: "ui-1280x720-1300", q: "map=1&year=1300", vp: [1280, 720] },
  { name: "ui-2200x1300-1066", q: "map=1&year=1066", vp: [2200, 1300] },
  { name: "ui-narrow-700x900-1300", q: "map=1&year=1300&place=york", vp: [700, 900] },
];

const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
const timing = { label, when: new Date().toISOString(), dsf, runs: [] };
for (const job of JOBS) {
  if (only && !only.includes(job.name)) continue;
  const [w, h] = job.vp ?? [1600, 900];
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: job.dsf ?? dsf });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.error("PAGE ERROR", job.name, e.message));
  page.on("console", (m) => { if (m.type() === "error") console.log("console:", m.text().slice(0, 300)); });
  const t0 = Date.now();
  await page.goto(`${BASE}/?${job.q}`);
  await page.waitForFunction(() => window.__nat && window.__nat.getState().ready && (document.querySelector('[data-testid="year-readout"]') || location.search.includes("ui=0")), null, { timeout: 120000 });
  const loadMs = Date.now() - t0;
  await page.waitForTimeout(1500);
  if (job.js) { await page.evaluate(job.js); await page.waitForTimeout(1400); }
  if (job.click) { await page.click(job.click); await page.waitForTimeout(500); }
  if (job.hover) {
    const s = await page.evaluate((id) => window.__nat.placeStatus(id), job.hover);
    if (s) await page.mouse.move(s.screen[0], s.screen[1]);
    await page.waitForTimeout(900);
  }
  const perf = await page.evaluate(() => {
    const st = window.__nat.stats();
    const b = window.__nat.benchmark ? window.__nat.benchmark(20) : null;
    return { fps: st.fps, frameMs: st.frameMs, benchMs: b?.msPerFrame, tris: st.triangles, calls: st.calls, labels: st.labels };
  });
  await page.screenshot({ path: `${OUT}${job.name}.png` });
  timing.runs.push({ name: job.name, loadMs, ...perf });
  console.log(job.name, loadMs + "ms", JSON.stringify(perf));
  await ctx.close();
}
writeFileSync(`${OUT}timing.json`, JSON.stringify(timing, null, 2));
await browser.close();
