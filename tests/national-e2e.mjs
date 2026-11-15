// End-to-end checks for the national map of England and Wales against a running server (default http://127.0.0.1:4310).
// Usage: node tests/national-e2e.mjs [--no-perf] [--only=<substring of group name>]
// Writes tests/national-results.json. Exit code 1 if any check fails.
// A group with failures is re-run once (the dev server can hot-reload while another agent edits src/);
// the first attempt's failures are kept in results.retried so flaky groups stay visible.
import { chromium } from "playwright-core";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.LTT_URL ?? "http://127.0.0.1:4310";
const NO_PERF = process.argv.includes("--no-perf");
const ONLY = process.argv.find((a) => a.startsWith("--only="))?.slice(7);
const ARGS = ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"];
const VIEWPORT = { width: 1600, height: 900 };

let results = [];
let group = "";
let groupBuf = [];
function record(name, pass, detail = "") {
  const r = { group, name, pass: !!pass, detail: String(detail) };
  results.push(r);
  groupBuf.push(r);
  console.log(`${pass ? "PASS" : "FAIL"}  [${group}] ${name}${detail ? "  — " + detail : ""}`);
}
const info = [];
function note(name, detail) {
  info.push({ group, name, detail });
  console.log(`INFO  [${group}] ${name}  — ${typeof detail === "string" ? detail : JSON.stringify(detail)}`);
}
const retried = [];
let reloadSuspected = false;
async function inGroup(name, fn) {
  if (ONLY && !name.toLowerCase().includes(ONLY.toLowerCase())) return;
  group = name;
  for (let attempt = 1; attempt <= 2; attempt++) {
    groupBuf = [];
    reloadSuspected = false;
    try {
      await ensureMain();
      await fn();
    } catch (e) {
      record("group ran to completion", false, e && e.stack ? e.stack.split("\n").slice(0, 3).join(" | ") : String(e));
    }
    const bad = groupBuf.filter((r) => !r.pass);
    if (!bad.length) return;
    if (attempt === 1) {
      const looksReload = reloadSuspected;
      retried.push({ group: name, looksLikeHotReload: looksReload, firstAttemptFailures: bad.map((b) => ({ name: b.name, detail: b.detail.slice(0, 300) })) });
      console.log(`RETRY [${name}] ${bad.length} failure(s) on first attempt${looksReload ? " (page reload/HMR seen during the group)" : ""}; re-running once`);
      results = results.filter((r) => !groupBuf.includes(r));
    }
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ channel: "chrome", headless: true, args: ARGS });

function trackReload(page) {
  page.on("framenavigated", (f) => { if (f === page.mainFrame()) reloadSuspected = reloadSuspected || page.__navExpected !== true ? reloadSuspected : reloadSuspected; });
  page.on("console", (m) => { if (/\[Fast Refresh\]|Fast Refresh had to perform a full reload|\[HMR\]/i.test(m.text())) reloadSuspected = true; });
}
async function openPage(urlPath = "/?map=1", opts = {}) {
  const ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: opts.dsf ?? 1 });
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  const errors = [];
  const warnings = [];
  page.on("pageerror", (e) => errors.push({ kind: "pageerror", text: e.message }));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push({ kind: "console.error", text: m.text().slice(0, 400), url: m.location()?.url });
    if (m.type() === "warning") warnings.push(m.text().slice(0, 600));
  });
  page.on("requestfailed", (r) => errors.push({ kind: "requestfailed", text: `${r.url()} ${r.failure()?.errorText}` }));
  page.on("response", (r) => { if (r.status() >= 400) errors.push({ kind: "http", text: `${r.status()} ${r.url()}` }); });
  trackReload(page);
  await page.goto(`${BASE}${urlPath}`, { timeout: 120000 });
  if (opts.kind === "site") await siteReady(page);
  else if (opts.kind === "bare") await page.waitForFunction(() => window.__nat && window.__nat.getState().ready, null, { timeout: 120000 });
  else await natReady(page);
  await page.evaluate(() => { window.__testMarker = 1; });
  await page.waitForTimeout(opts.settle ?? 800);
  return { page, ctx, errors, warnings };
}
const natReady = (page) => page.waitForFunction(() => window.__nat && window.__nat.getState().ready && window.__natData && document.querySelector('[data-testid="year-readout"]'), null, { timeout: 120000 });
const siteReady = (page) => page.waitForFunction(() => window.__ltt && window.__ltt.getState().ready && document.querySelector('[data-testid="year-readout"]'), null, { timeout: 150000 });

const tid = (id) => `[data-testid="${id}"]`;
const readout = (page) => page.locator(tid("year-readout")).innerText();
const eraName = (page) => page.locator(tid("era-name")).innerText();
const getT = (page) => page.evaluate(() => window.__nat.getT());
const getCam = (page) => page.evaluate(() => window.__nat.getCamera());
const state = (page) => page.evaluate(() => window.__nat.getState());
const settle = (page, ms = 250) => page.waitForTimeout(ms);
function camDiff(a, b) {
  let d = 0;
  for (let i = 0; i < 3; i++) d = Math.max(d, Math.abs(a.position[i] - b.position[i]), Math.abs(a.target[i] - b.target[i]));
  return d;
}
async function setSlider(page, u) {
  await page.locator(tid("year-slider")).evaluate((el, v) => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    set.call(el, String(v));
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }, u);
  await settle(page);
}
async function typeYear(page, text) {
  await page.locator(tid("year-readout")).click();
  const inp = page.locator(tid("year-input"));
  await inp.waitFor({ timeout: 3000 });
  await inp.fill(text);
  await inp.press("Enter");
  await page.locator(tid("year-readout")).waitFor({ timeout: 3000 });
  await settle(page);
}
const histToT = (y) => (y < 0 ? y + 1 : y);
const fmt = (y) => (y < 0 ? `${-y} BCE` : `${y} CE`);
const isFavicon = (e) => /favicon\.ico/.test(e.url ?? "") || /favicon\.ico/.test(e.text);

async function samplePng(buf, grid = 24) {
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  const out = await p.evaluate(async ({ b64, grid }) => {
    const img = new Image();
    img.src = "data:image/png;base64," + b64;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.width; c.height = img.height;
    const g = c.getContext("2d");
    g.drawImage(img, 0, 0);
    const colours = new Set();
    let min = 255, max = 0;
    for (let i = 0; i < grid; i++) for (let j = 0; j < grid; j++) {
      const x = Math.floor(((i + 0.5) / grid) * img.width), y = Math.floor(((j + 0.5) / grid) * img.height);
      const d = g.getImageData(x, y, 1, 1).data;
      colours.add(`${d[0] >> 2},${d[1] >> 2},${d[2] >> 2}`);
      const l = (d[0] + d[1] + d[2]) / 3;
      min = Math.min(min, l); max = Math.max(max, l);
    }
    return { distinct: colours.size, lumRange: max - min, w: img.width, h: img.height };
  }, { b64: buf.toString("base64"), grid });
  await ctx.close();
  return out;
}

// ======================================================================================
let main = await openPage("/");
let mainReloads = 0;
const loadErrors = main.errors.slice();
const loadWarnings = main.warnings.slice();
async function ensureMain() {
  const alive = await main.page.evaluate(() => window.__testMarker === 1 && !!window.__nat && window.__nat.getState().ready && !!document.querySelector('[data-testid="year-readout"]')).catch(() => false);
  if (!alive) {
    reloadSuspected = true;
    mainReloads++;
    console.log("NOTE  main page lost its state (reload/HMR or navigation); reopening");
    await main.ctx.close().catch(() => {});
    main = await openPage("/?map=1");
  } else {
    await main.page.evaluate(() => { window.__nat.pause(); window.__nat.setSpeed(5, 1); });
  }
}
// Fresh references each group, since main may be replaced.
const P = () => main.page;
const natData = () => P().evaluate(() => ({ eras: window.__natData.eras, timeline: window.__natData.site.timeline, bounds: window.__natData.site.bounds }));

