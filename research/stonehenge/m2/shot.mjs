// usage: node shot.mjs <setName> <surface> [viewFilter]
// Renders the earthwork test dataset (research/stonehenge/m2/data.mjs) from a list of cameras.
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { build } from "./data.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const [, , setName = "all", surface = "turf", filter = ""] = process.argv;
const BASE = process.env.LTT_URL ?? "http://127.0.0.1:4310";
const { files, views, stats } = build(setName, surface);
mkdirSync(join(here, "shots"), { recursive: true });

const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1500, height: 880 } });
page.on("pageerror", (e) => console.error("PAGE ERROR", e.message));
page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") console.log("console:", m.text().slice(0, 400)); });
await page.goto(`${BASE}/?site=stonehenge&ui=0&labels=0&quality=high&year=2400%20BCE${process.env.GROUND === "0" ? "&ground=0" : ""}`);
await page.waitForFunction(() => window.__ltt && window.__ltt.getState().ready, null, { timeout: 90000 });
await page.waitForTimeout(1000);
await page.evaluate(() => { window.__oldEngine = window.__ltt; });
const t0 = Date.now();
const res = await page.evaluate(async (f) => await window.__lttOpen(f), files);
console.log("validate:", JSON.stringify(res).slice(0, 600));
await page.waitForFunction(() => window.__ltt && window.__ltt !== window.__oldEngine && window.__ltt.getState().ready, null, { timeout: 90000 });
console.log("rebuilt in", Date.now() - t0, "ms");
await page.waitForTimeout(7000);
if (stats) {
  const tri = await page.evaluate(() => {
    const out = {};
    window.__ltt.scene.traverse((o) => {
      if (!o.isMesh) return;
      let g = o.parent; while (g && !(g.name || "").includes("#")) g = g.parent;
      const key = g ? g.name : "other";
      if (key === "other") return;
      const geo = o.geometry; const n = geo.index ? geo.index.count / 3 : geo.attributes.position.count / 3;
      out[key] = (out[key] || 0) + n;
    });
    return out;
  });
  console.log("TRIANGLES", JSON.stringify(tri));
}
for (const v of views) {
  if (filter && !filter.split(",").includes(v.name)) continue;
  await page.evaluate(([p, t]) => window.__ltt.setCamera(p, t), [v.pos, v.target]);
  await page.waitForTimeout(1800);
  if (process.env.DBG) console.log(v.name, JSON.stringify(await page.evaluate(() => window.__ltt.getCamera())));
  const out = join(here, "shots", `${setName}-${surface}-${v.name}.png`);
  await page.screenshot({ path: out });
  console.log("shot", out);
}
await browser.close();
