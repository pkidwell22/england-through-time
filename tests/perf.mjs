// Frame-time table: node tests/perf.mjs  (needs the dev server on 127.0.0.1:4310; run on a quiet machine)
// ms per frame is the engine's own unthrottled benchmark (render + 1-pixel readback), best of 3 runs of 30 frames.
import { chromium } from "playwright-core";
import { writeFileSync } from "node:fs";
const BASE = process.env.LTT_BASE ?? "http://127.0.0.1:4310";
const VIEWS = [
  ["london", "overview", "1616"], ["london", "city", "1616"], ["london", "bridge", "1616"], ["london", "bridge-low", "1616"],
  ["london", "bridgehead", "1616"], ["london", "overview", "4000 BCE"], ["london", "city", "150"],
  ["brentford", "", "1016"], ["barnet", "", "1471"], ["stonehenge", "", "2400 BCE"], ["stonehenge", "landscape", "2400 BCE"],
];
const TIERS = (process.env.TIERS ?? "low,medium,high,cinematic").split(",");
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
const rows = [];
for (const [site, view, year] of VIEWS) {
  const row = { site, view: view || "default", year };
  for (const q of TIERS) {
    const page = await browser.newPage({ viewport: { width: 1500, height: 900 }, deviceScaleFactor: 1 });
    const t0 = Date.now();
    await page.goto(`${BASE}/?site=${site}&year=${encodeURIComponent(year)}${view ? `&view=${view}` : ""}&quality=${q}&ui=0`);
    await page.waitForFunction(() => window.__ltt && window.__ltt.stats && window.__ltt.stats().triangles > 0, null, { timeout: 120000 });
    const loadMs = Date.now() - t0;
    await page.waitForTimeout(3500);
    const r = await page.evaluate(() => {
      let best = Infinity;
      for (let i = 0; i < 3; i++) best = Math.min(best, window.__ltt.benchmark(30).msPerFrame);
      const s = window.__ltt.stats();
      return { ms: best, tris: s.triangles, calls: s.calls };
    });
    row[q] = r.ms; row[q + "Tris"] = r.tris; row[q + "Calls"] = r.calls; row[q + "Load"] = loadMs;
    await page.close();
  }
  rows.push(row);
  console.log(`${site}/${row.view}/${year}: ` + TIERS.map((q) => `${q} ${row[q]} ms (${(row[q + "Tris"] / 1e6).toFixed(2)} M tris, ${row[q + "Calls"]} calls, load ${row[q + "Load"]} ms)`).join(" | "));
}
await browser.close();
writeFileSync(new URL("./perf-results.json", import.meta.url), JSON.stringify({ when: new Date().toISOString(), viewport: [1500, 900], rows }, null, 1));
