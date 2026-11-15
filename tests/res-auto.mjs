// Automatic resolution: node tests/res-auto.mjs   (dev server on 127.0.0.1:4310)
// A deliberately heavy case (Cinematic on a large 2x screen) must settle at a lower pixel ratio and a steadier frame
// time; ?res=fixed and automated runs without ?res must stay at the tier's full ratio.
import { chromium } from "playwright-core";
const BASE = process.env.LTT_BASE ?? "http://127.0.0.1:4310";
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
let fail = 0;
const check = (name, ok, detail) => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  (" + detail + ")" : ""}`); if (!ok) fail++; };
const run = async (res, secs) => {
  const page = await browser.newPage({ viewport: { width: 2200, height: 1300 }, deviceScaleFactor: 2 });
  await page.goto(`${BASE}/?site=london&year=1616&view=overview&quality=cinematic&ui=0${res ? "&res=" + res : ""}`);
  await page.waitForFunction(() => window.__ltt && window.__ltt.stats().triangles > 0, null, { timeout: 180000 });
  const log = [];
  for (let i = 0; i < secs; i++) { await page.waitForTimeout(1000); const s = await page.evaluate(() => window.__ltt.stats()); log.push([+s.pixelRatio.toFixed(2), s.frameMs]); }
  await page.close();
  return log;
};
const auto = await run("auto", 22);
console.log("auto :", auto.map(([p, f]) => `${p}@${f}ms`).join(" "));
const fixed = await run("fixed", 8);
console.log("fixed:", fixed.map(([p, f]) => `${p}@${f}ms`).join(" "));
const plain = await run("", 6);
check("auto lowers the pixel ratio when frames run late", auto.at(-1)[0] < 2 || auto.every(([, f]) => f < 24), `ended at ${auto.at(-1)[0]}`);
check("auto never goes below 0.75", auto.every(([p]) => p >= 0.75));
check("auto ends with frames on time or at the floor", auto.at(-1)[1] < 26 || auto.at(-1)[0] <= 0.76, `${auto.at(-1)[1]} ms`);
check("fixed keeps the tier's ratio", fixed.every(([p]) => p === 2));
check("an automated run without ?res keeps the tier's ratio", plain.every(([p]) => p === 2));
await browser.close();
process.exit(fail ? 1 : 0);