await inGroup("1 load", async () => {
  const page = P();
  const real = loadErrors.filter((e) => !isFavicon(e));
  record("no page errors / console errors / failed requests on load (favicon aside)", real.length === 0, JSON.stringify(real).slice(0, 600));
  record("no console error for a missing /favicon.ico", loadErrors.filter(isFavicon).length === 0, JSON.stringify(loadErrors.filter(isFavicon)));
  const probs = loadWarnings.filter((w) => /National dataset has|duplicate .* id|unexpected shape|placeholder/i.test(w));
  record("loader reports no dataset problems / placeholders (console warnings)", probs.length === 0, probs.join(" || ").slice(0, 1500));
  if (loadWarnings.length) note("console warnings on load", loadWarnings.map((w) => w.slice(0, 300)));
  const st = await state(page);
  record("engine ready", st.ready === true);
  record('bare "/" opens the national map', await page.evaluate(() => !!window.__nat && !window.__ltt));
  record('no "stub" notice shown (data-testid=stub-note)', (await page.locator(tid("stub-note")).count()) === 0, await page.locator(tid("stub-note")).allInnerTexts().then((x) => x.join("|")).catch(() => ""));
  const stats = await page.evaluate(() => window.__nat.stats());
  record("terrain is real data, not procedural stand-in", stats.terrain.procedural === false, JSON.stringify(stats.terrain));
  note("dataset size", await page.evaluate(() => ({ places: window.__natData.places.length, lines: window.__natData.lines.length, polities: window.__natData.polities.length, events: window.__natData.events.length, sources: Object.keys(window.__natData.sources).length })));
  note("initial stats", { places: stats.places, placesVisible: stats.placesVisible, lines: stats.lines, linesVisible: stats.linesVisible, polities: stats.polities, politiesVisible: stats.politiesVisible, labels: stats.labels, woodland: stats.woodland, seaLevel: stats.seaLevel });
  record("initial year is the last era's preset (1616 CE)", (await readout(page)) === "1616 CE", await readout(page));
  record("one WebGL canvas in the stage", (await page.locator(`${tid("stage")} canvas`).count()) === 1);
  const shot = await page.screenshot({ clip: { x: 350, y: 180, width: 700, height: 420 } });
  const s = await samplePng(shot);
  record("canvas is non-blank (screenshot pixel sample)", s.distinct >= 12 && s.lumRange > 20, JSON.stringify(s));
  await page.evaluate(() => window.__nat.setT(-3999));
  await settle(page, 700);
  const s2 = await samplePng(await page.screenshot({ clip: { x: 350, y: 180, width: 700, height: 420 } }));
  record("canvas is non-blank at 4000 BCE", s2.distinct >= 8 && s2.lumRange > 15, JSON.stringify(s2));
  const gl = await page.evaluate(() => {
    const c = document.querySelector('[data-testid="stage"] canvas');
    const g = c.getContext("webgl2") || c.getContext("webgl");
    const ext = g && g.getExtension("WEBGL_debug_renderer_info");
    return { lost: g ? g.isContextLost() : null, renderer: ext ? g.getParameter(ext.UNMASKED_RENDERER_WEBGL) : null, w: c.width, h: c.height };
  });
  note("WebGL renderer", gl);
  record("WebGL context alive", gl.lost === false, JSON.stringify(gl));
  record("fps readout shows a number", /^\d+ fps$/.test((await page.locator(tid("fps")).innerText()).trim()), await page.locator(tid("fps")).innerText());
  const noScript = main.errors.filter((e) => !isFavicon(e));
  record("no page errors so far in the main page", noScript.length === 0, JSON.stringify(noScript).slice(0, 500));
});

await inGroup("2 timeline endpoints", async () => {
  const page = P();
  const slider = page.locator(tid("year-slider"));
  await slider.focus();
  await page.keyboard.press("Home");
  await settle(page);
  record('slider min (Home) → "4000 BCE"', (await readout(page)) === "4000 BCE", await readout(page));
  record("t at min is -3999", (await getT(page)) === -3999, String(await getT(page)));
  await page.keyboard.press("End");
  await settle(page);
  record('slider max (End) → "1625 CE"', (await readout(page)) === "1625 CE", await readout(page));
  record("t at max is 1625", (await getT(page)) === 1625, String(await getT(page)));
  record('timeline ends labelled "4000 BCE" and "1625 CE"', await page.locator(".ends span").first().innerText() === "4000 BCE" && await page.locator(".ends span").last().innerText() === "1625 CE", await page.locator(".ends").innerText().then((t) => t.replace(/\n/g, "|")));
  await setSlider(page, 0);
  record('slider value 0 → "4000 BCE"', (await readout(page)) === "4000 BCE", await readout(page));
  await setSlider(page, 1);
  record('slider value 1 → "1625 CE"', (await readout(page)) === "1625 CE", await readout(page));
  // anchors: 43 CE at u=.14; 410 at .36 → midpoint u=.25 → t = 43 + .5*(410-43)=226.5 → 226 CE
  await setSlider(page, 0.25);
  record('slider value 0.25 → "226 CE"', (await readout(page)) === "226 CE", await readout(page));
  const sv = await slider.evaluate((el) => ({ value: +el.value, text: el.getAttribute("aria-valuetext") }));
  record("slider thumb and aria-valuetext follow the year", Math.abs(sv.value - 0.25) < 1e-3 && sv.text === "226 CE", JSON.stringify(sv));
  await page.evaluate(() => window.__nat.setT(99999));
  await settle(page);
  record("setT(99999) clamps to 1625", (await getT(page)) === 1625 && (await readout(page)) === "1625 CE", `${await getT(page)} ${await readout(page)}`);
  await page.evaluate(() => window.__nat.setT(-99999));
  await settle(page);
  record("setT(-99999) clamps to 4000 BCE", (await getT(page)) === -3999 && (await readout(page)) === "4000 BCE", `${await getT(page)} ${await readout(page)}`);
  await typeYear(page, "9999");
  record('typing "9999" clamps to "1625 CE"', (await readout(page)) === "1625 CE", await readout(page));
  await typeYear(page, "9999 BCE");
  record('typing "9999 BCE" clamps to "4000 BCE"', (await readout(page)) === "4000 BCE", await readout(page));
  await typeYear(page, "1066");
  record('typed "1066" works', (await readout(page)) === "1066 CE" && (await getT(page)) === 1066, `${await readout(page)} t=${await getT(page)}`);
  await typeYear(page, "garbage");
  record("typed garbage leaves the year unchanged", (await readout(page)) === "1066 CE", await readout(page));
  await typeYear(page, "2500 BCE");
  record('typed "2500 BCE" works', (await readout(page)) === "2500 BCE", await readout(page));
});

await inGroup("3 BCE/CE transition", async () => {
  const page = P();
  const seq = [];
  for (let t = -2; t <= 2.0001; t += 0.5) {
    await page.evaluate((v) => window.__nat.setT(v), t);
    await settle(page, 200);
    seq.push([t, await readout(page)]);
  }
  const labels = seq.map((x) => x[1]);
  const expected = ["3 BCE", "3 BCE", "2 BCE", "2 BCE", "1 BCE", "1 BCE", "1 CE", "1 CE", "2 CE"];
  record("readout sequence across the boundary", JSON.stringify(labels) === JSON.stringify(expected), JSON.stringify(seq));
  record('no "0" year label', !labels.some((l) => /^0\b/.test(l)), labels.join(", "));
  const dedup = labels.filter((l, i) => i === 0 || l !== labels[i - 1]);
  record("…, 2 BCE, 1 BCE, 1 CE, 2 CE in order", dedup.slice(-4).join("|") === "2 BCE|1 BCE|1 CE|2 CE", dedup.join(" → "));
  await typeYear(page, "1 BCE");
  record('typed "1 BCE" → "1 BCE", t=0', (await readout(page)) === "1 BCE" && (await getT(page)) === 0, `${await readout(page)} t=${await getT(page)}`);
  await typeYear(page, "1 CE");
  record('typed "1 CE" → "1 CE", t=1', (await readout(page)) === "1 CE" && (await getT(page)) === 1, `${await readout(page)} t=${await getT(page)}`);
  await typeYear(page, "0");
  record('typed "0" is rejected', (await readout(page)) === "1 CE", await readout(page));
  await typeYear(page, "55 bc");
  record('typed "55 bc" → "55 BCE"', (await readout(page)) === "55 BCE", await readout(page));
  await typeYear(page, "AD 43");
  record('typed "AD 43" → "43 CE"', (await readout(page)) === "43 CE", await readout(page));
  await typeYear(page, "-1");
  record('typed "-1" → "1 BCE"', (await readout(page)) === "1 BCE", await readout(page));
  // slider sweep across the boundary: 43 CE anchor is u=.14, 1 BCE lies just below; sweep u .1370..0.1405
  const bad = [];
  const seen = new Set();
  for (let u = 0.1355; u <= 0.1405; u += 0.0001) {
    await setSlider(page, +u.toFixed(4));
    const r = await readout(page);
    seen.add(r);
    if (/^0 /.test(r)) bad.push([u, r]);
  }
  record("slider sweep across the boundary never shows year 0", bad.length === 0, JSON.stringify(bad));
  // keyboard stepping of the slider via ArrowRight never lands on year 0 either
  await typeYear(page, "50 BCE");
  await page.locator(tid("year-slider")).focus();
  const keyLabels = [];
  for (let i = 0; i < 40; i++) { await page.keyboard.press("ArrowRight"); keyLabels.push(await readout(page)); }
  record('slider ArrowRight stepping never shows "0 …"', !keyLabels.some((l) => /^0 /.test(l)), keyLabels.slice(0, 8).join(", ") + " …");
  const d = await natData();
  await page.evaluate(() => window.__nat.setT(0.5));
  await settle(page);
  const eraAtBoundary = d.eras.find((e) => histToT(e.from) <= 0.5 && 0.5 < histToT(e.to) + 1);
  record("era name at 1 BCE/1 CE boundary is the Iron Age", (await eraName(page)) === eraAtBoundary?.name, await eraName(page));
});

