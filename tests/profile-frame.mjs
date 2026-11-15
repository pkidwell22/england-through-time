// CPU profile of steady-state frames: node tests/profile-frame.mjs london 1616 high overview 2
// Splits each frame into script time and time blocked waiting for the GPU (the 1-pixel readback).
import { chromium } from "playwright-core";
const [site = "london", year = "1616", q = "high", view = "", dpr = "1"] = process.argv.slice(2);
const BASE = process.env.LTT_BASE ?? "http://127.0.0.1:4310";
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1500, height: 900 }, deviceScaleFactor: +dpr });
await page.goto(`${BASE}/?site=${site}&year=${encodeURIComponent(year)}${view ? `&view=${view}` : ""}&quality=${q}&ui=0`);
await page.waitForFunction(() => window.__ltt && window.__ltt.stats && window.__ltt.stats().triangles > 0, null, { timeout: 180000 });
await page.waitForTimeout(3500);
await page.evaluate(() => window.__ltt.benchmark(10));
const cdp = await page.context().newCDPSession(page);
await cdp.send("Profiler.enable");
await cdp.send("Profiler.setSamplingInterval", { interval: 200 });
await cdp.send("Profiler.start");
const N = 60;
const r = await page.evaluate((n) => ({ ms: window.__ltt.benchmark(n).msPerFrame, s: window.__ltt.stats() }), N);
const { profile } = await cdp.send("Profiler.stop");
await browser.close();
const byId = new Map(profile.nodes.map((n) => [n.id, n]));
const parent = new Map();
for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
const key = (n) => `${n.callFrame.functionName || "(anon)"} ${n.callFrame.url.split("/").slice(-2).join("/").split("?")[0]}:${n.callFrame.lineNumber + 1}`;
const selfBy = new Map(), totBy = new Map();
profile.samples.forEach((id, i) => {
  const ms = profile.timeDeltas[i] / 1000 / N;
  const k = key(byId.get(id));
  selfBy.set(k, (selfBy.get(k) ?? 0) + ms);
  const seen = new Set();
  for (let p = id; p != null; p = parent.get(p)) { const kk = key(byId.get(p)); if (!seen.has(kk)) { seen.add(kk); totBy.set(kk, (totBy.get(kk) ?? 0) + ms); } }
});
const top = (m, n) => [...m].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${v.toFixed(2).padStart(7)} ms  ${k}`).join("\n");
console.log(`${site} ${view} ${year} ${q} dpr ${dpr}: ${r.ms} ms/frame, ${r.s.calls} calls, ${(r.s.triangles / 1e6).toFixed(2)} M tris, canvas ${r.s.size} x${r.s.pixelRatio}\n\nSELF per frame\n${top(selfBy, 22)}\n\nTOTAL per frame\n${top(totBy, 45)}`);
