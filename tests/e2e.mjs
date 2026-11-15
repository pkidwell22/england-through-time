// End-to-end checks against a running server (default http://127.0.0.1:4310).
// Usage: node tests/e2e.mjs [--no-perf] [--only=<substring of group name>]
// Writes tests/e2e-results.json and tests/perf-results.json. Exit code 1 if any check fails.
import { chromium } from "playwright-core";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.LTT_URL ?? "http://127.0.0.1:4310";
const NO_PERF = process.argv.includes("--no-perf");
const ONLY = process.argv.find((a) => a.startsWith("--only="))?.slice(7);
const ARGS = ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"];
const VIEWPORT = { width: 1500, height: 900 };

const results = [];
let group = "";
function record(name, pass, detail = "") {
  results.push({ group, name, pass: !!pass, detail: String(detail) });
  console.log(`${pass ? "PASS" : "FAIL"}  [${group}] ${name}${detail ? "  — " + detail : ""}`);
}
const info = [];
function note(name, detail) {
  info.push({ group, name, detail });
  console.log(`INFO  [${group}] ${name}  — ${typeof detail === "string" ? detail : JSON.stringify(detail)}`);
}
async function inGroup(name, fn) {
  if (ONLY && !name.toLowerCase().includes(ONLY.toLowerCase())) return;
  group = name;
  try {
    await fn();
  } catch (e) {
    record("group ran to completion", false, (e && e.stack ? e.stack.split("\n").slice(0, 3).join(" | ") : String(e)));
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ channel: "chrome", headless: true, args: ARGS });