await inGroup("4 era presets", async () => {
  const page = P();
  const d = await natData();
  for (const e of d.eras) {
    const btn = page.locator(tid(`era-${e.id}`));
    let clickErr = "";
    await btn.click({ timeout: 4000 }).catch((err) => { clickErr = err.message.split("\n")[0]; });
    await settle(page, 350);
    const want = fmt(e.presetYear);
    const r = await readout(page), n = await eraName(page);
    record(`era-${e.id} → ${want}, "${e.name}"`, !clickErr && r === want && n === e.name, clickErr || `readout=${r} era=${n}`);
    record(`era-${e.id} button is highlighted`, await btn.evaluate((el) => el.classList.contains("on")));
  }
  const n = await page.locator('[data-testid^="era-"]:not([data-testid="era-name"])').count();
  record(`one button per era (${d.eras.length})`, n === d.eras.length, `buttons=${n}`);
  // era boundaries: first and last year of each era report that era
  for (const e of d.eras) {
    for (const [lab, y] of [["first", e.from], ["last", e.to]]) {
      await page.evaluate((t) => window.__nat.setT(t), histToT(y) + 0.5);
      await settle(page, 120);
      const nm = await eraName(page);
      if (nm !== e.name) record(`era boundary: ${lab} year ${fmt(y)} of "${e.name}" shows that era`, false, nm);
    }
  }
  record("era boundaries (first/last year of every era) show the right era", groupBuf.every((r) => r.pass));
});

await inGroup("5 playback", async () => {
  const page = P();
  const speedSel = page.locator(tid("speed-select"));
  const measure = async (ms) => {
    const a = await page.evaluate(() => ({ t: window.__nat.getT(), now: performance.now() }));
    await page.waitForTimeout(ms);
    const b = await page.evaluate(() => ({ t: window.__nat.getT(), now: performance.now() }));
    return { years: b.t - a.t, rate: (b.t - a.t) / ((b.now - a.now) / 1000) };
  };
  await typeYear(page, "1000");
  await speedSel.selectOption({ label: "5 yr/s" });
  let st = await state(page);
  record("speed select sets 5 yr/s", st.speed === 5 && st.rate === 1, JSON.stringify({ speed: st.speed, rate: st.rate }));
  await page.locator(tid("play-pause")).click();
  await page.waitForTimeout(400);
  st = await state(page);
  record("play-pause starts playback forwards", st.playing && st.direction === 1);
  const m5 = await measure(1500);
  record("5 yr/s plays at about 5 yr/s (±35%)", m5.rate > 3.25 && m5.rate < 6.75, `measured ${m5.rate.toFixed(2)} yr/s`);
  const rBefore = await readout(page);
  await page.waitForTimeout(600);
  record("year readout updates during playback", (await readout(page)) !== rBefore, `${rBefore} → ${await readout(page)}`);
  record("play-pause shows pause state while playing", (await page.locator(tid("play-pause")).getAttribute("aria-label")) === "Pause");
  await page.locator(tid("play-pause")).click();
  await page.waitForTimeout(150);
  const tp = await getT(page);
  await page.waitForTimeout(700);
  record("pause holds the year", !(await state(page)).playing && (await getT(page)) === tp, `t ${tp} → ${await getT(page)}`);
  await speedSel.selectOption({ label: "25 yr/s" });
  await page.locator(tid("forward")).click();
  await page.waitForTimeout(400);
  const m25 = await measure(1500);
  record("25 yr/s plays at about 25 yr/s (±35%)", m25.rate > 16.25 && m25.rate < 33.75, `measured ${m25.rate.toFixed(2)} yr/s`);
  record("changing speed changes the rate (25 vs 5 → ~5×)", m25.rate / m5.rate > 3 && m25.rate / m5.rate < 7.5, `ratio ${(m25.rate / m5.rate).toFixed(2)}`);
  await page.locator(tid("reverse")).click();
  await page.waitForTimeout(300);
  const mr = await measure(1000);
  st = await state(page);
  record("reverse decreases the year at about -25 yr/s (±35%)", mr.rate < -16.25 && mr.rate > -33.75 && st.direction === -1 && st.playing, `measured ${mr.rate.toFixed(2)} yr/s dir=${st.direction}`);
  await page.evaluate(() => window.__nat.pause());
  // Auto: whole timeline in 150 s at 1× → ~37 yr/s
  await typeYear(page, "1000");
  await speedSel.selectOption({ label: "Auto 1×" });
  await page.locator(tid("forward")).click();
  await page.waitForTimeout(300);
  const ma1 = await measure(1000);
  await speedSel.selectOption({ label: "Auto 2×" });
  await page.waitForTimeout(200);
  const ma2 = await measure(1000);
  await page.evaluate(() => window.__nat.pause());
  record("Auto 1× advances", ma1.years > 0, JSON.stringify(ma1));
  record("Auto 2× is about twice Auto 1× (±40%)", ma2.rate / ma1.rate > 1.2 && ma2.rate / ma1.rate < 2.8, `ratio ${(ma2.rate / ma1.rate).toFixed(2)}`);
  // Stops at 1625
  await speedSel.selectOption({ label: "25 yr/s" });
  await typeYear(page, "1615");
  await page.locator(tid("forward")).click();
  await page.waitForFunction(() => !window.__nat.getState().playing, null, { timeout: 8000 }).catch(() => {});
  await settle(page);
  st = await state(page);
  record("playback stops at 1625", !st.playing && st.t === 1625 && (await readout(page)) === "1625 CE", `playing=${st.playing} t=${st.t} readout=${await readout(page)}`);
  record("play button shows play state after stopping", (await page.locator(tid("play-pause")).getAttribute("aria-label")) === "Play");
  await page.locator(tid("play-pause")).click();
  await page.waitForTimeout(500);
  st = await state(page);
  record("pressing play at the end restarts from 4000 BCE", st.playing && st.t < -3900, `playing=${st.playing} t=${st.t}`);
  await page.evaluate(() => window.__nat.pause());
  // Stops at 4000 BCE
  await typeYear(page, "3990 BCE");
  await page.locator(tid("reverse")).click();
  await page.waitForFunction(() => !window.__nat.getState().playing, null, { timeout: 8000 }).catch(() => {});
  await settle(page);
  st = await state(page);
  record("reverse playback stops at 4000 BCE", !st.playing && st.t === -3999 && (await readout(page)) === "4000 BCE", `playing=${st.playing} t=${st.t} readout=${await readout(page)}`);
  await page.locator(tid("reverse")).click();
  await page.waitForTimeout(500);
  st = await state(page);
  record("pressing reverse at the start restarts from 1625", st.playing && st.t > 1600 && st.t < 1625, `playing=${st.playing} t=${st.t}`);
  await page.evaluate(() => window.__nat.pause());
  // Playback across the BCE/CE boundary never shows year 0
  await typeYear(page, "20 BCE");
  await speedSel.selectOption({ label: "5 yr/s" });
  await page.locator(tid("forward")).click();
  const seen = [];
  for (let i = 0; i < 16; i++) { seen.push(await readout(page)); await page.waitForTimeout(250); }
  await page.evaluate(() => window.__nat.pause());
  const dd = seen.filter((l, i) => i === 0 || l !== seen[i - 1]);
  record('playing through 1 BCE → 1 CE never shows "0"', !seen.some((l) => /^0 /.test(l)), dd.join(" → "));
  // Space bar
  await typeYear(page, "1200");
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  await page.keyboard.press("Space");
  await page.waitForTimeout(300);
  const sp1 = (await state(page)).playing;
  await page.keyboard.press("Space");
  await page.waitForTimeout(200);
  const sp2 = (await state(page)).playing;
  record("space bar toggles play/pause", sp1 === true && sp2 === false, `${sp1} → ${sp2}`);
  // setT(NaN) and friends
  const t0 = await getT(page);
  const before = main.errors.length;
  await page.evaluate(() => { window.__nat.setT(NaN); window.__nat.setT(Infinity); window.__nat.setT(undefined); window.__nat.setT("abc"); window.__nat.setSpeed(NaN); });
  await settle(page, 500);
  record("setT(NaN/Infinity/undefined/'abc') and setSpeed(NaN) are ignored", (await getT(page)) === t0 && Number.isFinite((await state(page)).speed) && main.errors.length === before, `t ${t0} → ${await getT(page)} errors=${JSON.stringify(main.errors.slice(before)).slice(0, 200)}`);
  await page.evaluate(() => window.__nat.setSpeed(5, 1));
});

