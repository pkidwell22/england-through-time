// Load timing for trees: page open -> scene ready -> scanned trees swapped in. node tests/tree-load.mjs london 1616
import { chromium } from "playwright-core";
const [site = "london", year = "1616", q = "high"] = process.argv.slice(2);
const BASE = process.env.LTT_URL ?? "http://127.0.0.1:4310";
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1500, height: 900 }, deviceScaleFactor: 1 });
const t0 = Date.now();
await page.goto(`${BASE}/?site=${site}&year=${encodeURIComponent(year)}&quality=${q}&ui=0`);
await page.waitForFunction(() => window.__ltt && window.__ltt.getState().ready, null, { timeout: 180000 });
const ready = Date.now() - t0;
await page.waitForFunction(() => window.__ltt.trees?.userData?.debug?.().scanned, null, { timeout: 120000, polling: 50 });
const trees = Date.now() - t0;
const d = await page.evaluate(() => window.__ltt.trees.userData.debug());
console.log(`${site} ${year} ${q}: ready ${ready} ms, scanned trees ${trees} ms, ${d.instances} trees`);
await browser.close();
