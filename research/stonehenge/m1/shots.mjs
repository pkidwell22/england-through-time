import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.LTT_URL ?? "http://127.0.0.1:4310";
const which = process.argv.slice(2);
const site = JSON.parse(fs.readFileSync(path.join(here, "test-site.json"), "utf8"));
const landmarks = JSON.parse(fs.readFileSync(path.join(here, "test-landmarks.json"), "utf8"));
const polar = (az, r, y) => [r * Math.sin(az * Math.PI / 180), y, -r * Math.cos(az * Math.PI / 180)];
const SHOTS = {
  low: [polar(225, 25, 43.2), [-10.9, 41.8, 10.9]],
  low2: [polar(300, 24, 43.3), polar(300, 15.4, 42)],
  far: [polar(200, 40, 55), [0, 43, 0]],
  top: [[0.5, 120, 0.5], [0, 40, 0]],
  inside: [[-3, 43, 5], [9, 44, -9]],
  tri: [polar(60, 18, 43.5), polar(230, 7.4, 43)],
  heel: [polar(51, 55, 43), polar(51, 77, 42)],
  fall: [polar(215, 24, 43.5), polar(215, 15, 41)],
  heelside: [[40, 44, -75], polar(51, 77, 42)],
  sloped: [polar(100, 30, 47), [0, 42, 0]],
  lint: [polar(250, 20, 44), polar(250, 15.4, 44)],
  blue: [polar(120, 8, 42.4), polar(120, 11.6, 41.6)],
};
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on("pageerror", (e) => console.error("PAGE ERROR", e.message));
page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") console.log("console:", m.text().slice(0, 300)); });
await page.goto(`${BASE}/?site=stonehenge&ui=0&labels=0&quality=high&year=2400%20BCE`);
await page.waitForFunction(() => window.__ltt && window.__ltt.getState().ready, null, { timeout: 90000 });
await page.evaluate(() => { window.__old = window.__ltt; });
const probs = await page.evaluate(({ site, landmarks }) => window.__lttOpen({ site, landmarks }), { site, landmarks });
if (probs.length) console.log("validator:", probs.slice(0, 5));
await page.waitForFunction(() => window.__ltt && window.__ltt !== window.__old && window.__ltt.getState().ready, null, { timeout: 90000 });
await page.waitForTimeout(3500);
const info = await page.evaluate(() => {
  const e = window.__ltt; let tris = 0, byMat = {};
  e.landmarks?.root?.traverse?.((o) => { if (o.isMesh) { const g = o.geometry; const n = (g.index ? g.index.count : g.attributes.position.count) / 3; tris += n; byMat[o.material.name || o.material.type] = (byMat[o.material.name || o.material.type] || 0) + n; } });
  return { tris, byMat, keys: Object.keys(e).slice(0, 30) };
});
console.log(JSON.stringify(info));
for (const name of which.length ? which : Object.keys(SHOTS)) {
  const [p, t] = SHOTS[name];
  await page.evaluate(([p, t]) => window.__ltt.setCamera(p, t), [p, t]);
  await page.waitForTimeout(1800);
  await page.screenshot({ path: path.join(here, `${process.env.PREFIX ?? ""}${name}.png`) });
  console.log("shot", name);
}
await browser.close();
