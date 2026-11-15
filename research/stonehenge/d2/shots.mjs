// node research/stonehenge/d2/shots.mjs  -> d2/shot-<name>-<year>.png (one browser session, setT + setCamera)
import { chromium } from "playwright-core";
import path from "node:path";
import { fileURLToPath } from "node:url";
const out = path.dirname(fileURLToPath(import.meta.url));
const years = (process.env.YEARS ?? "-3500,-2900,-2400,-1800,500,1625").split(",").map(Number);
const cams = {
  stones: { p: [0, 150, 55], t: [0, 41.5, 0] },
  stones3: { p: [-45, 38, 85], t: [0, 43, 0] },
  landscape: { p: [900, 2600, 2400], t: [900, 32, -300] },
  east: { p: [2300, 700, 700], t: [2500, 36, -700] },
  dw: { p: [2650, 520, -1000], t: [2800, 36, -1400] },
  amesbury: { p: [2900, 420, 1250], t: [3000, 12, 700] },
  dwclose: { p: [2880, 260, -1120], t: [2885, 36, -1340] },
  barrows: { p: [-300, 800, 1900], t: [-300, 40, 900] },
};
const only = process.env.CAMS ? process.env.CAMS.split(",") : Object.keys(cams);
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1400, height: 800 } });
page.on("pageerror", (e) => console.error("PAGE ERROR", e.message));
const seen = new Set();
page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") { const t = m.text().slice(0, 400); if (!seen.has(t)) { seen.add(t); console.log("console:", t); } } });
await page.goto(`${process.env.LTT_URL ?? "http://127.0.0.1:4310"}/?site=stonehenge&year=2400%20BCE&quality=medium&ui=0&labels=0`);
await page.waitForFunction(() => window.__ltt && window.__ltt.getState().ready, null, { timeout: 90000 });
await page.waitForTimeout(2500);
for (const y of years) {
  const t = y < 0 ? y + 1 : y;
  for (const c of only) {
    await page.evaluate(([t, p, tg]) => { window.__ltt.setT(t + 0.5); window.__ltt.setCamera(p, tg); }, [t, cams[c].p, cams[c].t]);
    await page.waitForTimeout(3500);
    await page.screenshot({ path: path.join(out, `shot-${c}-${y}.png`) });
    console.log("shot", c, y);
  }
}
await browser.close();
