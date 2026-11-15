import { chromium } from "playwright-core";
const [dpr = "1", ...variants] = process.argv.slice(2);
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
const out = {};
for (let round = 0; round < 3; round++) for (const v of variants) {
  const page = await browser.newPage({ viewport: { width: 1500, height: 900 }, deviceScaleFactor: +dpr });
  await page.goto(`http://127.0.0.1:4310/?${v}&quality=high&ui=0`, { timeout: 180000 });
  await page.waitForFunction(() => window.__ltt && window.__ltt.stats && window.__ltt.stats().triangles > 0, null, { timeout: 180000 });
  await page.waitForTimeout(9000);
  const ms = await page.evaluate(async () => { const e = window.__ltt; e.benchmark(10); const xs = []; for (let i = 0; i < 4; i++) { xs.push(e.benchmark(40).msPerFrame); await new Promise((q) => setTimeout(q, 150)); } return Math.min(...xs); });
  (out[v] ||= []).push(+ms.toFixed(2));
  await page.close();
}
console.log(JSON.stringify(out, null, 1));
await browser.close();
