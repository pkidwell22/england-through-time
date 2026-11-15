// CPU profile of a site's load: node tests/profile-load.mjs stonehenge "2400 BCE" [quality]
// Prints the functions with the most self time and the most total time (dev server on 127.0.0.1:4310).
import { chromium } from "playwright-core";
const [site = "london", year = "1616", q = "high"] = process.argv.slice(2);
const BASE = process.env.LTT_BASE ?? "http://127.0.0.1:4310";
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1500, height: 900 }, deviceScaleFactor: 1 });
const cdp = await page.context().newCDPSession(page);
await cdp.send("Profiler.enable");
await cdp.send("Profiler.setSamplingInterval", { interval: 1000 });
await cdp.send("Profiler.start");
const t0 = Date.now();
await page.goto(`${BASE}/?site=${site}&year=${encodeURIComponent(year)}&quality=${q}&ui=0`);
await page.waitForFunction(() => window.__ltt && window.__ltt.stats && window.__ltt.stats().triangles > 0, null, { timeout: 180000 });
const loadMs = Date.now() - t0;
const { profile } = await cdp.send("Profiler.stop");
await browser.close();
const byId = new Map(profile.nodes.map((n) => [n.id, n]));
const self = new Map();
const dt = profile.timeDeltas; let total = 0;
profile.samples.forEach((id, i) => { const d = dt[i] / 1000; total += d; self.set(id, (self.get(id) ?? 0) + d); });
const parent = new Map();
for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
const key = (n) => `${n.callFrame.functionName || "(anon)"} ${n.callFrame.url.split("/").slice(-2).join("/").split("?")[0]}:${n.callFrame.lineNumber + 1}`;
const selfBy = new Map(), totBy = new Map();
for (const [id, ms] of self) {
  const n = byId.get(id); const k = key(n);
  selfBy.set(k, (selfBy.get(k) ?? 0) + ms);
  const seen = new Set();
  for (let p = id; p != null; p = parent.get(p)) { const kk = key(byId.get(p)); if (!seen.has(kk)) { seen.add(kk); totBy.set(kk, (totBy.get(kk) ?? 0) + ms); } }
}
const top = (m, n) => [...m].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${v.toFixed(0).padStart(7)} ms  ${k}`).join("\n");
console.log(`${site} ${year} ${q}: ready in ${loadMs} ms, ${total.toFixed(0)} ms sampled\n\nSELF\n${top(selfBy, 30)}\n\nTOTAL\n${top(totBy, 70)}`);