await inGroup("6 camera preservation", async () => {
  const page = P();
  const cases = [["whole map", () => page.evaluate(() => window.__nat.resetView())], ["zoomed (focus London)", () => page.evaluate(() => window.__nat.focusPlace("london", 150))]];
  for (const [tag, setup] of cases) {
    await page.evaluate(() => window.__nat.pause());
    await setup();
    await typeYear(page, "1616");
    await settle(page, 400);
    const c0 = await getCam(page);
    const chk = async (what) => {
      const d = camDiff(c0, await getCam(page));
      record(`[${tag}] camera unchanged ${what}`, d < 1e-6, `diff=${d} year=${await readout(page)}`);
    };
    await setSlider(page, 0.3);
    await settle(page, 400);
    await chk("after slider change");
    await page.locator(tid("era-roman")).click();
    await settle(page, 400);
    await chk("after era preset");
    await typeYear(page, "55 BCE");
    await settle(page, 400);
    await chk("after typed year");
    await typeYear(page, "1000");
    await page.locator(tid("speed-select")).selectOption({ label: "25 yr/s" });
    await page.locator(tid("forward")).click();
    await page.waitForTimeout(2000);
    await page.locator(tid("play-pause")).click();
    await settle(page);
    const t = await getT(page);
    const d = camDiff(c0, await getCam(page));
    record(`[${tag}] camera unchanged after 2 s playback`, d < 1e-6 && t > 1030, `diff=${d} t=${t.toFixed(1)}`);
    await typeYear(page, "4000 BCE");
    await settle(page, 500);
    await chk("at 4000 BCE");
    await page.evaluate(() => window.__nat.setT(1500.5));
    await settle(page, 300);
    await chk("after setT (engine API)");
  }
  // reset view
  await page.evaluate(() => window.__nat.focusPlace("york", 120));
  await settle(page, 200);
  const zoomed = await getCam(page);
  await page.locator(tid("reset-view")).click();
  await settle(page, 500);
  const home = await getCam(page);
  record("reset view moves the camera away from a zoomed position", camDiff(zoomed, home) > 10, `diff=${camDiff(zoomed, home).toFixed(1)}`);
  await page.evaluate(() => window.__nat.focusPlace("london", 80));
  await page.locator(tid("reset-view")).click();
  await settle(page, 400);
  record("reset view returns to the same home camera from anywhere", camDiff(home, await getCam(page)) < 1e-3, `diff=${camDiff(home, await getCam(page))}`);
  // mouse orbit and wheel
  const d0 = await getCam(page);
  await page.mouse.move(600, 450);
  await page.mouse.down();
  await page.mouse.move(700, 470, { steps: 8 });
  await page.mouse.up();
  await settle(page, 500);
  record("mouse drag moves the camera", camDiff(d0, await getCam(page)) > 1, `diff=${camDiff(d0, await getCam(page)).toFixed(2)}`);
  await page.mouse.wheel(0, -600);
  await settle(page, 600);
  const dz = camDiff(d0, await getCam(page));
  record("wheel zooms (camera distance shrinks)", await page.evaluate((c) => { const n = window.__nat.getCamera(); const dist = (a) => Math.hypot(a.position[0] - a.target[0], a.position[1] - a.target[1], a.position[2] - a.target[2]); return dist(n) < dist(c) - 1; }, d0), `moved=${dz.toFixed(1)}`);
  await page.evaluate(() => window.__nat.resetView());
});

// ---- data lifecycles ----------------------------------------------------------------
await inGroup("7 data lifecycles (engine placeStatus/lineStatus/polityStatus)", async () => {
  const page = P();
  await page.evaluate(() => { window.__nat.pause(); window.__nat.resetView(); });
  const at = (kind, id, year) => page.evaluate(([kind, id, t]) => {
    window.__nat.setT(t);
    return kind === "place" ? window.__nat.placeStatus(id) : kind === "line" ? window.__nat.lineStatus(id) : window.__nat.polityStatus(id);
  }, [kind, id, histToT(year) + 0.5]);
  const present = (s) => !!s && s.alpha > 0.01;
  const D = await page.evaluate(() => ({ places: window.__natData.places.map((p) => p.id), lines: window.__natData.lines.map((p) => p.id), polities: window.__natData.polities.map((p) => p.id) }));
  const check = async (kind, id, year, want) => {
    if (!D[kind + "s"]?.includes(id) && !(kind === "polity" && D.polities.includes(id))) { record(`${kind} ${id} exists in data`, false, "missing id"); return null; }
    const s = await at(kind, id, year);
    const ok = want === "present" ? present(s) : !present(s);
    record(`${kind} ${id} ${want} at ${fmt(year)}`, ok, JSON.stringify(s && { alpha: +s.alpha.toFixed(3), name: s.name, kind: s.kind, size: s.size }));
    return s;
  };
  await check("place", "london", 40, "absent");
  await check("place", "london", 100, "present");
  const nm = async (id, year) => (await at("place", id, year))?.name;
  record('London reads "Londinium" in 150', (await nm("london", 150)) === "Londinium", await nm("london", 150));
  record('London reads "London" in 1300', (await nm("london", 1300)) === "London", await nm("london", 1300));
  record('York reads "Eboracum" in 200', (await nm("york", 200)) === "Eboracum", await nm("york", 200));
  record('York reads "Jorvik" in 900 and "York" in 1300', (await nm("york", 900)) === "Jorvik" && (await nm("york", 1300)) === "York", `${await nm("york", 900)} / ${await nm("york", 1300)}`);
  // altName.to in places.json is the last year the name was used (the next phase starts at to+1): the year itself must still carry the name
  record('London still reads "Londinium" in 410 (altName.to = 410 is the last year of the name)', (await nm("london", 410)) === "Londinium", await nm("london", 410));
  record('York still reads "Eboracum" in 410 and "Jorvik" in 954', (await nm("york", 410)) === "Eboracum" && (await nm("york", 954)) === "Jorvik", `${await nm("york", 410)} / ${await nm("york", 954)}`);
  record('London still reads "Lundenburh" in 1065 (altName.to = 1065)', (await nm("london", 1065)) === "Lundenburh", await nm("london", 1065));
  // the selection panel's heading uses the same period names
  for (const [id, year, expect] of [["london", 150, /^Londinium\b/], ["london", 1300, /^London$/], ["york", 200, /^Eboracum\b/]]) {
    await page.evaluate(([id, t]) => { window.__nat.setT(t); window.__nat.selectPlace(id); }, [id, histToT(year) + 0.5]);
    await settle(page, 400);
    const h = (await page.locator(`${tid("selection-name")}`).innerText()).trim();
    record(`selection heading for ${id} in ${year} matches ${expect}`, expect.test(h), h);
  }
  await page.evaluate(() => window.__nat.select(null));
  // the on-map label also uses the period name (selected place has label priority)
  await page.evaluate(() => { window.__nat.setT(150.5); window.__nat.focusPlace("london", 160); window.__nat.setLabels(true); });
  await settle(page, 700);
  const lab = await page.evaluate(() => [...document.querySelectorAll('[data-testid="stage"] *')].filter((e) => e.children.length === 0 && /london|londinium/i.test(e.textContent || "") && e.tagName !== "CANVAS").map((e) => e.textContent.trim()));
  note("map labels containing London/Londinium at 150 (zoomed on London)", lab);
  record("a map label reads Londinium (not London) at 150 when zoomed on it", lab.some((x) => /^Londinium/.test(x)) && !lab.some((x) => /^London$/.test(x)), JSON.stringify(lab));
  await page.evaluate(() => window.__nat.resetView());

  await check("line", "hadrians-wall", 100, "absent");
  await check("line", "hadrians-wall", 150, "present");
  await check("line", "offas-dyke", 700, "absent");
  await check("line", "offas-dyke", 800, "present");
  await check("line", "england-wales-border", 1500, "absent");
  await check("line", "england-wales-border", 1540, "present");
  // all Roman roads absent at 40 BCE, present at 150 CE unless the data ends them earlier
  const roads = await page.evaluate(() => window.__natData.lines.filter((l) => l.kind === "roman-road").map((l) => ({ id: l.id, from: l.from, to: l.to })));
  const early = [];
  for (const r of roads) { const s = await at("line", r.id, -40); if (present(s)) early.push(`${r.id}(from ${r.from})`); }
  record(`all ${roads.length} Roman roads absent at 40 BCE`, early.length === 0, early.join(", "));
  const early43 = [];
  for (const r of roads) { const s = await at("line", r.id, 42); if (present(s)) early43.push(`${r.id}(from ${r.from})`); }
  record("all Roman roads absent at 42 CE (the year before the conquest)", early43.length === 0, early43.join(", "));
  const none = [];
  for (const r of roads) { if (r.from > 150 || (r.to != null && r.to < 150)) continue; const s = await at("line", r.id, 150); if (!present(s)) none.push(`${r.id}(${r.from}–${r.to})`); }
  record("every Roman road dated to include 150 CE is visible at 150 CE", none.length === 0, none.join(", "));
  const mw = await at("line", "military-way", 150);
  record("Military Way (dated from 160) is absent at 150 CE", !present(mw), JSON.stringify(mw));
  await check("polity", "mercia", 750, "present");
  await check("polity", "mercia", 1000, "absent");
  await check("polity", "england", 950, "present");
  await check("polity", "england", 900, "absent");
  await check("polity", "wales-shired", 1500, "absent");
  await check("polity", "wales-shired", 1540, "present");
  for (const id of ["conwy", "caernarfon", "harlech", "beaumaris"]) {
    const s1280 = await at("place", id, 1280);
    const s1300 = await at("place", id, 1300);
    const castleAt1280 = present(s1280) && s1280.kind === "castle";
    record(`${id}: no castle shown at 1280`, !castleAt1280, JSON.stringify(s1280 && { alpha: +s1280.alpha.toFixed(2), kind: s1280.kind, name: s1280.name }));
    record(`${id}: castle present at 1300`, present(s1300) && s1300.kind === "castle", JSON.stringify(s1300 && { alpha: +s1300.alpha.toFixed(2), kind: s1300.kind, size: s1300.size }));
  }
  for (const id of ["tintern", "fountains", "glastonbury"]) {
    const a = await at("place", id, 1530);
    const b = await at("place", id, 1545);
    const changed = a && b && (a.size !== b.size || a.kind !== b.kind || a.abandoned !== b.abandoned);
    record(`${id} changes size/kind/state between 1530 and 1545 (Dissolution)`, !!changed, `1530=${JSON.stringify(a && { kind: a.kind, size: a.size, ring: a.abandoned })} 1545=${JSON.stringify(b && { kind: b.kind, size: b.size, ring: b.abandoned })}`);
  }
  await check("place", "stonehenge", -2000, "present");
  await check("place", "stonehenge", -2990, "present");
  await check("place", "stonehenge", -3100, "absent");
  await check("place", "stonehenge", 1000, "present");
  // generic: nothing is visible before the first dated year and nothing is dated outside the timeline
  const range = await page.evaluate(() => {
    const T0 = -4000, T1 = 1625, bad = [];
    const chk = (what, y) => { if (y == null) return; if (!Number.isInteger(y) || y === 0 || y < T0 || y > T1) bad.push(`${what}: ${y}`); };
    for (const p of window.__natData.places) { for (const f of p.phases) { chk(`place ${p.id} phase.from`, f.from); chk(`place ${p.id} phase.to`, f.to); } for (const a of p.altNames ?? []) { chk(`place ${p.id} altName.from`, a.from); chk(`place ${p.id} altName.to`, a.to); } }
    for (const l of window.__natData.lines) { chk(`line ${l.id}.from`, l.from); chk(`line ${l.id}.to`, l.to); }
    for (const k of window.__natData.polities) { chk(`polity ${k.id}.from`, k.from); chk(`polity ${k.id}.to`, k.to); }
    for (const e of window.__natData.events) chk(`event ${e.label}`, e.year);
    return bad;
  });
  record("no place, line, polity or event has a date outside 4000 BCE–1625 CE (or zero/non-integer)", range.length === 0, range.slice(0, 20).join("; "));
  // before the first year of data, nothing from a late-founded set should be visible at the very start
  await page.evaluate(() => window.__nat.setT(-3999));
  await settle(page, 200);
  const s0 = await page.evaluate(() => window.__nat.stats());
  note("visible at 4000 BCE", { places: s0.placesVisible, lines: s0.linesVisible, polities: s0.politiesVisible });
  await page.evaluate(() => window.__nat.setT(1625));
  await settle(page, 200);
  const s1 = await page.evaluate(() => window.__nat.stats());
  note("visible at 1625 CE", { places: s1.placesVisible, lines: s1.linesVisible, polities: s1.politiesVisible });
  record("at 4000 BCE no line or polity is visible (nothing in the data predates the Neolithic)", s0.linesVisible === 0 && s0.politiesVisible === 0, `lines=${s0.linesVisible} polities=${s0.politiesVisible}`);
});

