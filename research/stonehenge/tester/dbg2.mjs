import { chromium } from "playwright-core";
const b = await chromium.launch({ channel: "chrome", headless: true, args: ["--use-angle=metal","--enable-gpu","--ignore-gpu-blocklist"] });
for (const id of ["robin-hoods-ball-3550bce"]) {
const p = await b.newPage({ viewport: { width: 1500, height: 900 } });
p.on("pageerror", e => console.log("PAGEERR", e.message.slice(0,300)));
await p.goto("http://127.0.0.1:4310/?site=stonehenge&event="+id, { waitUntil: "domcontentloaded" });
await p.waitForFunction(() => window.__ltt && window.__ltt.getState().ready, null, { timeout: 120000 });
for (let i=0;i<4;i++){ await p.waitForTimeout(1500);
console.log(id, i, await p.evaluate(() => ({ body: document.body.innerText.slice(0,150),  ro: document.querySelector('[data-testid="year-readout"]')?.innerText, inp: !!document.querySelector('[data-testid="year-input"]'), act: document.activeElement?.tagName })));}
await p.close();}
await b.close();
