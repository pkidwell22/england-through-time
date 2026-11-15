// A/B frame time of the tree impostors in one browser: octahedral (default) vs the old crossed cards (?treeimp=cards).
// node tests/tree-ab.mjs [rounds=3] [dpr=2]   (dev server on :4310; alternates the two so machine noise hits both)
// Reports the whole frame and the trees' own cost (frame with trees minus frame with the tree group hidden, alternated
// inside one page, which cancels most of the machine's drift).
import { chromium } from "playwright-core";
const [rounds = "3", dpr = "2"] = process.argv.slice(2);
const BASE = process.env.LTT_URL ?? "http://127.0.0.1:4310";
const SCENES = [["london", "4000 BCE", "overview"], ["london", "1616", "overview"], ["stonehenge", "2400 BCE", ""], ["london", "4000 BCE", "walk"]]
  .filter(([s, y, v]) => !process.env.ONLY || `${s} ${y} ${v}`.includes(process.env.ONLY));
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1500, height: 900 }, deviceScaleFactor: +dpr });
const res = {};
for (let r = 0; r < +rounds; r++)
  for (const [site, year, view] of SCENES)
    for (const mode of ["octa", "cards"]) {
     for (let attempt = 0; attempt < 3; attempt++) {
     try {
      const v = view === "walk" ? "" : view;
      await page.goto(`${BASE}/?site=${site}&year=${encodeURIComponent(year)}${v ? `&view=${v}` : ""}&quality=high&ui=0${mode === "cards" ? "&treeimp=cards" : ""}`, { timeout: 180000 });
      await page.waitForFunction(() => window.__ltt && window.__ltt.getState().ready, null, { timeout: 180000 });
      await page.waitForFunction(() => window.__ltt.trees?.userData?.debug?.().scanned, null, { timeout: 120000 });
      if (view === "walk") {
        await page.evaluate(() => { const e = window.__ltt; const tr = e.terrain; const yp = tr.yearParams(e.getT()); const g = tr.floor(tr.heightFrom(tr.staticSample(-1900, -900), yp)); e.setCamera([-1930, g + 20, -915], [-1900, g, -900]); e.setMode("walk"); e.pitch = 0.04; });
      }
      await page.waitForTimeout(3000);
      await page.evaluate(() => window.__ltt.benchmark(10));
      const { ms, cost } = await page.evaluate(() => {
        const e = window.__ltt, on = [], off = [];
        for (let i = 0; i < 6; i++) {
          e.trees.visible = true; e.benchmark(5); on.push(e.benchmark(30).msPerFrame);
          e.trees.visible = false; e.benchmark(5); off.push(e.benchmark(30).msPerFrame);
        }
        e.trees.visible = true;
        const med = (a) => [...a].sort((x, y) => x - y)[a.length >> 1];
        return { ms: med(on), cost: med(on) - med(off) };
      });
      const k = `${site} ${year} ${view || "default"}`;
      (res[k] ??= { octa: [], cards: [], octaCost: [], cardsCost: [] })[mode].push(ms);
      res[k][mode + "Cost"].push(cost);
      console.log(k, mode, ms.toFixed(2), "trees", cost.toFixed(2));
      break;
     } catch (e) { console.log("retry", site, year, view, mode, e.message.split("\n")[0]); }
     }
    }
await browser.close();
const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
for (const [k, v] of Object.entries(res))
  console.log(`${k.padEnd(28)} frame: cards ${med(v.cards).toFixed(2)} / octa ${med(v.octa).toFixed(2)} ms;  trees alone: cards ${med(v.cardsCost).toFixed(2)} / octa ${med(v.octaCost).toFixed(2)} ms  (median of ${v.octa.length})`);
