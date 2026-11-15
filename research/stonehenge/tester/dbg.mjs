import { chromium } from "playwright-core";
const b = await chromium.launch({ channel: "chrome", headless: true, args: ["--use-angle=metal","--enable-gpu","--ignore-gpu-blocklist"] });
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
p.on("console", m => { if (m.type()==="error") console.log("CONSOLE", m.text().slice(0,300)); });
p.on("pageerror", e => console.log("PAGEERR", e.message.slice(0,300)));
p.on("crash", () => console.log("CRASH"));
await p.goto("http://127.0.0.1:4310/?site=stonehenge", { waitUntil: "domcontentloaded" });
await p.waitForFunction(() => window.__ltt && window.__ltt.getState().ready, null, { timeout: 120000 });
for (const id of ["stonehenge-midwinter-sunset-2500bce","stonehenge-raising-sarsens"]) {
  await p.evaluate(() => { window.__ltt.resetView(); window.__ltt.setT(-2999.5); });
  await p.waitForTimeout(300);
  await p.locator('[data-testid="event-select"]').selectOption(id);
  await p.waitForTimeout(1500);
  console.log(id, await p.evaluate(() => ({ ro: !!document.querySelector('[data-testid="year-readout"]'), inp: !!document.querySelector('[data-testid="year-input"]'), body: document.body.innerText.slice(0,200) })));
}
await b.close();
