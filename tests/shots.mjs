// Fixed-viewpoint screenshots for comparing realism iterations.
// Usage: node tests/shots.mjs <label> [quality]     (server must be running; see RUN.md)
import { chromium } from "playwright-core";
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = process.env.LTT_URL ?? "http://127.0.0.1:4310";
const label = process.argv[2] ?? "current";
const quality = process.argv[3] ?? "high";
const only = process.argv[4];
const SHOTS = [
  ["overview-2000bce", "2000 BCE", "overview"],
  ["overview-130", "130", "overview"],
  ["overview-780", "780", "overview"],
  ["overview-1400", "1400", "overview"],
  ["overview-1616", "1616", "overview"],
  ["city-130", "130", "city"],
  ["city-1616", "1616", "city"],
  ["westminster-1616", "1616", "westminster"],
  ["bridge-100bce", "100 BCE", "bridge"],
  ["bridge-130", "130", "bridge"],
  ["bridge-1050", "1050", "bridge"],
  ["bridge-1400", "1400", "bridge"],
  ["bridge-1616", "1616", "bridge"],
  ["bridge-low-1616", "1616", "bridge-low"],
  ["bridgehead-1616", "1616", "bridgehead"],
];
const dir = `docs/screenshots/${label}`;
mkdirSync(dir, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
page.on("pageerror", (e) => console.error("PAGE ERROR", e.message));
const stats = {};
for (const [name, year, view] of SHOTS) {
  if (only && !name.includes(only)) continue;
  await page.goto(`${BASE}/?year=${encodeURIComponent(year)}&view=${view}&quality=${quality}&ui=0&labels=0`);
  await page.waitForFunction(() => window.__ltt && window.__ltt.getState().ready, null, { timeout: 60000 });
  await page.waitForTimeout(1800);
  stats[name] = await page.evaluate(() => ({ ...window.__ltt.stats(), bench: window.__ltt.benchmark(20) }));
  await page.screenshot({ path: `${dir}/${name}.png` });
  console.log(name, JSON.stringify(stats[name]));
}
writeFileSync(`${dir}/stats.json`, JSON.stringify(stats, null, 2));
await browser.close();
