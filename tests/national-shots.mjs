// Screenshots of the national map. Usage: node tests/national-shots.mjs [name=query[@js]] ...
// With no arguments, takes the standard set into tests/national-shots/.
import { chromium } from "playwright-core";
import { fileURLToPath } from "node:url";
const BASE = process.env.LTT_URL ?? "http://127.0.0.1:4310";
const OUT = fileURLToPath(new URL("./national-shots/", import.meta.url));
const STANDARD = [
  ["y-3000", "map=1&year=-3000"], ["y0150", "map=1&year=150"], ["y0800", "map=1&year=800"], ["y1300", "map=1&year=1300"], ["y1600", "map=1&year=1600"],
  ["zoom-southeast-150", "map=1&year=150", "window.__nat.focusPlace('london', 260)"],
  ["zoom-wales-1300", "map=1&year=1300", "(()=>{const n=window.__nat;const [x,z]=n.toXZ(52.7,-3.6);n.setCamera([x+40,150,z+260],[x,0,z]);})()"],
  ["zoom-north-150-tilt", "map=1&year=150", "(()=>{const n=window.__nat;const [x,z]=n.toXZ(54.7,-2.4);n.setCamera([x-60,90,z+230],[x,0,z]);})()"],
  ["evidence-1300", "map=1&year=1300&evidence=1"],
  ["bare-1600", "map=1&year=1600&ui=0&labels=0&polities=0"],
  ["selected-london-1300", "map=1&year=1300&place=london", "document.querySelector('[data-testid=key-toggle]').click()"],
];
const jobs = process.argv.length > 2 ? process.argv.slice(2).map((a) => { const [name, rest] = a.split(/=(.*)/s); const [q, js] = rest.split(/@(.*)/s); return [name, q, js]; }) : STANDARD;
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on("pageerror", (e) => console.error("PAGE ERROR", e.message));
page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") console.log("console:", m.text().slice(0, 400)); });
for (const [name, query, js] of jobs) {
  await page.goto(`${BASE}/?${query}`);
  await page.waitForFunction(() => window.__nat && window.__nat.getState().ready, null, { timeout: 90000 });
  await page.waitForTimeout(900);
  if (js) { const r = await page.evaluate(js); if (r !== undefined) console.log(name, JSON.stringify(r)); await page.waitForTimeout(700); }
  await page.screenshot({ path: `${OUT}${name}.png` });
  console.log("saved", `${OUT}${name}.png`);
}
await browser.close();
