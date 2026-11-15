// Load time with and without the crowd figures: time to first drawn frame (as tests/perf.mjs measures it), time to
// "ready", and (figures) time until the figure people are drawn. Alternates the two, N rounds, reports medians.
// Usage: node tests/figure-load.mjs [rounds=4] [query=site=london&year=1616&view=bridgehead]
import { chromium } from "playwright-core";

const BASE = process.env.LTT_URL ?? "http://127.0.0.1:4310";
const rounds = +(process.argv[2] ?? 4);
const q = process.argv[3] ?? "site=london&year=1616&view=bridgehead";
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
const res = { blocks: [], figures: [] };
for (let r = 0; r < rounds; r++)
  for (const v of ["blocks", "figures"]) {
    const page = await browser.newPage({ viewport: { width: 1500, height: 900 }, deviceScaleFactor: 1 });
    const t0 = Date.now();
    await page.goto(`${BASE}/?${q}&quality=high&ui=0${v === "blocks" ? "&figures=blocks" : ""}`, { timeout: 180000 });
    await page.waitForFunction(() => window.__ltt && window.__ltt.stats && window.__ltt.stats().triangles > 0, null, { timeout: 180000 });
    const first = Date.now() - t0;
    await page.waitForFunction(() => window.__ltt.getState().ready, null, { timeout: 180000 });
    const ready = Date.now() - t0;
    let figs = null;
    if (v === "figures") {
      await page.waitForFunction(() => {
        let f = null;
        window.__ltt.scene.traverse((o) => { if (o.name === "populace") f = o.userData.figures; });
        return f && f.stats.drawn.some((n) => n > 0);
      }, null, { timeout: 60000 }).catch(() => {});
      figs = Date.now() - t0;
    }
    res[v].push({ first, ready, figs });
    await page.close();
  }
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
for (const v of ["blocks", "figures"])
  console.log(v, "first frame", med(res[v].map((x) => x.first)), "ms; ready", med(res[v].map((x) => x.ready)), "ms" + (v === "figures" ? `; figures drawn ${med(res[v].map((x) => x.figs))} ms` : ""), JSON.stringify(res[v]));
await browser.close();
