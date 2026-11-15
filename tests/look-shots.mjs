// Look-development captures: a fixed set of wide, mid and eye-level cameras over several eras and all four sites.
// Usage: node tests/look-shots.mjs <label> [--quality=high] [--bench=0] [--only=substr] [--qs=look=golden] [--tiers=low,medium,high]
//   writes docs/screenshots/look/<label>/<shot>.png (and <shot>@<tier>.png when several tiers are given) + stats.json
//   --bench=N  runs window.__ltt.benchmark(20) N times per shot and keeps the minimum (0 = no timing)
// The dev server must already be running (http://127.0.0.1:4310 unless LTT_URL is set).
import { chromium } from "playwright-core";
import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";

const BASE = process.env.LTT_URL ?? "http://127.0.0.1:4310";
const args = process.argv.slice(2);
const label = args.find((a) => !a.startsWith("--")) ?? "current";
const opt = (k, d) => {
  const a = args.find((x) => x.startsWith(`--${k}=`));
  return a ? a.slice(k.length + 3) : d;
};
const tiers = opt("tiers", opt("quality", "high")).split(",");
const bench = parseInt(opt("bench", "0"), 10);
const only = opt("only", null);
const extra = opt("qs", "");
const W = parseInt(opt("w", "1600"), 10), H = parseInt(opt("h", "900"), 10);

// [name, site, year, view | null, eye-level camera {eye:[x,z], look:[x,z], pitch} | free camera {pos, target}]
const SHOTS = [
  ["london-bridge-1616", "london", 1616, "bridge"],
  ["london-bridge-low-1616", "london", 1616, "bridge-low"],
  ["london-bridgehead-1616", "london", 1616, "bridgehead"],
  ["london-city-1616", "london", 1616, "city"],
  ["london-overview-1616", "london", 1616, "overview"],
  ["london-city-150", "london", 150, "city"],
  ["london-overview-2000bce", "london", -2000, "overview"],
  ["london-thames-street-1616", "london", 1616, "bridgehead", { eye: [-150, -101], look: [-20, -68], pitch: 0.05 }],
  ["london-fish-street-hill-1300", "london", 1300, "bridgehead", { eye: [63, -184], look: [40, -118], pitch: 0.07 }],
  ["london-fish-street-hill-150", "london", 150, "bridgehead", { eye: [63, -184], look: [40, -118], pitch: 0.07 }],
  ["barnet-1471", "barnet", 1471, null],
  ["stonehenge-default", "stonehenge", null, null],
];

const dir = `docs/screenshots/look/${label}`;
mkdirSync(dir, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
const errors = [];
page.on("pageerror", (e) => { errors.push(e.message); console.error("PAGE ERROR", e.message); });
page.on("console", (m) => { if (m.type() === "error") { errors.push(m.text()); console.log("console:", m.text().slice(0, 400)); } });
const stats = { label, size: [W, H], loadavgStart: os.loadavg(), shots: {} };

async function open(site, year, view, quality) {
  const q = [`site=${site}`, year != null ? `year=${year}` : "", view ? `view=${view}` : "", `quality=${quality}`, "ui=0", "labels=0", extra].filter(Boolean).join("&");
  await page.goto(`${BASE}/?${q}`, { timeout: 120000 });
  await page.waitForFunction(() => window.__ltt && window.__ltt.getState().ready, null, { timeout: 120000 });
  await page.waitForTimeout(3500);
}
async function eyeLevel(cam) {
  for (let pass = 0; pass < 2; pass++) {
    await page.evaluate(({ eye, look, pitch }) => {
      const e = window.__ltt;
      const tr = e.terrain;
      const yp = tr.yearParams(e.getT());
      const gy = tr.floor(tr.heightFrom(tr.staticSample(eye[0], eye[1]), yp));
      const dx = look[0] - eye[0], dz = look[1] - eye[1], l = Math.hypot(dx, dz);
      // the same sequence as tests/street-shots.mjs, so the cameras match the earlier street captures exactly
      e.setCamera([eye[0] - (dx / l) * 30, gy + 20, eye[1] - (dz / l) * 30], [eye[0], gy, eye[1]]);
      if (e.getState().mode === "walk") e.setMode("orbit");
      e.setMode("walk");
      e.pitch = pitch;
    }, cam);
    await page.waitForTimeout(1200);
  }
}
async function measure() {
  return page.evaluate(async (runs) => {
    const e = window.__ltt;
    const b = [];
    for (let i = 0; i < runs; i++) { b.push(e.benchmark(20).msPerFrame); await new Promise((r) => setTimeout(r, 200)); }
    const s = e.stats();
    return { benchMin: b.length ? Math.min(...b) : null, bench: b, triangles: s.triangles, calls: s.calls };
  }, bench);
}

for (const tier of tiers) {
  for (const [name, site, year, view, cam] of SHOTS) {
    if (only && !only.split(",").some((o) => name.includes(o))) continue;
    try {
      await open(site, year, view, tier);
      if (cam?.eye) await eyeLevel(cam);
      // let temporal effects (TAA history, eye adaptation) settle
      await page.waitForTimeout(1500);
      const key = tiers.length > 1 ? `${name}@${tier}` : name;
      const m = bench > 0 ? await measure() : {};
      stats.shots[key] = m;
      await page.screenshot({ path: `${dir}/${key}.png` });
      console.log(key, JSON.stringify(m));
    } catch (e) {
      console.error("FAILED", name, tier, e.message);
      stats.shots[`${name}@${tier}`] = { error: e.message };
    }
  }
}
stats.loadavgEnd = os.loadavg();
stats.errors = errors.slice(0, 40);
writeFileSync(`${dir}/stats.json`, JSON.stringify(stats, null, 2));
console.log("load average", stats.loadavgStart.map((v) => v.toFixed(1)).join(" "), "->", stats.loadavgEnd.map((v) => v.toFixed(1)).join(" "), "cpus", os.cpus().length);
await browser.close();