async function openPage(query = "", opts = {}) {
  const ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: opts.dsf ?? 1 });
  const page = await ctx.newPage();
  page.setDefaultTimeout(8000);
  const errors = [];
  const warnings = [];
  page.on("pageerror", (e) => errors.push({ kind: "pageerror", text: e.message }));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push({ kind: "console.error", text: m.text().slice(0, 400), url: m.location()?.url });
    if (m.type() === "warning") warnings.push(m.text().slice(0, 400));
  });
  page.on("requestfailed", (r) => errors.push({ kind: "requestfailed", text: `${r.url()} ${r.failure()?.errorText}` }));
  page.on("response", (r) => { if (r.status() >= 400) errors.push({ kind: "http", text: `${r.status()} ${r.url()}` }); });
  // the bare address now opens the national map; these tests exercise the London site
  await page.goto(`${BASE}/?site=london${query ? "&" + query : ""}`, { timeout: 90000 });
  await page.waitForFunction(() => window.__ltt && window.__ltt.getState().ready, null, { timeout: 90000 });
  await page.waitForSelector('[data-testid="year-readout"]', { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(800);
  return { page, ctx, errors, warnings };
}

const tid = (id) => `[data-testid="${id}"]`;
const readout = (page) => page.locator(tid("year-readout")).innerText();
const eraName = (page) => page.locator(tid("era-name")).innerText();
const getT = (page) => page.evaluate(() => window.__ltt.getT());
const getCam = (page) => page.evaluate(() => window.__ltt.getCamera());
const state = (page) => page.evaluate(() => window.__ltt.getState());
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

/** Decode a PNG screenshot in a scratch page and sample a grid of pixels. */
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

// =====================================================================================
const main = await openPage();
const { page, errors } = main;
const data = await page.evaluate(() => ({ eras: window.__lttData.eras, views: window.__lttData.site.views, timeline: window.__lttData.site.timeline }));
const errorsSoFar = () => errors.length;

await inGroup("1 load", async () => {
  const isFavicon = (e) => /favicon\.ico/.test(e.url ?? "") || /favicon\.ico/.test(e.text);
  const fav = errors.filter(isFavicon);
  record("no page errors / console errors / failed requests on load (favicon aside)", errors.filter((e) => !isFavicon(e)).length === 0, JSON.stringify(errors.filter((e) => !isFavicon(e))).slice(0, 600));
  record("no console error for a missing /favicon.ico", fav.length === 0, JSON.stringify(fav));
  if (main.warnings.length) note("console warnings on load", main.warnings);
  const st = await state(page);
  record("engine ready", st.ready === true);
  record("initial year is the last era's preset", (await readout(page)) === `${data.eras.at(-1).presetYear} CE`, await readout(page));
  const canvasCount = await page.locator(`${tid("stage")} canvas`).count();
  record("one WebGL canvas in the stage", canvasCount === 1, `count=${canvasCount}`);
  const shot = await page.screenshot({ clip: { x: 350, y: 180, width: 700, height: 420 } });
  const s = await samplePng(shot);
  record("canvas is non-blank (screenshot pixel sample)", s.distinct >= 12 && s.lumRange > 20, JSON.stringify(s));
  // the same at prehistory, which has no buildings
  await page.evaluate(() => window.__ltt.setT(-3999));
  await settle(page, 600);
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
});

await inGroup("2 timeline endpoints", async () => {
  const slider = page.locator(tid("year-slider"));
  await slider.focus();
  await page.keyboard.press("Home");
  await settle(page);
  record('slider min (Home key) → "4000 BCE"', (await readout(page)) === "4000 BCE", await readout(page));
  record("t at min is -3999", (await getT(page)) === -3999, String(await getT(page)));
  await page.keyboard.press("End");
  await settle(page);
  record('slider max (End key) → "1625 CE"', (await readout(page)) === "1625 CE", await readout(page));
  record("t at max is 1625", (await getT(page)) === 1625, String(await getT(page)));
  await setSlider(page, 0);
  record('slider value 0 → "4000 BCE"', (await readout(page)) === "4000 BCE", await readout(page));
  await setSlider(page, 1);
  record('slider value 1 → "1625 CE"', (await readout(page)) === "1625 CE", await readout(page));
  await setSlider(page, 0.46);
  // 0.46 lies between anchors 410 CE (u .36) and 1066 CE (u .56): 410 + 0.5*656 = 738
  record('slider value 0.46 → "738 CE"', (await readout(page)) === "738 CE", await readout(page));
  const sv = await slider.evaluate((el) => ({ value: +el.value, text: el.getAttribute("aria-valuetext") }));
  record("slider thumb and aria-valuetext follow the year", Math.abs(sv.value - 0.46) < 1e-3 && sv.text === "738 CE", JSON.stringify(sv));
  await page.evaluate(() => window.__ltt.setT(99999));
  await settle(page);
  record("setT(99999) clamps to 1625", (await getT(page)) === 1625 && (await readout(page)) === "1625 CE", `${await getT(page)} ${await readout(page)}`);
  await page.evaluate(() => window.__ltt.setT(-99999));
  await settle(page);
  record("setT(-99999) clamps to 4000 BCE", (await getT(page)) === -3999 && (await readout(page)) === "4000 BCE", `${await getT(page)} ${await readout(page)}`);
  // typed out-of-range years clamp
  await typeYear(page, "9999");
  record('typing "9999" clamps to "1625 CE"', (await readout(page)) === "1625 CE", await readout(page));
  await typeYear(page, "9999 BCE");
  record('typing "9999 BCE" clamps to "4000 BCE"', (await readout(page)) === "4000 BCE", await readout(page));
});

await inGroup("3 BCE/CE transition", async () => {
  const seq = [];
  for (let t = -2; t <= 2.0001; t += 0.5) {
    await page.evaluate((v) => window.__ltt.setT(v), t);
    await settle(page, 220);
    seq.push([t, await readout(page)]);
  }
  const labels = seq.map((x) => x[1]);
  const expected = ["3 BCE", "3 BCE", "2 BCE", "2 BCE", "1 BCE", "1 BCE", "1 CE", "1 CE", "2 CE"];
  record("readout sequence across the boundary", JSON.stringify(labels) === JSON.stringify(expected), JSON.stringify(seq));
  record('no "0" year label', !labels.some((l) => /^0\b/.test(l) || l === "0 CE" || l === "0 BCE"), labels.join(", "));
  const dedup = labels.filter((l, i) => i === 0 || l !== labels[i - 1]);
  record("…, 2 BCE, 1 BCE, 1 CE, 2 CE in order", dedup.slice(-4).join("|") === "2 BCE|1 BCE|1 CE|2 CE", dedup.join(" → "));
  await typeYear(page, "1 BCE");
  record('typed "1 BCE" → readout "1 BCE", t=0', (await readout(page)) === "1 BCE" && (await getT(page)) === 0, `${await readout(page)} t=${await getT(page)}`);
  await typeYear(page, "1 CE");
  record('typed "1 CE" → readout "1 CE", t=1', (await readout(page)) === "1 CE" && (await getT(page)) === 1, `${await readout(page)} t=${await getT(page)}`);
  await typeYear(page, "0");
  record('typed "0" is rejected (year unchanged)', (await readout(page)) === "1 CE", await readout(page));
  await typeYear(page, "55 bc");
  record('typed "55 bc" → "55 BCE"', (await readout(page)) === "55 BCE", await readout(page));
  await typeYear(page, "AD 43");
  record('typed "AD 43" → "43 CE"', (await readout(page)) === "43 CE", await readout(page));
  await typeYear(page, "-1");
  record('typed "-1" → "1 BCE"', (await readout(page)) === "1 BCE", await readout(page));
  // slider across the boundary never shows year 0
  const bad = [];
  for (let u = 0.135; u <= 0.1405; u += 0.0001) {
    await setSlider(page, +u.toFixed(4));
    const r = await readout(page);
    if (/^0 /.test(r)) bad.push([u, r]);
  }
  record("slider sweep across the boundary never shows year 0", bad.length === 0, JSON.stringify(bad));
  // era at the boundary
  await page.evaluate(() => window.__ltt.setT(0.5));
  await settle(page);
  record("era name at 1 BCE is the prehistoric era", (await eraName(page)) === data.eras[0].name, await eraName(page));
});

await inGroup("4 era presets", async () => {
  for (const e of data.eras) {
    const btn = page.locator(tid(`era-${e.id}`));
    let clickErr = "";
    await btn.click({ timeout: 4000 }).catch((err) => { clickErr = err.message.split("\n")[0]; });
    await settle(page, 350);
    const want = e.presetYear < 0 ? `${-e.presetYear} BCE` : `${e.presetYear} CE`;
    const r = await readout(page), n = await eraName(page);
    record(`era-${e.id} → ${want}, "${e.name}"`, !clickErr && r === want && n === e.name, clickErr || `readout=${r} era=${n}`);
    const on = await btn.evaluate((el) => el.classList.contains("on"));
    record(`era-${e.id} button is highlighted`, on);
  }
  const ids = ["prehistoric", "roman", "saxon", "medieval", "tudor", "jacobean"];
  const present = await Promise.all(ids.map((id) => page.locator(tid(`era-${id}`)).count()));
  record("all six era buttons exist", present.every((c) => c === 1), JSON.stringify(present));
});

await inGroup("5 playback", async () => {
  const speedSel = page.locator(tid("speed-select"));
  const measure = async (ms) => {
    const a = await page.evaluate(() => ({ t: window.__ltt.getT(), now: performance.now() }));
    await page.waitForTimeout(ms);
    const b = await page.evaluate(() => ({ t: window.__ltt.getT(), now: performance.now() }));
    return { years: b.t - a.t, secs: (b.now - a.now) / 1000, rate: (b.t - a.t) / ((b.now - a.now) / 1000) };
  };
  await page.evaluate(() => window.__ltt.pause());
  await typeYear(page, "1000");
  await speedSel.selectOption({ label: "5 yr/s" });
  let st = await state(page);
  record("speed select sets 5 yr/s", st.speed === 5 && st.rate === 1, JSON.stringify({ speed: st.speed, rate: st.rate }));
  await page.locator(tid("play-pause")).click();
  await page.waitForTimeout(400);
  st = await state(page);
  record("play-pause starts playback forwards", st.playing && st.direction === 1, JSON.stringify({ playing: st.playing, dir: st.direction }));
  const m5 = await measure(1500);
  record("play forward advances the year", m5.years > 0, JSON.stringify(m5));
  record("5 yr/s plays at about 5 yr/s (±35%)", m5.rate > 3.25 && m5.rate < 6.75, `measured ${m5.rate.toFixed(2)} yr/s`);
  const rBefore = await readout(page);
  await page.waitForTimeout(600);
  record("year readout updates during playback", (await readout(page)) !== rBefore, `${rBefore} → ${await readout(page)}`);
  record("play-pause button shows pause state while playing", (await page.locator(tid("play-pause")).getAttribute("aria-label")) === "Pause");

  await page.locator(tid("play-pause")).click();
  await page.waitForTimeout(150);
  const tp = await getT(page);
  await page.waitForTimeout(700);
  st = await state(page);
  record("pause holds the year", !st.playing && (await getT(page)) === tp, `t ${tp} → ${await getT(page)}`);

  await speedSel.selectOption({ label: "25 yr/s" });
  await page.locator(tid("forward")).click();
  await page.waitForTimeout(400);
  const m25 = await measure(1500);
  record("25 yr/s plays at about 25 yr/s (±35%)", m25.rate > 16.25 && m25.rate < 33.75, `measured ${m25.rate.toFixed(2)} yr/s`);
  const ratio = m25.rate / m5.rate;
  record("changing speed changes the rate (25 vs 5 → ~5×)", ratio > 3 && ratio < 7.5, `ratio ${ratio.toFixed(2)}`);

  await page.locator(tid("reverse")).click();
  await page.waitForTimeout(300);
  const mr = await measure(1000);
  st = await state(page);
  record("reverse decreases the year", mr.years < 0 && st.direction === -1 && st.playing, JSON.stringify(mr));
  record("reverse at 25 yr/s runs at about -25 yr/s (±35%)", mr.rate < -16.25 && mr.rate > -33.75, `measured ${mr.rate.toFixed(2)} yr/s`);
  await page.evaluate(() => window.__ltt.pause());

  // Auto speeds
  await typeYear(page, "1000");
  await speedSel.selectOption({ label: "Auto 1×" });
  await page.locator(tid("forward")).click();
  await page.waitForTimeout(300);
  const ma1 = await measure(1000);
  await speedSel.selectOption({ label: "Auto 2×" });
  await page.waitForTimeout(200);
  const ma2 = await measure(1000);
  await page.evaluate(() => window.__ltt.pause());
  record("Auto 1× advances", ma1.years > 0, JSON.stringify(ma1));
  record("Auto 2× is about twice Auto 1× (±40%)", ma2.rate / ma1.rate > 1.2 && ma2.rate / ma1.rate < 2.8, `ratio ${(ma2.rate / ma1.rate).toFixed(2)}`);

  // Stops at 1625
  await speedSel.selectOption({ label: "25 yr/s" });
  await typeYear(page, "1615");
  await page.locator(tid("forward")).click();
  await page.waitForFunction(() => !window.__ltt.getState().playing, null, { timeout: 5000 }).catch(() => {});
  await settle(page);
  st = await state(page);
  record("playback stops at 1625", !st.playing && st.t === 1625 && (await readout(page)) === "1625 CE", `playing=${st.playing} t=${st.t} readout=${await readout(page)}`);
  record("play button shows play state after stopping", (await page.locator(tid("play-pause")).getAttribute("aria-label")) === "Play");
  await page.locator(tid("play-pause")).click();
  await page.waitForTimeout(500);
  st = await state(page);
  record("pressing play at the end restarts from 4000 BCE", st.playing && st.t < -3900, `playing=${st.playing} t=${st.t}`);
  await page.evaluate(() => window.__ltt.pause());

  // Stops at 4000 BCE
  await typeYear(page, "3990 BCE");
  await page.locator(tid("reverse")).click();
  await page.waitForFunction(() => !window.__ltt.getState().playing, null, { timeout: 5000 }).catch(() => {});
  await settle(page);
  st = await state(page);
  record("reverse playback stops at 4000 BCE", !st.playing && st.t === -3999 && (await readout(page)) === "4000 BCE", `playing=${st.playing} t=${st.t} readout=${await readout(page)}`);
  await page.locator(tid("reverse")).click();
  await page.waitForTimeout(500);
  st = await state(page);
  record("pressing reverse at the start restarts from 1625", st.playing && st.t > 1600 && st.t < 1625, `playing=${st.playing} t=${st.t}`);
  await page.evaluate(() => window.__ltt.pause());

  // Space bar toggles
  await typeYear(page, "1200");
  await page.locator(tid("stage")).click({ position: { x: 20, y: 450 } }).catch(() => {});
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  await page.keyboard.press("Space");
  await page.waitForTimeout(300);
  const sp1 = (await state(page)).playing;
  await page.keyboard.press("Space");
  await page.waitForTimeout(200);
  const sp2 = (await state(page)).playing;
  record("space bar toggles play/pause", sp1 === true && sp2 === false, `${sp1} → ${sp2}`);
  await page.evaluate(() => { window.__ltt.pause(); window.__ltt.setSpeed(5, 1); });
});

await inGroup("6 camera preservation", async () => {
  for (const viewId of [null, "bridge"]) {
    const tag = viewId ?? "default";
    await page.evaluate(() => window.__ltt.pause());
    if (viewId) await page.evaluate((v) => window.__ltt.setView(v), viewId);
    else await page.evaluate(() => window.__ltt.resetView());
    await typeYear(page, "1616");
    await settle(page, 400);
    const c0 = await getCam(page);
    await setSlider(page, 0.3);
    await settle(page, 400);
    record(`[${tag}] camera unchanged after slider change`, camDiff(c0, await getCam(page)) < 1e-6, `diff=${camDiff(c0, await getCam(page))} year=${await readout(page)}`);
    await page.locator(tid("era-medieval")).click();
    await settle(page, 400);
    record(`[${tag}] camera unchanged after era preset`, camDiff(c0, await getCam(page)) < 1e-6, `diff=${camDiff(c0, await getCam(page))} year=${await readout(page)}`);
    await typeYear(page, "55 BCE");
    await settle(page, 400);
    record(`[${tag}] camera unchanged after typed year`, camDiff(c0, await getCam(page)) < 1e-6, `diff=${camDiff(c0, await getCam(page))} year=${await readout(page)}`);
    await typeYear(page, "1500");
    await page.locator(tid("speed-select")).selectOption({ label: "25 yr/s" });
    await page.locator(tid("forward")).click();
    await page.waitForTimeout(2000);
    await page.locator(tid("play-pause")).click();
    await settle(page);
    const t = await getT(page);
    record(`[${tag}] camera unchanged after 2 s playback`, camDiff(c0, await getCam(page)) < 1e-6 && t > 1520, `diff=${camDiff(c0, await getCam(page))} t=${t.toFixed(1)}`);
    await typeYear(page, "4000 BCE");
    await settle(page, 500);
    record(`[${tag}] camera unchanged at 4000 BCE`, camDiff(c0, await getCam(page)) < 1e-6, `diff=${camDiff(c0, await getCam(page))}`);
  }
  // low water-level view: the engine keeps the camera above ground, so report only
  await page.evaluate(() => window.__ltt.setView("bridge-low"));
  await typeYear(page, "1616");
  await settle(page, 400);
  const cl = await getCam(page);
  await typeYear(page, "4000 BCE");
  await settle(page, 500);
  const cl2 = await getCam(page);
  await typeYear(page, "1616");
  await settle(page, 500);
  const cl3 = await getCam(page);
  note("bridge-low camera drift 1616→4000 BCE→1616", { toPrehistory: camDiff(cl, cl2), backAgain: camDiff(cl, cl3), y: [cl.position[1], cl2.position[1], cl3.position[1]] });

  // reset
  const before = errorsSoFar();
  await page.locator(tid("reset-view")).click();
  await settle(page, 400);
  const c = await getCam(page);
  const v0 = data.views[0];
  const d = camDiff(c, { position: v0.position, target: v0.target });
  record("reset view returns to the first view in data", d < 1e-3, `diff=${d} cam=${JSON.stringify(c)}`);
  // view-select
  await page.locator(tid("view-select")).selectOption("city");
  await settle(page, 400);
  const cc = await getCam(page);
  const vc = data.views.find((v) => v.id === "city");
  record("view-select goes to the chosen view", camDiff(cc, { position: vc.position, target: vc.target }) < 1e-3, JSON.stringify(cc));
  // orbit → walk → orbit
  const yearBefore = await readout(page);
  await page.locator(tid("mode-walk")).click();
  await settle(page, 500);
  let st = await state(page);
  const cw = await getCam(page);
  record("walk mode engages", st.mode === "walk" && cw.mode === "walk", JSON.stringify(cw));
  record("walk mode puts the camera at eye height above ground", cw.position[1] > 0 && cw.position[1] < 60, `y=${cw.position[1]}`);
  record("walk hint is shown", (await page.locator(".hint").count()) === 1);
  await page.keyboard.down("KeyW");
  await page.waitForTimeout(600);
  await page.keyboard.up("KeyW");
  const cw2 = await getCam(page);
  const moved = Math.hypot(cw2.position[0] - cw.position[0], cw2.position[2] - cw.position[2]);
  record("W moves the walker", moved > 1, `moved ${moved.toFixed(2)} m`);
  await page.locator(tid("mode-orbit")).click();
  await settle(page, 500);
  st = await state(page);
  const co = await getCam(page);
  record("back to orbit mode", st.mode === "orbit" && co.mode === "orbit" && co.position.every(Number.isFinite) && co.target.every(Number.isFinite), JSON.stringify(co));
  record("mode switches kept the year", (await readout(page)) === yearBefore, `${yearBefore} → ${await readout(page)}`);
  record("no errors during view/mode changes", errorsSoFar() === before, JSON.stringify(errors.slice(before)));
  // mouse orbit drag changes camera, and wheel zooms
  await page.evaluate(() => window.__ltt.resetView());
  await settle(page, 300);
  const d0 = await getCam(page);
  await page.mouse.move(600, 450);
  await page.mouse.down();
  await page.mouse.move(700, 470, { steps: 8 });
  await page.mouse.up();
  await settle(page, 500);
  const d1 = await getCam(page);
  record("mouse drag orbits the camera", camDiff(d0, d1) > 1, `diff=${camDiff(d0, d1).toFixed(2)}`);
  await page.evaluate(() => window.__ltt.resetView());
});

await inGroup("7 landmark lifecycles (live engine)", async () => {
  const stAt = (id, year) => page.evaluate(([id, t]) => window.__ltt.landmarkStatus(id, t), [id, histToT(year) + 0.5]);
  const anyVisible = (s) => s.some((p) => p.height > 0.001);
  const anyIntact = (s) => s.some((p) => p.state === "intact");
  const table = [
    ["forum", 40, "absent"], ["city-wall", 150, "absent"], ["city-wall", 300, "intact"], ["city-wall", 1600, "intact"],
    ["white-tower", 1066, "absent"], ["white-tower", 1101, "intact"],
    ["old-london-bridge", 1150, "absent"], ["old-london-bridge", 1210, "intact"],
    ["nonsuch-house", 1576, "absent"], ["nonsuch-house", 1580, "intact"],
    ["globe", 1598, "absent"], ["globe", 1600, "intact"], ["globe", 1615, "intact"],
    ["royal-exchange", 1565, "absent"], ["royal-exchange", 1572, "intact"],
    ["roman-bridge", 43, "absent"], ["amphitheatre", 600, "absent"],
    ["rose", 1590, "intact"], ["rose", 1606, "absent"], ["bridge-drawbridge-gate", 1580, "absent"],
  ];
  for (const [id, year, want] of table) {
    const s = await stAt(id, year);
    const ok = s.length > 0 && (want === "absent" ? !anyVisible(s) : anyIntact(s));
    record(`${id} ${want} at ${year}`, ok, s.map((p) => `${p.label}:${p.state}/${p.height.toFixed(2)}`).join("; "));
  }
  const g = await stAt("globe", 1613);
  record("first Globe burning/ruined (not intact) mid-1613", !anyIntact(g), JSON.stringify(g));
  const sp = await page.evaluate(() => {
    const lm = window.__lttData.landmarks.find((l) => l.id === "st-pauls");
    const idx = lm.phases.map((p, i) => ("spire" in p.model ? i : -1)).filter((i) => i >= 0);
    const at = (t) => window.__ltt.landmarkStatus("st-pauls", t).filter((s) => idx.includes(s.phaseIndex));
    return { y1500: at(1500.5), y1562: at(1562.5) };
  });
  record("St Paul's spire phase standing 1500, over by 1562", sp.y1500.some((p) => p.state === "intact") && sp.y1562.every((p) => p.height <= 0.001), JSON.stringify(sp));
  record("landmarkStatus of unknown id is empty", (await page.evaluate(() => window.__ltt.landmarkStatus("nope").length)) === 0);

  // Does the scene graph agree with the lifecycle? (uses engine internals; skipped if unavailable)
  const sceneCheck = async (year) => {
    await page.evaluate((t) => window.__ltt.setT(t), histToT(year) + 0.5);
    await settle(page, 400);
    return page.evaluate(() => {
      const layer = window.__ltt.landmarks;
      if (!layer || !layer.entries) return null;
      const bad = [];
      for (const e of layer.entries) {
        const s = window.__ltt.landmarkStatus(e.lm.id).find((x) => x.phaseIndex === e.index);
        const want = s.height > 0.001;
        if (e.group.visible !== want) bad.push(`${e.lm.id}#${e.index} visible=${e.group.visible} status=${s.state}`);
      }
      return { n: layer.entries.length, visible: layer.entries.filter((e) => e.group.visible).length, bad };
    });
  };
  for (const y of [-4000, 40, 150, 1101, 1400, 1598, 1600, 1616]) {
    const r = await sceneCheck(y);
    if (r == null) { note("scene-graph visibility check skipped (internals not reachable)", ""); break; }
    record(`scene-graph visibility matches lifecycle at ${y}`, r.bad.length === 0, `${r.visible}/${r.n} phase meshes visible; ${r.bad.slice(0, 5).join(", ")}`);
    if (y === -4000) {
      const vis = await page.evaluate(() => window.__ltt.landmarks.entries.filter((e) => e.group.visible).map((e) => e.lm.id));
      record("only natural features (streams) are visible at 4000 BCE", vis.every((id) => ["walbrook", "fleet"].includes(id)), vis.join(","));
    }
  }

  // Picking
  await page.evaluate(() => { window.__ltt.pause(); window.__ltt.setView("bridge"); window.__ltt.setT(1616.5); });
  await settle(page, 800);
  const defaultTitle = await page.locator(`${tid("info-panel")} h2`).innerText();
  const pts = [[750, 450], [750, 420], [700, 440], [800, 430], [650, 450], [750, 480], [850, 420], [600, 470], [900, 440], [750, 380], [500, 480], [750, 520]];
  let picked = null;
  const tried = [];
  for (const [x, y] of pts) {
    await page.mouse.click(x, y);
    await settle(page, 300);
    const p = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="info-panel"]');
      const h2 = el.querySelector("h2")?.textContent ?? "";
      const lm = window.__lttData.landmarks.find((l) => l.name === h2);
      return {
        title: h2, isLandmark: !!lm, id: lm?.id, nSources: lm?.sources.length ?? null,
        badges: [...el.querySelectorAll(".badge")].map((b) => b.textContent),
        links: [...el.querySelectorAll(".sources a")].map((a) => ({ href: a.getAttribute("href"), text: a.textContent, target: a.target, rel: a.rel })),
        phases: el.querySelectorAll(".phases li").length, activePhases: el.querySelectorAll(".phases li.on").length,
      };
    });
    tried.push({ x, y, title: p.title, landmark: p.isLandmark });
    if (p.isLandmark) { picked = { x, y, ...p }; break; }
  }
  note("pick attempts", tried);
  record("clicking the canvas on a landmark populates the info panel", !!picked && picked.title !== defaultTitle, picked ? `${picked.title} at (${picked.x},${picked.y})` : "no landmark hit in " + pts.length + " points");
  if (picked) {
    record("info panel shows the landmark name", picked.title.length > 0, picked.title);
    record("info panel shows an evidence badge", picked.badges.some((b) => /Evidence|Reconstruction|Conjecture/.test(b)), picked.badges.join(" | "));
    record("info panel shows at least one source link (landmark has sources)", picked.nSources === 0 || (picked.links.length >= 1 && picked.links.every((l) => /^https?:\/\//.test(l.href))), `${picked.links.length} links for ${picked.nSources} sources`);
    record("number of source links equals number of sources", picked.links.length === picked.nSources, `${picked.links.length} vs ${picked.nSources}`);
    record("source links open in a new tab with rel=noreferrer", picked.links.every((l) => l.target === "_blank" && /noreferrer/.test(l.rel)));
    record("phase list rendered with an active phase", picked.phases >= 1 && picked.activePhases >= 1, `${picked.activePhases}/${picked.phases}`);
    const camBefore = await getCam(page);
    const yBefore = await readout(page);
    await page.locator(`${tid("info-panel")} .close`).click();
    await settle(page);
    record("closing the info panel returns to the era text", (await page.locator(`${tid("info-panel")} h2`).innerText()) === (await eraName(page)));
    record("picking did not move camera or year", camDiff(camBefore, await getCam(page)) < 1e-6 && (await readout(page)) === yBefore);
  }
  // Every landmark with zero sources shows the fallback text rather than nothing: informational list
  const noSrc = await page.evaluate(() => window.__lttData.landmarks.filter((l) => l.sources.length === 0).map((l) => l.id));
  if (noSrc.length) note("landmarks with no sources (panel shows 'No source recorded yet')", noSrc);

  // A landmark that does not exist at the current year must not be pickable: click the same spot in prehistory
  if (picked) {
    await page.evaluate(() => window.__ltt.setT(-3000));
    await settle(page, 600);
    await page.mouse.click(picked.x, picked.y);
    await settle(page, 300);
    const title = await page.locator(`${tid("info-panel")} h2`).innerText();
    const isLm = await page.evaluate((t) => window.__lttData.landmarks.some((l) => l.name === t && !["walbrook", "fleet"].includes(l.id)), title);
    record("no building can be picked at 3000 BCE at the same spot", !isLm, title);
    await page.locator(`${tid("info-panel")} .close`).click({ timeout: 500 }).catch(() => {});
  }
});

await inGroup("8 scope badge", async () => {
  await page.evaluate(() => { window.__ltt.resetView(); window.__ltt.setT(1616.5); });
  await settle(page, 500);
  const a = await page.locator(tid("scope-badge")).innerText();
  record('default view badge reads "Schematic overview"', a.trim().toLowerCase() === "schematic overview", a);
  await page.evaluate(() => window.__ltt.setView("bridge"));
  await settle(page, 500);
  const b = await page.locator(tid("scope-badge")).innerText();
  record('bridge view badge contains "benchmark district"', /benchmark district/i.test(b), b);
  for (const v of data.views) {
    await page.evaluate((id) => window.__ltt.setView(id), v.id);
    await settle(page, 400);
    const txt = await page.locator(tid("scope-badge")).innerText();
    const isDistrict = /benchmark district/i.test(txt);
    record(`badge for view "${v.id}" matches its declared scope (${v.scope})`, isDistrict === (v.scope === "district"), txt);
  }
  await page.evaluate(() => window.__ltt.resetView());
  await settle(page, 400);
  const c = await page.locator(tid("scope-badge")).innerText();
  record("badge returns to overview after reset", c.trim().toLowerCase() === "schematic overview", c);
});

await inGroup("9 quality switch", async () => {
  await page.evaluate(() => { window.__ltt.setView("city"); window.__ltt.setT(1400.5); });
  await settle(page, 500);
  const c0 = await getCam(page), y0 = await readout(page);
  const before = errorsSoFar();
  const seen = {};
  for (const q of ["low", "high", "medium", "low", "medium"]) {
    await page.locator(tid("quality-select")).selectOption(q);
    await page.waitForFunction((q) => window.__ltt.getState().quality === q, q, { timeout: 30000 }).catch(() => {});
    await settle(page, 1200);
    const st = await state(page);
    const stats = await page.evaluate(() => window.__ltt.stats());
    seen[q] = stats;
    const shot = await samplePng(await page.screenshot({ clip: { x: 350, y: 180, width: 700, height: 420 } }));
    record(`quality → ${q}: applied, year and camera kept, still rendering`,
      st.quality === q && (await readout(page)) === y0 && camDiff(c0, await getCam(page)) < 1e-6 && shot.distinct >= 12,
      `quality=${st.quality} year=${await readout(page)} camDiff=${camDiff(c0, await getCam(page))} distinct=${shot.distinct} tris=${stats.triangles} calls=${stats.calls} dpr=${stats.pixelRatio}`);
  }
  record("no errors while switching quality", errorsSoFar() === before, JSON.stringify(errors.slice(before)));
  record("low quality draws fewer triangles than high", seen.low.triangles < seen.high.triangles, `low=${seen.low.triangles} high=${seen.high.triangles}`);
  record("quality select reflects state", (await page.locator(tid("quality-select")).inputValue()) === "medium");
  // evidence toggle
  await page.locator(tid("evidence-toggle")).click();
  await settle(page, 400);
  const ev = (await state(page)).evidence;
  const legend = await page.locator(".legend").count();
  await page.locator(tid("evidence-toggle")).click();
  await settle(page, 300);
  record("evidence toggle switches the tint and legend on and off", ev === true && legend === 1 && (await state(page)).evidence === false && (await page.locator(".legend").count()) === 0);
  const fpsTxt = await page.locator(tid("fps")).innerText();
  record("fps readout shows a number", /^\d+ fps$/.test(fpsTxt.trim()), fpsTxt);
  // GPU memory growth across rebuilds
  const mem0 = await page.evaluate(() => window.__ltt.renderer ? { ...window.__ltt.renderer.info.memory } : null);
  if (mem0) {
    for (let i = 0; i < 3; i++) for (const q of ["low", "medium"]) { await page.evaluate((q) => window.__ltt.setQuality(q), q); await settle(page, 700); }
    const mem1 = await page.evaluate(() => ({ ...window.__ltt.renderer.info.memory }));
    record("geometry count does not grow across repeated quality switches", mem1.geometries <= mem0.geometries * 1.1 + 5, `before=${JSON.stringify(mem0)} after=${JSON.stringify(mem1)}`);
    note("renderer memory before/after 6 quality rebuilds", { mem0, mem1 });
  }
});

group = "session";
{
  const real = errors.filter((e) => !/favicon\.ico/.test((e.url ?? "") + e.text));
  record("no page/console errors during the whole functional run (favicon aside)", real.length === 0, JSON.stringify(real).slice(0, 1200));
}
await main.ctx.close();

await inGroup("11 robustness (isolated page)", async () => {
  const r = await openPage("year=0&view=nonsense&quality=ultra");
  record("bad URL params (year=0, unknown view/quality) fall back without errors", r.errors.filter((e) => !/favicon/.test((e.url ?? "") + e.text)).length === 0 && (await readout(r.page)) === "1616 CE", `${await readout(r.page).catch(() => "no readout")} ${JSON.stringify(r.errors).slice(0, 300)}`);
  await r.ctx.close();
  const b = await openPage("year=55%20BCE&view=bridge");
  record("URL params year=55 BCE & view=bridge are honoured", (await readout(b.page)) === "55 BCE" && /benchmark district/i.test(await b.page.locator(tid("scope-badge")).innerText()), await readout(b.page));
  await b.ctx.close();
  const n = await openPage();
  const before = n.errors.length;
  await n.page.evaluate(() => window.__ltt.setT(NaN));
  await n.page.waitForTimeout(600);
  const tn = await n.page.evaluate(() => window.__ltt.getT());
  const uiAlive = await n.page.locator(tid("year-readout")).count();
  record("setT(NaN) is ignored (year stays finite, UI stays mounted, no page error)", Number.isFinite(tn) && uiAlive === 1 && n.errors.length === before, `t=${tn} readoutPresent=${uiAlive} errors=${JSON.stringify(n.errors.slice(before)).slice(0, 300)}`);
  await n.ctx.close();
});

// =====================================================================================
const perf = { when: new Date().toISOString(), viewport: VIEWPORT, note: "fps is the engine's own rAF average over its last 90 frames after ~3 s; headless Chrome caps rAF at the display rate (60 Hz). benchMs is engine.benchmark(30): synchronous render + readPixels, not vsync-limited.", runs: [] };
if (!NO_PERF && (!ONLY || "perf".includes(ONLY.toLowerCase()))) {
  group = "10 performance";
  const scenarios = [["overview", "1616"], ["city", "1616"], ["bridge", "1616"], ["overview", "4000 BCE"]];
  for (const dsf of [1, 2]) {
    for (const quality of ["low", "medium", "high"]) {
      let p;
      try {
        const t0 = Date.now();
        p = await openPage(`quality=${quality}&year=1616`, { dsf });
        const loadMs = Date.now() - t0;
        for (const [view, year] of scenarios) {
          await p.page.evaluate(([view, year]) => {
            const y = /BCE/.test(year) ? -parseInt(year, 10) : parseInt(year, 10);
            window.__ltt.setView(view);
            window.__ltt.setT((y < 0 ? y + 1 : y) + 0.5);
          }, [view, year]);
          await p.page.waitForTimeout(3200);
          const r = await p.page.evaluate(async () => {
            const stats = window.__ltt.stats();
            // independent rAF count over 1 s
            const raf = await new Promise((res) => {
              let n = 0; const t0 = performance.now();
              const f = (now) => { n++; if (now - t0 >= 1000) res((n * 1000) / (now - t0)); else requestAnimationFrame(f); };
              requestAnimationFrame(f);
            });
            const bench = window.__ltt.benchmark(30).msPerFrame;
            return { ...stats, rafFps: +raf.toFixed(1), benchMs: bench };
          });
          const row = { dsf, quality, view, year, fps: r.fps, rafFps: r.rafFps, frameMs: r.frameMs, worstMs: r.worstMs, benchMs: r.benchMs, benchFps: +(1000 / r.benchMs).toFixed(0), triangles: r.triangles, calls: r.calls, instances: r.instances, trees: r.trees, pixelRatio: r.pixelRatio, size: r.size, loadMs };
          perf.runs.push(row);
          console.log("PERF ", JSON.stringify(row));
        }
        record(`perf run dsf=${dsf} quality=${quality} completed without errors`, p.errors.length === 0, JSON.stringify(p.errors).slice(0, 400));
      } catch (e) {
        record(`perf run dsf=${dsf} quality=${quality} completed`, false, String(e).slice(0, 300));
      } finally {
        await p?.ctx.close();
      }
    }
  }
  writeFileSync(join(HERE, "perf-results.json"), JSON.stringify(perf, null, 2));
}

await browser.close();
const failed = results.filter((r) => !r.pass);
const summary = { when: new Date().toISOString(), base: BASE, passed: results.length - failed.length, failed: failed.length, total: results.length };
writeFileSync(join(HERE, "e2e-results.json"), JSON.stringify({ summary, results, info, perf: perf.runs }, null, 2));
console.log(`\n${summary.passed}/${summary.total} checks passed, ${summary.failed} failed`);
for (const f of failed) console.log(`  FAIL [${f.group}] ${f.name} — ${f.detail.slice(0, 300)}`);
process.exit(failed.length ? 1 : 0);
