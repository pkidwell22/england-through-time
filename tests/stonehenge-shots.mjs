// Fixed-viewpoint screenshots of the Stonehenge site for comparing realism iterations.
// Usage: node tests/stonehenge-shots.mjs <label> [quality] [filter]   (server must be running)
// Writes docs/screenshots/stonehenge/<label>/<name>.png and stats.json.
import { chromium } from "playwright-core";
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = process.env.LTT_URL ?? "http://127.0.0.1:4310";
const label = process.argv[2] ?? "current";
const quality = process.argv[3] ?? "high";
const only = process.argv[4];
const SHOTS = [
  ["landscape-3500bce", "3500 BCE", "landscape"],
  ["landscape-2400bce", "2400 BCE", "landscape"],
  ["landscape-1800bce", "1800 BCE", "landscape"],
  ["landscape-1620", "1620", "landscape"],
  ["avenue-2900bce", "2900 BCE", "avenue"],
  ["avenue-2400bce", "2400 BCE", "avenue"],
  ["avenue-1620", "1620", "avenue"],
  ["inside-2400bce", "2400 BCE", "inside"],
  ["inside-1620", "1620", "inside"],
  ["low-2400bce", "2400 BCE", "low"],
  ["low-1620", "1620", "low"],
  ["durrington-2480bce", "2480 BCE", "durrington"],
  ["durrington-2500bce", "2500 BCE", "durrington"],
  ["barrows-1800bce", "1800 BCE", "barrows"],
];
const dir = `docs/screenshots/stonehenge/${label}`;
mkdirSync(dir, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
page.on("pageerror", (e) => console.error("PAGE ERROR", e.message));
page.on("console", (m) => { if (m.type() === "error") console.log("console error:", m.text().slice(0, 200)); });
const stats = {};
for (const [name, year, view] of SHOTS) {
  if (only && !name.includes(only)) continue;
  const url = `${BASE}/?site=stonehenge&year=${encodeURIComponent(year)}&view=${view}&quality=${quality}&ui=0&labels=0`;
  let ok = false;
  for (let attempt = 0; attempt < 3 && !ok; attempt++) {
    try {
      await page.goto(url, { timeout: 120000, waitUntil: "domcontentloaded" });
      await page.waitForFunction(() => window.__ltt && window.__ltt.getState().ready, null, { timeout: 120000 });
      ok = true;
    } catch (e) {
      console.log("retry", name, e.message.split("\n")[0]);
    }
  }
  if (!ok) continue;
  await page.waitForTimeout(4000);
  stats[name] = await page.evaluate(() => ({ ...window.__ltt.stats(), bench: window.__ltt.benchmark(20) }));
  await page.screenshot({ path: `${dir}/${name}.png` });
  console.log(name, JSON.stringify({ ms: stats[name].bench.msPerFrame, tris: stats[name].triangles, calls: stats[name].calls }));
}
if (!only) writeFileSync(`${dir}/stats.json`, JSON.stringify(stats, null, 2));
await browser.close();