// ---- anachronism sweep ----------------------------------------------------------------
let sweepOut = null;
await inGroup("8 anachronism sweep (all data)", async () => {
  const page = P();
  const sweep = await page.evaluate(() => {
    const ds = window.__natData;
    const H = (y) => (y < 0 ? y + 1 : y);
    const F = (y) => (y == null ? "open" : y < 0 ? `${-y} BCE` : `${y} CE`);
    const b = ds.site.bounds;
    const out = { order: [], overlap: [], zeroOrNonInteger: [], toBeforeFrom: [], openNotLast: [], outOfBounds: [], timelineRange: [], castleBefore1050: [], religiousBefore597: [], romanRoadBefore43: [], badEvidence: [], unknownSource: [], duplicates: [], longSegments: [], countryMismatch: [], gaps: [], altNameIssues: [], sizeIssues: [], noSource: [] };
    const ev = new Set(["attested-standing", "attested-excavated", "attested-documentary", "attested-pictorial", "reconstructed", "conjectural"]);
    const conf = new Set(["high", "medium", "low"]);
    const yr = (what, y) => { if (y == null) return; if (typeof y !== "number" || !Number.isInteger(y) || y === 0) out.zeroOrNonInteger.push(`${what}: ${JSON.stringify(y)}`); else if (y < -4000 || y > 1625) out.timelineRange.push(`${what}: ${F(y)}`); };
    const inB = (lat, lon) => typeof lat === "number" && typeof lon === "number" && lat >= b.latMin && lat <= b.latMax && lon >= b.lonMin && lon <= b.lonMax;
    const common = (o, w) => {
      if (!ev.has(o.evidence) || !conf.has(o.confidence)) out.badEvidence.push(`${w}: evidence=${o.evidence} confidence=${o.confidence}`);
      if (!Array.isArray(o.sources) || o.sources.length === 0) out.noSource.push(w);
      else for (const s of o.sources) if (!ds.sources[s]) out.unknownSource.push(`${w}: ${s}`);
    };
    const seen = { place: new Set(), line: new Set(), polity: new Set() };
    const dup = (k, id) => { if (seen[k].has(id)) out.duplicates.push(`${k} ${id}`); seen[k].add(id); };
    const km = (a, c) => { const R = 6371, d2r = Math.PI / 180; const dl = (c[0] - a[0]) * d2r, dn = (c[1] - a[1]) * d2r; const x = Math.sin(dl / 2) ** 2 + Math.cos(a[0] * d2r) * Math.cos(c[0] * d2r) * Math.sin(dn / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(x)); };
    for (const p of ds.places) {
      const w = `place ${p.id} (${p.name})`;
      dup("place", p.id);
      common(p, w);
      if (!inB(p.lat, p.lon)) out.outOfBounds.push(`${w}: [${p.lat}, ${p.lon}]`);
      if (p.country === "wales" && p.lon > -2.55 && p.lat < 53.3) out.countryMismatch.push(`${w}: country=wales but lon ${p.lon}`);
      if (p.country === "england" && p.lon < -3.6 && p.lat > 51.9 && p.lat < 53.3) out.countryMismatch.push(`${w}: country=england but lon ${p.lon}, lat ${p.lat}`);
      const ph = p.phases ?? [];
      if (!ph.length) out.order.push(`${w}: no phases`);
      ph.forEach((f, i) => {
        const pw = `${w} phase ${i} "${(f.label || "").slice(0, 40)}" ${F(f.from)}→${F(f.to)}`;
        yr(pw + ".from", f.from); yr(pw + ".to", f.to);
        if (f.to != null && Number.isInteger(f.from) && Number.isInteger(f.to) && f.from !== 0 && f.to !== 0 && H(f.to) < H(f.from)) out.toBeforeFrom.push(pw);
        if (f.to == null && i < ph.length - 1) out.openNotLast.push(pw);
        if (!(Number.isInteger(f.size) && f.size >= 0 && f.size <= 5)) out.sizeIssues.push(`${pw}: size ${f.size}`);
        if (i > 0) {
          const q = ph[i - 1];
          if (H(f.from) < H(q.from)) out.order.push(`${w}: phase ${i} (${F(f.from)}) starts before phase ${i - 1} (${F(q.from)})`);
          else if (q.to != null && H(f.from) < H(q.to)) out.overlap.push(`${w}: phase ${i - 1} ends ${F(q.to)} but phase ${i} starts ${F(f.from)}`);
          else if (q.to != null && H(f.from) > H(q.to) + 1) out.gaps.push(`${w}: gap ${F(q.to)} → ${F(f.from)} (${H(f.from) - H(q.to)} yr) between phase ${i - 1} and ${i}`);
        }
        const k = f.kind ?? p.kind;
        if (k === "castle" && f.from < 1050 && !(f.from < 0)) out.castleBefore1050.push(`${pw} [kind ${k}]`);
        if (k === "castle" && f.from < 0) out.castleBefore1050.push(`${pw} [kind ${k}]`);
        if ((k === "cathedral" || k === "monastery") && H(f.from) < 597) out.religiousBefore597.push(`${pw} [kind ${k}]`);
      });
      const an = p.altNames ?? [];
      an.forEach((a, i) => {
        const aw = `${w} altName "${a.name}" ${F(a.from)}→${F(a.to)}`;
        yr(aw + ".from", a.from); yr(aw + ".to", a.to);
        if (a.to != null && H(a.to) < H(a.from)) out.altNameIssues.push(`${aw}: ends before it starts`);
        if (i > 0 && H(a.from) < H(an[i - 1].from)) out.altNameIssues.push(`${aw}: not in date order`);
        // (names may overlap: a Latin, Welsh and English name for one place were in use together, e.g. Menevia / Mynyw)
        if (ph.length) { const first = ph[0]; if (H(a.from) < H(first.from) - 0) out.altNameIssues.push(`${aw}: name used before the place's first phase (${F(first.from)})`); }
      });
    }
    for (const l of ds.lines) {
      const w = `line ${l.id} (${l.name})`;
      dup("line", l.id);
      common(l, w);
      yr(w + ".from", l.from); yr(w + ".to", l.to);
      if (l.to != null && H(l.to) < H(l.from)) out.toBeforeFrom.push(`${w}: ${F(l.from)}→${F(l.to)}`);
      (l.path ?? []).forEach((v, i) => {
        if (!inB(v?.[0], v?.[1])) out.outOfBounds.push(`${w} vertex ${i}: [${v?.[0]}, ${v?.[1]}]`);
        if (i > 0 && l.path[i - 1] && v) { const d = km(l.path[i - 1], v); if (d > 40) out.longSegments.push(`${w}: vertices ${i - 1}→${i} are ${d.toFixed(0)} km apart`); }
      });
      if ((l.path ?? []).length < 2) out.order.push(`${w}: path has < 2 vertices`);
      if (l.kind === "roman-road" && H(l.from) < 43) out.romanRoadBefore43.push(`${w}: from ${F(l.from)}`);
    }
    for (const k of ds.polities) {
      const w = `polity ${k.id} (${k.name})`;
      dup("polity", k.id);
      common(k, w);
      yr(w + ".from", k.from); yr(w + ".to", k.to);
      if (k.to != null && H(k.to) < H(k.from)) out.toBeforeFrom.push(`${w}: ${F(k.from)}→${F(k.to)}`);
      if (!inB(k.labelAt?.[0], k.labelAt?.[1])) out.outOfBounds.push(`${w} labelAt: ${JSON.stringify(k.labelAt)}`);
      (k.polygon ?? []).forEach((v, i) => { if (!inB(v?.[0], v?.[1])) out.outOfBounds.push(`${w} polygon vertex ${i}: [${v?.[0]}, ${v?.[1]}]`); });
    }
    // `to` convention: the engine treats phase.to as the first year the phase is gone. Count phase joins written the other way (next.from == prev.to + 1).
    const joins = { inclusive: 0, exclusive: 0, byCountry: {}, examples: [] };
    for (const p of ds.places) for (let i = 1; i < (p.phases ?? []).length; i++) {
      const a = p.phases[i - 1], c = p.phases[i];
      if (a.to == null) continue;
      const d = H(c.from) - H(a.to);
      const bc = (joins.byCountry[p.country] ??= { inclusive: 0, exclusive: 0 });
      if (d === 1) { joins.inclusive++; bc.inclusive++; if (joins.examples.length < 8) joins.examples.push(`${p.id}: ${F(a.to)} → ${F(c.from)}`); }
      else if (d === 0) { joins.exclusive++; bc.exclusive++; }
    }
    out.joinConvention = joins;
    out.yearHoles = joins.inclusive > 0 && joins.exclusive > 0 ? [`phase.to is used inclusively in ${joins.inclusive} joins and exclusively in ${joins.exclusive}: ${JSON.stringify(joins.byCountry)}; e.g. ${joins.examples.join("; ")}`] : [];
    // near-duplicate polities
    const words = (n) => new Set(n.toLowerCase().replace(/[^a-z ]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !["the", "kingdom", "lands", "and", "principality"].includes(w)));
    out.nearDuplicatePolities = [];
    for (let i = 0; i < ds.polities.length; i++) for (let j = i + 1; j < ds.polities.length; j++) {
      const a = ds.polities[i], c = ds.polities[j];
      if (a.from === c.from && a.to === c.to && a.kind === c.kind) { const A = words(a.name), B = words(c.name); const inter = [...A].filter((w) => B.has(w)).length; if (inter && inter / Math.min(A.size, B.size) >= 0.5) out.nearDuplicatePolities.push(`${a.id} (${a.name}) and ${c.id} (${c.name}): same kind and dates ${F(a.from)}→${F(a.to)}`); }
    }
    out.nearDuplicatePlaces = [];
    for (let i = 0; i < ds.places.length; i++) for (let j = i + 1; j < ds.places.length; j++) { const a = ds.places[i], c = ds.places[j]; if (Math.abs(a.lat - c.lat) < 0.004 && Math.abs(a.lon - c.lon) < 0.006 && a.id !== c.id) out.nearDuplicatePlaces.push(`${a.id} and ${c.id} are within ~400 m`); }
    for (const e of ds.events) yr(`event "${e.label}"`, e.year);
    for (const e of ds.eras) { yr(`era ${e.id}.from`, e.from); yr(`era ${e.id}.to`, e.to); yr(`era ${e.id}.presetYear`, e.presetYear); }
    return out;
  });
  sweepOut = sweep;
  const hard = ["order", "overlap", "zeroOrNonInteger", "toBeforeFrom", "openNotLast", "outOfBounds", "timelineRange", "castleBefore1050", "romanRoadBefore43", "badEvidence", "unknownSource", "duplicates", "sizeIssues", "altNameIssues", "yearHoles"];
  const review = ["religiousBefore597", "gaps", "longSegments", "countryMismatch", "noSource", "nearDuplicatePolities", "nearDuplicatePlaces"];
  for (const k of hard) record(`sweep: ${k} — none`, sweep[k].length === 0, sweep[k].length ? `${sweep[k].length}: ` + sweep[k].slice(0, 12).join(" || ") : "");
  for (const k of review) note(`REVIEW sweep: ${k} (${sweep[k].length})`, sweep[k]);
  for (const k of hard) if (sweep[k].length) console.log(`SWEEP ${k} (${sweep[k].length}):\n   ` + sweep[k].join("\n   "));
  for (const k of review) if (sweep[k].length) console.log(`SWEEP-REVIEW ${k} (${sweep[k].length}):\n   ` + sweep[k].join("\n   "));
});

