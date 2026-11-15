// National map frame cost and load time on this machine, at a chosen device scale (default 2, a Retina display).
// Usage: node scripts/national/perf.mjs [--dsf=2]   (needs the dev server; run on a quiet machine)
import { chromium } from "playwright-core";
const BASE = process.env.LTT_URL ?? "http://127.0.0.1:4310";
const dsf = +(process.argv.find((a) => a.startsWith("--dsf="))?.slice(6) ?? 2);
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
const views = {
  whole: "window.__nat.resetView()",
  southeast: "(()=>{const p=window.__natData.places.find(x=>x.id==='london');const [x,z]=window.__nat.toXZ(p.lat,p.lon);window.__nat.setCamera([x+20,150,z+170],[x,0,z]);})()",
  snowdonia: "(()=>{const [x,z]=window.__nat.toXZ(53.05,-4.05);window.__nat.setCamera([x-30,70,z+90],[x,0,z]);})()",
};
for (const q of ["low", "medium", "high"]) {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: dsf });
  const page = await ctx.newPage();
  const t0 = Date.now();
  await page.goto(`${BASE}/?map=1&year=1300&quality=${q}`);
  await page.waitForFunction(() => window.__nat && window.__nat.getState().ready && document.querySelector('[data-testid="year-readout"]'), null, { timeout: 120000 });
  const load = Date.now() - t0;
  const out = [];
  for (const [name, js] of Object.entries(views)) {
    await page.evaluate(js);
    await page.waitForTimeout(1500);
    const r = await page.evaluate(async () => {
      const b = [];
      for (let i = 0; i < 3; i++) b.push(window.__nat.benchmark(30).msPerFrame);
      const raf = await new Promise((res) => { let n = 0; const s = performance.now(); const f = (t) => { n++; if (t - s >= 1500) res((n * 1000) / (t - s)); else requestAnimationFrame(f); }; requestAnimationFrame(f); });
      const st = window.__nat.stats();
      return { benchMs: Math.min(...b), rafFps: +raf.toFixed(1), tris: st.triangles, dpr: st.pixelRatio };
    });
    out.push(`${name} ${r.benchMs}ms raf ${r.rafFps} tris ${r.tris} dpr ${r.dpr}`);
  }
  console.log(`${q} load ${load}ms | ` + out.join(" | "));
  await ctx.close();
}
await browser.close();
