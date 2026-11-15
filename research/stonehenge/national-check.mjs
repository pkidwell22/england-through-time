import { chromium } from "playwright-core";
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
await page.goto("http://127.0.0.1:4310/?map=1&place=stonehenge&year=2400%20BCE", { timeout: 120000, waitUntil: "domcontentloaded" });
await page.waitForSelector('[data-testid="enter-site"]', { timeout: 120000 }).catch(() => null);
const txt = await page.evaluate(() => { const b = document.querySelector('[data-testid="enter-site"]'); return b ? { text: b.textContent, disabled: b.disabled } : null; });
console.log("enter-site:", JSON.stringify(txt));
await page.screenshot({ path: "research/stonehenge/national-stonehenge.png" });
if (txt) {
  await page.click('[data-testid="enter-site"]');
  await page.waitForFunction(() => window.__ltt && window.__ltt.getState().ready && window.__lttData?.site?.id === "stonehenge", null, { timeout: 120000 }).then(() => console.log("entered stonehenge viewer")).catch((e) => console.log("enter failed", e.message));
}
await browser.close();