// ---- selection ---------------------------------------------------------------------
await inGroup("9 selection and info panel", async () => {
  const page = P();
  const inspectPanel = () => page.evaluate(() => {
    const el = document.querySelector('[data-testid="info-panel"]');
    return {
      name: el.querySelector('[data-testid="selection-name"]')?.textContent?.trim() ?? null,
      ev: el.querySelector('[data-testid="evidence-badge"]')?.textContent ?? null,
      conf: el.querySelector('[data-testid="confidence-badge"]')?.textContent ?? null,
      phases: el.querySelectorAll(".phases li").length,
      activePhases: el.querySelectorAll(".phases li.on").length,
      links: [...el.querySelectorAll(".sources a")].map((a) => ({ href: a.getAttribute("href"), target: a.target, rel: a.rel })),
      noSource: /No source recorded yet/.test(el.textContent || ""),
      enter: el.querySelectorAll('[data-testid="enter-site"]').length,
      enterPending: el.querySelectorAll('[data-testid="enter-site-pending"]').length,
    };
  });
  // real mouse clicks on markers, one of each interesting kind
  const picks = [["london", 1300], ["york", 1300], ["stonehenge", -2000], ["conwy", 1300], ["glastonbury", 1300], ["battle-brentford-1016", 1016], ["battle-barnet", 1471]];
  for (const [id, year] of picks) {
    await page.evaluate(([id, t]) => { window.__nat.select(null); window.__nat.setT(t); window.__nat.resetView(); window.__nat.focusPlace(id, 220); }, [id, histToT(year) + 0.5]);
    await settle(page, 500);
    const s = await page.evaluate((id) => window.__nat.placeStatus(id), id);
    if (!s) { record(`click marker ${id}`, false, "no such place"); continue; }
    await page.mouse.click(s.screen[0], s.screen[1]);
    await settle(page, 400);
    const sel = await page.evaluate(() => window.__nat.getSelection());
    const got = sel?.place?.id ?? sel?.type ?? null;
    record(`clicking the ${id} marker at ${fmt(year)} selects it`, got === id, `selected=${got} at (${s.screen.map(Math.round)}) alpha=${s.alpha.toFixed(2)} size=${s.size}`);
    if (got === id) {
      const pn = await inspectPanel();
      record(`${id}: panel shows name, evidence badge, confidence badge`, !!pn.name && /Evidence|Reconstruction|Conjecture/.test(pn.ev ?? "") && /Confidence: (high|medium|low)/.test(pn.conf ?? ""), JSON.stringify({ name: pn.name, ev: pn.ev, conf: pn.conf }));
      record(`${id}: panel lists phases (${pn.phases}) with the active one marked`, pn.phases >= 1 && pn.activePhases >= 1, `${pn.activePhases}/${pn.phases}`);
      record(`${id}: panel shows source links or the "no source" text`, pn.links.length >= 1 ? pn.links.every((l) => /^https?:\/\//.test(l.href) && l.target === "_blank" && /noreferrer/.test(l.rel)) : pn.noSource, `${pn.links.length} links; noSourceText=${pn.noSource}`);
    }
  }
  // every place, line and polity renders a complete panel (engine select API)
  const all = await page.evaluate(() => ({ places: window.__natData.places.map((p) => p.id), lines: window.__natData.lines.map((p) => p.id), polities: window.__natData.polities.map((p) => p.id) }));
  const bad = [];
  const errBefore = main.errors.length;
  for (const [kind, ids] of [["place", all.places], ["line", all.lines], ["polity", all.polities]]) {
    for (const id of ids) {
      await page.evaluate(([kind, id]) => {
        const d = window.__natData;
        if (kind === "place") window.__nat.selectPlace(id);
        else if (kind === "line") window.__nat.select({ type: "line", line: d.lines.find((x) => x.id === id) });
        else window.__nat.select({ type: "polity", polity: d.polities.find((x) => x.id === id) });
      }, [kind, id]);
      await page.waitForTimeout(25);
      const pn = await inspectPanel();
      const entry = await page.evaluate(([kind, id]) => { const d = window.__natData; const o = (kind === "place" ? d.places : kind === "line" ? d.lines : d.polities).find((x) => x.id === id); return { nSources: (o.sources ?? []).filter((s) => d.sources[s]).length, nPhases: kind === "place" ? o.phases.length : 1 }; }, [kind, id]);
      const problems = [];
      if (!pn.name) problems.push("no name");
      if (!pn.ev || !/Evidence|Reconstruction|Conjecture/.test(pn.ev)) problems.push(`evidence badge "${pn.ev}"`);
      if (!pn.conf) problems.push("no confidence");
      if (pn.phases !== entry.nPhases) problems.push(`phases ${pn.phases}/${entry.nPhases}`);
      if (entry.nSources === 0 ? !pn.noSource : pn.links.length !== entry.nSources) problems.push(`sources ${pn.links.length}/${entry.nSources} noSourceText=${pn.noSource}`);
      if (problems.length) bad.push(`${kind} ${id}: ${problems.join(", ")}`);
    }
  }
  await page.evaluate(() => window.__nat.select(null));
  record(`info panel renders completely for all ${all.places.length} places, ${all.lines.length} lines, ${all.polities.length} polities`, bad.length === 0, `${bad.length} bad: ` + bad.slice(0, 12).join(" || "));
  record("no page errors while opening every panel", main.errors.length === errBefore, JSON.stringify(main.errors.slice(errBefore)).slice(0, 300));
  const noSrc = await page.evaluate(() => ({ places: window.__natData.places.filter((p) => !(p.sources ?? []).some((s) => window.__natData.sources[s])).map((p) => p.id), lines: window.__natData.lines.filter((p) => !(p.sources ?? []).some((s) => window.__natData.sources[s])).map((p) => p.id), polities: window.__natData.polities.filter((p) => !(p.sources ?? []).some((s) => window.__natData.sources[s])).map((p) => p.id) }));
  note("entries with no resolvable source (panel shows the fallback text)", noSrc);
  // Escape deselects, close button deselects
  await page.evaluate(() => window.__nat.selectPlace("london"));
  await settle(page, 200);
  await page.keyboard.press("Escape");
  await settle(page, 200);
  record("Escape clears the selection", (await page.evaluate(() => window.__nat.getSelection())) === null);
  await page.evaluate(() => window.__nat.selectPlace("york"));
  await settle(page, 200);
  await page.locator(`${tid("info-panel")} .close`).click();
  await settle(page, 200);
  record("close button clears the selection and restores the era text", (await page.evaluate(() => window.__nat.getSelection())) === null && (await page.locator(`${tid("info-panel")} h2`).innerText()) === (await eraName(page)));
  // Which places offer a site?
  const withSite = await page.evaluate(() => window.__natData.places.filter((p) => p.site).map((p) => `${p.id}:${p.site}`));
  record("exactly four places declare a site (london, brentford, barnet, stonehenge)", withSite.length === 4, withSite.join(", "));
  const noEnter = [];
  for (const id of ["york", "avebury", "conwy"]) {
    await page.evaluate((id) => window.__nat.selectPlace(id), id);
    await settle(page, 150);
    if ((await page.locator(tid("enter-site")).count()) !== 0) noEnter.push(id);
  }
  record("places without a site show no Explore control", noEnter.length === 0, noEnter.join(","));
  await page.evaluate(() => window.__nat.select(null));
  // toggles
  await page.click(tid("evidence-toggle"));
  await page.click(tid("polities-toggle"));
  await page.click(tid("labels-toggle"));
  await page.selectOption(tid("quality-select"), "low");
  await settle(page, 500);
  const s2 = await state(page);
  record("evidence / polities / labels / quality toggles apply", s2.evidence && !s2.polities && !s2.labels && s2.quality === "low", JSON.stringify(s2));
  record("evidence legend visible when tint is on", (await page.locator(".nat-key").count()) === 1);
  await page.click(tid("evidence-toggle")); await page.click(tid("polities-toggle")); await page.click(tid("labels-toggle"));
  await page.selectOption(tid("quality-select"), "medium");
  await page.click(tid("key-toggle"));
  record("key lists marker kinds and line styles", (await page.locator(".nat-key-grid span").count()) >= 18, `${await page.locator(".nat-key-grid span").count()} entries`);
  await page.click(tid("key-toggle"));
  await page.click(tid("about-toggle"));
  record("scope note opens", (await page.locator(tid("about")).count()) === 1 && (await page.locator(tid("about")).innerText()).length > 200);
  await page.click(tid("about-toggle"));
  await page.keyboard.press("KeyH");
  await settle(page, 200);
  const hidden = (await page.locator(tid("year-slider")).count()) === 0;
  await page.keyboard.press("KeyH");
  await settle(page, 200);
  record("H hides and restores the UI", hidden && (await page.locator(tid("year-slider")).count()) === 1);
});

// ---- map <-> site -------------------------------------------------------------------
await inGroup("10 enter site / back to map", async () => {
  const cases = [
    { place: "london", site: "london", year: 1300 },
    { place: "battle-brentford-1016", site: "brentford", year: 1016 },
    { place: "battle-barnet", site: "barnet", year: 1471 },
  ];
  for (const c of cases) {
    const r = await openPage(`/?map=1&year=${c.year}`);
    const { page } = r;
    await page.evaluate((id) => { window.__nat.resetView(); window.__nat.focusPlace(id, 220); }, c.place);
    await settle(page, 500);
    const s = await page.evaluate((id) => window.__nat.placeStatus(id), c.place);
    await page.mouse.click(s.screen[0], s.screen[1]);
    await settle(page, 400);
    record(`${c.site}: marker click selects ${c.place} at ${c.year}`, (await page.evaluate(() => window.__nat.getSelection()?.place?.id)) === c.place, JSON.stringify(s.screen));
    const btn = page.locator(tid("enter-site"));
    record(`${c.site}: "Explore this site" control is shown (data-testid enter-site)`, (await btn.count()) === 1, (await btn.count()) ? (await btn.innerText()).replace(/\n/g, " | ") : "absent");
    if ((await btn.count()) !== 1) { await r.ctx.close(); continue; }
    const mapT = await getT(page);
    await btn.click();
    await siteReady(page);
    await settle(page, 600);
    const sy = await readout(page);
    const url = page.url();
    record(`${c.site}: enters the site viewer (?site=${c.site}), national engine gone`, url.includes(`site=${c.site}`) && (await page.evaluate(() => !window.__nat && !!window.__ltt)), url);
    const win = await page.evaluate(() => window.__lttData.site.timeline);
    record(`${c.site}: same year carried over (${fmt(c.year)} is inside the ${fmt(win.start)}–${fmt(win.end)} window)`, sy === fmt(c.year), `site readout ${sy}, url ${url.replace(BASE, "")}`);
    record(`${c.site}: address bar year matches the readout`, new URL(url).searchParams.get("year") === String(c.year), url);
    record(`${c.site}: "Back to map" button present`, (await page.locator(tid("back-to-map")).count()) >= 1);
    // move the site year then go back
    const newYear = c.site === "london" ? 1500 : c.site === "brentford" ? 1050 : 1480;
    await page.evaluate((y) => window.__ltt.setT(y + 0.5), newYear);
    await settle(page, 300);
    await page.locator(tid("back-to-map")).last().click();
    await natReady(page);
    await settle(page, 500);
    record(`${c.site}: back to map carries the site's year back (${fmt(newYear)})`, (await readout(page)) === fmt(newYear) && page.url().includes("map=1"), `${await readout(page)} ${page.url().replace(BASE, "")}`);
    record(`${c.site}: national map is functional after returning (stats ok, canvas, no stub)`, (await page.evaluate(() => window.__nat.stats().places)) > 100 && (await page.locator(tid("stub-note")).count()) === 0);
    // browser Back after Back-to-map goes to the site again; Back twice returns to initial map
    await page.goBack();
    await settle(page, 1500);
    const afterBack = await page.evaluate(() => ({ nat: !!window.__nat, ltt: !!window.__ltt, url: location.search }));
    note(`${c.site}: browser Back after "Back to map"`, afterBack);
    record(`${c.site}: browser Back after "Back to map" returns to the site viewer`, afterBack.ltt && !afterBack.nat, JSON.stringify(afterBack));
    record(`${c.site}: no page errors during map<->site round trip`, r.errors.filter((e) => !isFavicon(e)).length === 0, JSON.stringify(r.errors.filter((e) => !isFavicon(e))).slice(0, 400));
    await r.ctx.close();
  }
  // out-of-window years
  const outside = [
    { place: "battle-brentford-1016", site: "brentford", year: 1300, lo: 950, hi: 1100 },
    { place: "battle-brentford-1016", site: "brentford", year: -500, lo: 950, hi: 1100 },
    { place: "battle-barnet", site: "barnet", year: 1300, lo: 1400, hi: 1500 },
    { place: "battle-barnet", site: "barnet", year: 1616, lo: 1400, hi: 1500 },
    { place: "london", site: "london", year: -3000, lo: -4000, hi: 1625 },
  ];
  for (const c of outside) {
    const r = await openPage(`/?map=1&year=${c.year}`);
    const { page } = r;
    await page.evaluate((id) => { window.__nat.selectPlace(id); }, c.place);
    await settle(page, 300);
    const label = (await page.locator(tid("enter-site")).count()) ? (await page.locator(tid("enter-site")).innerText()).replace(/\n/g, " | ") : "no control";
    await page.locator(tid("enter-site")).click();
    await siteReady(page);
    await settle(page, 600);
    const sy = await readout(page);
    const t = await page.evaluate(() => window.__ltt.getT());
    const url = page.url().replace(BASE, "");
    const inWindow = t >= histToT(c.lo) && t <= histToT(c.hi);
    note(`${c.site} entered from national ${fmt(c.year)} (outside ${fmt(c.lo)}–${fmt(c.hi)}): control says "${label}"`, { siteReadout: sy, t, url });
    record(`${c.site}: entering from ${fmt(c.year)} (outside the site window) lands inside the window and does not error`, c.year >= c.lo && c.year <= c.hi ? sy === fmt(c.year) : inWindow && /^\d+ (CE|BCE)$/.test(sy), `readout=${sy} t=${t} url=${url}`);
    record(`${c.site}: enter button text for ${fmt(c.year)} does not promise a year the site cannot show`, c.year >= c.lo && c.year <= c.hi ? true : !new RegExp(`in ${fmt(c.year)}`).test(label), label);
    record(`${c.site}: address bar year agrees with the readout after clamping`, new URL(page.url()).searchParams.get("year") === sy.replace(/ CE$/, "").replace(/^(\d+) BCE$/, "-$1"), `${url} vs ${sy}`);
    await r.ctx.close();
  }
});

await inGroup("11 deep links", async () => {
  const link = async (path, kind, check, label) => {
    const r = await openPage(path, { kind });
    const out = await check(r.page);
    record(label, out.ok, out.detail ?? "");
    record(`${label} — no page errors`, r.errors.filter((e) => !isFavicon(e)).length === 0, JSON.stringify(r.errors.filter((e) => !isFavicon(e))).slice(0, 300));
    await r.ctx.close();
  };
  await link("/?year=1616&view=bridge", "site", async (p) => ({ ok: (await readout(p)) === "1616 CE" && (await p.evaluate(() => !window.__nat && window.__lttData.site.id === "london")) && /benchmark district/i.test(await p.locator(tid("scope-badge")).innerText()), detail: await readout(p) }), "/?year=1616&view=bridge opens the London site at the bridge");
  await link("/?map=1&year=1066", "map", async (p) => ({ ok: (await readout(p)) === "1066 CE" && (await getT(p)) === 1066, detail: await readout(p) }), "/?map=1&year=1066 opens the national map at 1066");
  await link("/?site=barnet", "site", async (p) => ({ ok: (await p.evaluate(() => window.__lttData.site.id)) === "barnet" && (await readout(p)) === "1471 CE", detail: await readout(p) }), "/?site=barnet opens Barnet (at its initial year 1471)");
  await link("/?site=brentford", "site", async (p) => ({ ok: (await p.evaluate(() => window.__lttData.site.id)) === "brentford" && (await readout(p)) === "1016 CE", detail: await readout(p) }), "/?site=brentford opens Brentford (at its initial year 1016)");
  await link("/?site=london", "site", async (p) => ({ ok: (await p.evaluate(() => window.__lttData.site.id)) === "london", detail: await readout(p) }), "/?site=london opens London");
  await link("/?site=nonsense", "map", async (p) => ({ ok: await p.evaluate(() => !!window.__nat), detail: "falls back to the map" }), "/?site=nonsense falls back to the national map");
  await link("/?map=1&year=55%20BCE", "map", async (p) => ({ ok: (await readout(p)) === "55 BCE", detail: await readout(p) }), "/?map=1&year=55 BCE");
  await link("/?map=1&year=0", "map", async (p) => ({ ok: (await readout(p)) === "1616 CE", detail: await readout(p) }), "/?map=1&year=0 is ignored (falls back to 1616)");
  await link("/?map=1&year=99999", "map", async (p) => ({ ok: (await readout(p)) === "1625 CE", detail: await readout(p) }), "/?map=1&year=99999 clamps to 1625 CE");
  await link("/?map=1&quality=low&labels=0&polities=0&evidence=1", "map", async (p) => { const s = await state(p); return { ok: s.quality === "low" && !s.labels && !s.polities && s.evidence, detail: JSON.stringify(s) }; }, "/?map=1&quality=low&labels=0&polities=0&evidence=1 applied");
  await link("/?map=1&place=london&year=150", "map", async (p) => ({ ok: (await p.evaluate(() => window.__nat.getSelection()?.place?.id)) === "london", detail: await p.evaluate(() => window.__nat.getSelection()?.place?.id) }), "/?map=1&place=london selects London");
  await link("/?map=1&ui=0", "bare", async (p) => ({ ok: (await p.locator(tid("year-slider")).count()) === 0, detail: "" }), "/?map=1&ui=0 hides the controls");
});

// ---- performance -----------------------------------------------------------------------
const perf = { when: new Date().toISOString(), viewport: VIEWPORT, note: "fps = engine's own rAF average over its last frames after ~3 s (headless Chrome caps rAF at 60 Hz). benchMs = engine.benchmark(30): synchronous render + readPixels. dsf=1.", runs: [] };
if (!NO_PERF && (!ONLY || "perf".includes(ONLY.toLowerCase()))) {
  group = "12 performance";
  groupBuf = [];
  const scenarios = [
    ["whole map", -3000], ["whole map", 150], ["whole map", 1300], ["whole map", 1600],
    ["south-east zoom", 1300], ["south-east zoom", 1600],
  ];
  for (const quality of ["low", "medium", "high"]) {
    let p;
    try {
      const t0 = Date.now();
      p = await openPage(`/?map=1&quality=${quality}&year=1300`);
      const loadMs = Date.now() - t0;
      for (const [view, year] of scenarios) {
        await p.page.evaluate(([view, y]) => {
          window.__nat.setT(y < 0 ? y + 1.5 : y + 0.5);
          if (view === "whole map") window.__nat.resetView();
          else {
            // south-east England: centred on London, tilted, a little over 100 km across
            const pl = window.__natData.places.find((x) => x.id === "london");
            const [x, z] = window.__nat.toXZ(pl.lat, pl.lon);
            window.__nat.setCamera([x + 20, 150, z + 170], [x, 0, z]);
          }
        }, [view, year]);
        await p.page.waitForTimeout(3200);
        const r = await p.page.evaluate(async () => {
          const stats = window.__nat.stats();
          const raf = await new Promise((res) => {
            let n = 0; const t0 = performance.now();
            const f = (now) => { n++; if (now - t0 >= 1000) res((n * 1000) / (now - t0)); else requestAnimationFrame(f); };
            requestAnimationFrame(f);
          });
          const bench = window.__nat.benchmark(30).msPerFrame;
          return { ...stats, rafFps: +raf.toFixed(1), benchMs: bench };
        });
        const row = { quality, view, year: year < 0 ? `${-year} BCE` : `${year} CE`, fps: r.fps, rafFps: r.rafFps, frameMs: r.frameMs, worstMs: r.worstMs, benchMs: r.benchMs, benchFps: +(1000 / r.benchMs).toFixed(0), triangles: r.triangles, calls: r.calls, placesVisible: r.placesVisible, linesVisible: r.linesVisible, politiesVisible: r.politiesVisible, labels: r.labels, pixelRatio: r.pixelRatio, size: r.size, loadMs };
        perf.runs.push(row);
        console.log("PERF ", JSON.stringify(row));
      }
      record(`perf run quality=${quality} completed without errors`, p.errors.filter((e) => !isFavicon(e)).length === 0, JSON.stringify(p.errors).slice(0, 400));
    } catch (e) {
      record(`perf run quality=${quality} completed`, false, String(e).slice(0, 300));
    } finally {
      await p?.ctx.close().catch(() => {});
    }
  }
  const lowRows = perf.runs.filter((r) => r.quality === "low"), hiRows = perf.runs.filter((r) => r.quality === "high");
  if (lowRows.length && hiRows.length) record("every scenario renders in under 50 ms/frame at medium quality (benchmark)", perf.runs.filter((r) => r.quality === "medium").every((r) => r.benchMs < 50), JSON.stringify(perf.runs.filter((r) => r.quality === "medium").map((r) => r.benchMs)));
}

// quality switching functional check on a live page
await inGroup("13 quality switching", async () => {
  const page = P();
  await page.evaluate(() => { window.__nat.setT(1300.5); window.__nat.resetView(); });
  await settle(page, 500);
  const c0 = await getCam(page), y0 = await readout(page);
  const before = main.errors.length;
  for (const q of ["low", "high", "medium", "low", "medium"]) {
    await page.locator(tid("quality-select")).selectOption(q);
    await page.waitForFunction((q) => window.__nat.getState().quality === q, q, { timeout: 30000 }).catch(() => {});
    await settle(page, 1200);
    const shot = await samplePng(await page.screenshot({ clip: { x: 350, y: 180, width: 700, height: 420 } }));
    const stats = await page.evaluate(() => window.__nat.stats());
    record(`quality → ${q}: applied, year and camera kept, still rendering`, (await state(page)).quality === q && (await readout(page)) === y0 && camDiff(c0, await getCam(page)) < 1e-6 && shot.distinct >= 12, `distinct=${shot.distinct} tris=${stats.triangles} dpr=${stats.pixelRatio}`);
  }
  record("no errors while switching quality", main.errors.length === before, JSON.stringify(main.errors.slice(before)).slice(0, 300));
});

group = "session";
groupBuf = [];
{
  const real = main.errors.filter((e) => !isFavicon(e));
  record("no page/console errors during the whole main-page run (favicon aside)", real.length === 0, JSON.stringify(real).slice(0, 1200));
  note("main page reloads / state losses", mainReloads);
}
await main.ctx.close().catch(() => {});
await browser.close();
const failed = results.filter((r) => !r.pass);
const summary = { when: new Date().toISOString(), base: BASE, passed: results.length - failed.length, failed: failed.length, total: results.length };
writeFileSync(join(HERE, "national-results.json"), JSON.stringify({ summary, results, retried, info, perf: perf.runs, sweep: sweepOut }, null, 2));
console.log(`\n${summary.passed}/${summary.total} checks passed, ${summary.failed} failed`);
for (const f of failed) console.log(`  FAIL [${f.group}] ${f.name} — ${f.detail.slice(0, 300)}`);
for (const r of retried) console.log(`  RETRIED [${r.group}] ${r.firstAttemptFailures.length} first-attempt failure(s)${r.looksLikeHotReload ? " (hot-reload suspected)" : ""}`);
process.exit(failed.length ? 1 : 0);
