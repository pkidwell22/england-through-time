// End-to-end checks for the Brentford and Barnet site viewers against a running server (default http://127.0.0.1:4310).
// Usage: node tests/sites-e2e.mjs [--no-perf] [--only=<substring of group name>] [--site=brentford|barnet]
// Writes tests/sites-results.json. Exit code 1 if any check fails.
// A group with failures is re-run once (the dev server can hot-reload while src/scene is being edited);
// first-attempt failures are kept in results.retried.
import { chromium } from "playwright-core";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.LTT_URL ?? "http://127.0.0.1:4310";
const NO_PERF = process.argv.includes("--no-perf");
const ONLY = process.argv.find((a) => a.startsWith("--only="))?.slice(7);
const SITE_ONLY = process.argv.find((a) => a.startsWith("--site="))?.slice(7);
const ARGS = ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"];
const VIEWPORT = { width: 1500, height: 900 };
const SITES = {
  brentford: { start: 950, end: 1100, battle: 1016, eras: ["late-saxon", "early-norman"], episode: "brentford-1016", initial: 1016 },
  barnet: { start: 1400, end: 1500, battle: 1471, eras: ["before-the-battle", "battle-and-after"], episode: "barnet-1471", initial: 1471 },
};

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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ARGS });
const isFavicon = (e) => /favicon\.ico/.test(e.url ?? "") || /favicon\.ico/.test(e.text);
const tid = (id) => `[data-testid="${id}"]`;
const histToT = (y) => (y < 0 ? y + 1 : y);
const fmt = (y) => (y < 0 ? `${-y} BCE` : `${y} CE`);

async function openSite(site, query = "", opts = {}) {
  const ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: opts.dsf ?? 1 });
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  const errors = [];
  const warnings = [];
  page.on("pageerror", (e) => errors.push({ kind: "pageerror", text: e.message }));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push({ kind: "console.error", text: m.text().slice(0, 400), url: m.location()?.url });
    if (m.type() === "warning") warnings.push(m.text().slice(0, 800));
    if (/\[Fast Refresh\]|Fast Refresh had to perform a full reload|\[HMR\]/i.test(m.text())) reloadSuspected = true;
  });
  page.on("requestfailed", (r) => errors.push({ kind: "requestfailed", text: `${r.url()} ${r.failure()?.errorText}` }));
  page.on("response", (r) => { if (r.status() >= 400) errors.push({ kind: "http", text: `${r.status()} ${r.url()}` }); });
  await page.goto(`${BASE}/?site=${site}${query ? "&" + query : ""}`, { timeout: 120000 });
  await page.waitForFunction(() => window.__ltt && window.__ltt.getState().ready, null, { timeout: 150000 });
  await page.waitForSelector(tid("year-readout"), { timeout: 30000 }).catch(() => {});
  await page.evaluate(() => { window.__testMarker = 1; });
  await page.waitForTimeout(opts.settle ?? 900);
  return { page, ctx, errors, warnings };
}

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
    return { distinct: colours.size, lumRange: max - min };
  }, { b64: buf.toString("base64"), grid });
  await ctx.close();
  return out;
}

const mains = {};
async function ensure(site) {
  let m = mains[site];
  const alive = m && (await m.page.evaluate(() => window.__testMarker === 1 && !!window.__ltt && window.__ltt.getState().ready && !!document.querySelector('[data-testid="year-readout"]')).catch(() => false));
  if (!alive) {
    if (m) { reloadSuspected = true; console.log(`NOTE  ${site} page lost its state (reload/HMR); reopening`); await m.ctx.close().catch(() => {}); }
    m = mains[site] = await openSite(site);
    m.loadErrors = m.errors.slice();
    m.loadWarnings = m.warnings.slice();
  } else await m.page.evaluate(() => { window.__ltt.pause(); window.__ltt.setSpeed(5, 1); });
  return m;
}

async function inGroup(name, site, fn) {
  if (ONLY && !name.toLowerCase().includes(ONLY.toLowerCase())) return;
  if (SITE_ONLY && SITE_ONLY !== site) return;
  group = `${site} ${name}`;
  for (let attempt = 1; attempt <= 2; attempt++) {
    groupBuf = [];
    reloadSuspected = false;
    try {
      const m = await ensure(site);
      await fn(m.page, m, SITES[site]);
    } catch (e) {
      record("group ran to completion", false, e && e.stack ? e.stack.split("\n").slice(0, 3).join(" | ") : String(e));
    }
    const bad = groupBuf.filter((r) => !r.pass);
    if (!bad.length) return;
    if (attempt === 1) {
      retried.push({ group, looksLikeHotReload: reloadSuspected, firstAttemptFailures: bad.map((b) => ({ name: b.name, detail: b.detail.slice(0, 300) })) });
      console.log(`RETRY [${group}] ${bad.length} failure(s)${reloadSuspected ? " (reload/HMR seen)" : ""}; re-running once`);
      results = results.filter((r) => !groupBuf.includes(r));
    }
  }
}

// ======================================================================================
for (const site of Object.keys(SITES)) {
  const S = SITES[site];

  await inGroup("1 load", site, async (page, m) => {
    const real = m.loadErrors.filter((e) => !isFavicon(e));
    record("no page errors / console errors / failed requests on load (favicon aside)", real.length === 0, JSON.stringify(real).slice(0, 600));
    record("no console error for a missing /favicon.ico", m.loadErrors.filter(isFavicon).length === 0, JSON.stringify(m.loadErrors.filter(isFavicon)));
    const probs = m.loadWarnings.filter((w) => /problem\(s\)|Dataset/i.test(w));
    record("dataset validator reports no problems", probs.length === 0, probs.join(" || ").slice(0, 1500));
    if (m.loadWarnings.length) note("console warnings on load", m.loadWarnings.map((w) => w.slice(0, 400)));
    const problems = await page.evaluate(async () => (window.__lttData ? [] : ["no data"]));
    record("engine ready, dataset exposed", (await state(page)).ready && problems.length === 0);
    record(`site id is ${site}`, (await page.evaluate(() => window.__lttData.site.id)) === site);
    record(`opens at the site's initial year (${S.initial} CE)`, (await readout(page)) === `${S.initial} CE`, await readout(page));
    record("one WebGL canvas in the stage", (await page.locator(`${tid("stage")} canvas`).count()) === 1);
    const s = await samplePng(await page.screenshot({ clip: { x: 350, y: 180, width: 700, height: 420 } }));
    record("canvas is non-blank", s.distinct >= 12 && s.lumRange > 20, JSON.stringify(s));
    for (const y of [S.start, S.end]) {
      await page.evaluate((t) => window.__ltt.setT(t), histToT(y) + 0.5);
      await settle(page, 600);
      const q = await samplePng(await page.screenshot({ clip: { x: 350, y: 180, width: 700, height: 420 } }));
      record(`canvas is non-blank at ${fmt(y)}`, q.distinct >= 10 && q.lumRange > 15, JSON.stringify(q));
    }
    await page.evaluate((y) => window.__ltt.setT(y + 0.5), S.initial);
    const gl = await page.evaluate(() => { const c = document.querySelector('[data-testid="stage"] canvas'); const g = c.getContext("webgl2") || c.getContext("webgl"); return { lost: g ? g.isContextLost() : null }; });
    record("WebGL context alive", gl.lost === false);
    record("fps readout shows a number", /^\d+ fps$/.test((await page.locator(tid("fps")).innerText()).trim()), await page.locator(tid("fps")).innerText());
    const lm = await page.evaluate(() => ({ n: window.__lttData.landmarks.length, z: window.__lttData.zones.length, e: window.__lttData.episodes.length, ev: window.__lttData.events.length }));
    note("dataset counts", lm);
  });

  await inGroup("2 timeline endpoints", site, async (page) => {
    const slider = page.locator(tid("year-slider"));
    await slider.focus();
    await page.keyboard.press("Home");
    await settle(page);
    record(`slider min → "${fmt(S.start)}"`, (await readout(page)) === fmt(S.start), await readout(page));
    record(`t at min is ${histToT(S.start)}`, (await getT(page)) === histToT(S.start), String(await getT(page)));
    await page.keyboard.press("End");
    await settle(page);
    record(`slider max → "${fmt(S.end)}"`, (await readout(page)) === fmt(S.end), await readout(page));
    record(`t at max is ${histToT(S.end)}`, (await getT(page)) === histToT(S.end), String(await getT(page)));
    const ends = await page.locator(".ends span").allInnerTexts();
    record(`timeline end labels read ${fmt(S.start)} and ${fmt(S.end)}`, ends[0] === fmt(S.start) && ends[ends.length - 1] === fmt(S.end), JSON.stringify(ends));
    await page.evaluate(() => window.__ltt.setT(99999));
    await settle(page);
    record(`setT(99999) clamps to ${fmt(S.end)}`, (await getT(page)) === histToT(S.end), String(await getT(page)));
    await page.evaluate(() => window.__ltt.setT(-99999));
    await settle(page);
    record(`setT(-99999) clamps to ${fmt(S.start)}`, (await getT(page)) === histToT(S.start), String(await getT(page)));
    await typeYear(page, "9999");
    record(`typing "9999" clamps to ${fmt(S.end)}`, (await readout(page)) === fmt(S.end), await readout(page));
    await typeYear(page, "100 BCE");
    record(`typing "100 BCE" clamps to ${fmt(S.start)}`, (await readout(page)) === fmt(S.start), await readout(page));
    await typeYear(page, String(S.battle));
    record(`typed ${S.battle} works`, (await readout(page)) === fmt(S.battle), await readout(page));
    await setSlider(page, 0);
    record(`slider 0 → ${fmt(S.start)}; slider 1 → ${fmt(S.end)}`, (await readout(page)) === fmt(S.start) && (await (async () => { await setSlider(page, 1); return readout(page); })()) === fmt(S.end));
    const scale = await page.evaluate(() => window.__lttData.site.timeline.scale);
    const mid = scale[1];
    await setSlider(page, mid.u);
    record(`slider at the middle anchor (u=${mid.u}) reads ${fmt(mid.year)}`, (await readout(page)) === fmt(mid.year), await readout(page));
    await page.evaluate(() => window.__ltt.setT(NaN));
    record("setT(NaN) is ignored", Number.isFinite(await getT(page)));
  });

  await inGroup("3 era presets", site, async (page) => {
    const eras = await page.evaluate(() => window.__lttData.eras);
    record(`${eras.length} eras defined: ${eras.map((e) => e.id).join(", ")}`, JSON.stringify(eras.map((e) => e.id)) === JSON.stringify(S.eras), JSON.stringify(eras.map((e) => e.id)));
    for (const e of eras) {
      const btn = page.locator(tid(`era-${e.id}`));
      let err = "";
      await btn.click({ timeout: 4000 }).catch((x) => { err = x.message.split("\n")[0]; });
      await settle(page, 350);
      const want = fmt(e.presetYear);
      record(`era-${e.id} → ${want}, "${e.name}"`, !err && (await readout(page)) === want && (await eraName(page)) === e.name, err || `readout=${await readout(page)} era=${await eraName(page)}`);
      record(`era-${e.id} button highlighted`, await btn.evaluate((el) => el.classList.contains("on")));
    }
    for (const e of eras) for (const y of [e.from, e.to]) {
      await page.evaluate((t) => window.__ltt.setT(t), histToT(y) + 0.5);
      await settle(page, 120);
      if ((await eraName(page)) !== e.name) record(`era boundary ${fmt(y)} shows "${e.name}"`, false, await eraName(page));
    }
    record("era boundaries (first/last year of each era) show the right era", groupBuf.every((r) => r.pass));
  });

  await inGroup("4 playback", site, async (page) => {
    const speedSel = page.locator(tid("speed-select"));
    const measure = async (ms) => {
      const a = await page.evaluate(() => ({ t: window.__ltt.getT(), now: performance.now() }));
      await page.waitForTimeout(ms);
      const b = await page.evaluate(() => ({ t: window.__ltt.getT(), now: performance.now() }));
      return { years: b.t - a.t, rate: (b.t - a.t) / ((b.now - a.now) / 1000) };
    };
    const mid = Math.round((S.start + S.end) / 2);
    await typeYear(page, String(S.start + 10));
    await speedSel.selectOption({ label: "5 yr/s" });
    await page.locator(tid("play-pause")).click();
    await page.waitForTimeout(400);
    let st = await state(page);
    record("play starts forwards", st.playing && st.direction === 1);
    const m5 = await measure(1500);
    record("5 yr/s plays at about 5 yr/s (±35%)", m5.rate > 3.25 && m5.rate < 6.75, `measured ${m5.rate.toFixed(2)}`);
    record("play-pause shows pause state while playing", (await page.locator(tid("play-pause")).getAttribute("aria-label")) === "Pause");
    await page.locator(tid("play-pause")).click();
    await page.waitForTimeout(150);
    const tp = await getT(page);
    await page.waitForTimeout(600);
    record("pause holds the year", !(await state(page)).playing && (await getT(page)) === tp);
    await speedSel.selectOption({ label: "25 yr/s" });
    await page.locator(tid("forward")).click();
    await page.waitForTimeout(300);
    const m25 = await measure(1200);
    record("25 yr/s plays at about 25 yr/s (±35%)", m25.rate > 16.25 && m25.rate < 33.75, `measured ${m25.rate.toFixed(2)}`);
    await page.locator(tid("reverse")).click();
    await page.waitForTimeout(150);
    const mr = await measure(700);
    record("reverse decreases the year", mr.rate < 0 && (await state(page)).direction === -1, `measured ${mr.rate.toFixed(2)}`);
    await page.evaluate(() => window.__ltt.pause());
    // stops at the end
    await speedSel.selectOption({ label: "25 yr/s" });
    await typeYear(page, String(S.end - 8));
    await page.locator(tid("forward")).click();
    await page.waitForFunction(() => !window.__ltt.getState().playing, null, { timeout: 8000 }).catch(() => {});
    await settle(page);
    st = await state(page);
    record(`playback stops at ${fmt(S.end)}`, !st.playing && st.t === histToT(S.end) && (await readout(page)) === fmt(S.end), `playing=${st.playing} t=${st.t} readout=${await readout(page)}`);
    await page.locator(tid("play-pause")).click();
    await page.waitForTimeout(500);
    st = await state(page);
    record(`pressing play at the end restarts from ${fmt(S.start)}`, st.playing && st.t < histToT(S.start) + 15, `playing=${st.playing} t=${st.t}`);
    await page.evaluate(() => window.__ltt.pause());
    await typeYear(page, String(S.start + 8));
    await page.locator(tid("reverse")).click();
    await page.waitForFunction(() => !window.__ltt.getState().playing, null, { timeout: 8000 }).catch(() => {});
    await settle(page);
    st = await state(page);
    record(`reverse playback stops at ${fmt(S.start)}`, !st.playing && st.t === histToT(S.start) && (await readout(page)) === fmt(S.start), `playing=${st.playing} t=${st.t}`);
    await page.locator(tid("reverse")).click();
    await page.waitForTimeout(500);
    st = await state(page);
    record(`pressing reverse at the start restarts from ${fmt(S.end)}`, st.playing && st.t > histToT(S.end) - 15 && st.t < histToT(S.end), `t=${st.t}`);
    await page.evaluate(() => window.__ltt.pause());
    // Auto speed advances (whole timeline in 150 s?)
    await typeYear(page, String(mid));
    await speedSel.selectOption({ label: "Auto 1×" });
    await page.locator(tid("forward")).click();
    await page.waitForTimeout(300);
    const ma = await measure(1000);
    await page.evaluate(() => window.__ltt.pause());
    record("Auto 1× advances", ma.years > 0, JSON.stringify(ma));
    await typeYear(page, String(mid));
    await page.evaluate(() => document.activeElement && document.activeElement.blur());
    await page.keyboard.press("Space");
    await page.waitForTimeout(300);
    const a = (await state(page)).playing;
    await page.keyboard.press("Space");
    await page.waitForTimeout(200);
    record("space bar toggles play/pause", a === true && (await state(page)).playing === false);
    await page.evaluate(() => window.__ltt.setSpeed(5, 1));
  });

  await inGroup("5 camera preservation", site, async (page) => {
    const views = await page.evaluate(() => window.__lttData.site.views.map((v) => v.id));
    for (const viewId of [null, views[1]]) {
      const tag = viewId ?? "default";
      await page.evaluate(() => window.__ltt.pause());
      if (viewId) await page.evaluate((v) => window.__ltt.setView(v), viewId);
      else await page.evaluate(() => window.__ltt.resetView());
      await typeYear(page, String(S.battle));
      await settle(page, 500);
      const c0 = await getCam(page);
      // the engine keeps the target on the ground and the camera above it, so a sub-metre nudge as terrain changes with the year is tolerated (and reported)
      const chk = async (what) => { const d = camDiff(c0, await getCam(page)); record(`[${tag}] camera unchanged (<1 m) ${what}`, d < 1.0, `diff=${d.toExponential(2)} m year=${await readout(page)}`); };
      await setSlider(page, 0.2);
      await settle(page, 400);
      await chk("after slider change");
      await page.locator(tid(`era-${S.eras[0]}`)).click();
      await settle(page, 400);
      await chk("after era preset");
      await typeYear(page, String(S.start + 20));
      await chk("after typed year");
      await page.locator(tid("speed-select")).selectOption({ label: "25 yr/s" });
      await typeYear(page, String(S.start + 5));
      await page.locator(tid("forward")).click();
      await page.waitForTimeout(1500);
      await page.locator(tid("play-pause")).click();
      await settle(page);
      await chk("after playback");
      await typeYear(page, String(S.start));
      await settle(page, 400);
      await chk(`at ${fmt(S.start)}`);
    }
    await page.locator(tid("reset-view")).click();
    await settle(page, 400);
    const c = await getCam(page);
    const v0 = await page.evaluate(() => window.__lttData.site.views[0]);
    record("reset view returns to the first view in data (target snapped to ground allowed, <5 m)", camDiff(c, { position: v0.position, target: v0.target }) < 5, `diff=${camDiff(c, { position: v0.position, target: v0.target }).toFixed(3)} cam=${JSON.stringify(c)} declared=${JSON.stringify({ position: v0.position, target: v0.target })}`);
    for (const id of views) {
      await page.locator(tid("view-select")).selectOption(id);
      await settle(page, 350);
      const v = await page.evaluate((id) => window.__lttData.site.views.find((x) => x.id === id), id);
      const cc = await getCam(page);
      record(`view "${id}" frames its declared camera (ground clearance adjustment allowed, <12 m)`, camDiff(cc, { position: v.position, target: v.target }) < 12, `diff=${camDiff(cc, { position: v.position, target: v.target }).toFixed(3)} declared y=${v.position[1]} actual y=${cc.position[1].toFixed(2)}`);
      record(`view "${id}": camera is finite and above ground (y>0)`, cc.position.every(Number.isFinite) && cc.position[1] > 0, `y=${cc.position[1]}`);
    }
    await page.evaluate(() => window.__ltt.resetView());
    await settle(page, 300);
    const d0 = await getCam(page);
    await page.mouse.move(600, 450);
    await page.mouse.down();
    await page.mouse.move(700, 470, { steps: 8 });
    await page.mouse.up();
    await settle(page, 500);
    record("mouse drag orbits the camera", camDiff(d0, await getCam(page)) > 1, `diff=${camDiff(d0, await getCam(page)).toFixed(2)}`);
    await page.evaluate(() => window.__ltt.resetView());
    await page.locator(tid("mode-walk")).click();
    await settle(page, 500);
    const cw = await getCam(page);
    record("walk mode engages with the camera at eye height", cw.mode === "walk" && cw.position.every(Number.isFinite), JSON.stringify(cw));
    await page.locator(tid("mode-orbit")).click();
    await settle(page, 400);
    record("back to orbit mode", (await getCam(page)).mode === "orbit");
  });

  await inGroup("6 episode and conjectural staging", site, async (page, m) => {
    const ds = await page.evaluate(() => ({ episodes: window.__lttData.episodes.map((e) => ({ id: e.id, name: e.name, year: e.year, fraction: e.fraction, inMap: e.inMap, attested: e.attested?.length ?? 0, tradition: e.tradition?.length ?? 0, unknown: e.unknown?.length ?? 0, sources: e.sources?.length ?? 0, evidence: e.evidence, confidence: e.confidence })) }));
    record("exactly one episode", ds.episodes.length === 1, JSON.stringify(ds.episodes.map((e) => e.id)));
    const ep = ds.episodes[0];
    record(`episode "${ep.id}" has year ${S.battle}`, ep.year === S.battle, String(ep.year));
    const opts = await page.locator(`${tid("event-select")} option`).allInnerTexts();
    record("Events menu lists the episode with its year", opts.some((o) => o.includes(ep.name) && o.includes(fmt(S.battle))), JSON.stringify(opts));
    await typeYear(page, String(S.start + 3));
    await page.locator(tid("event-select")).selectOption(ep.id);
    await settle(page, 700);
    record(`choosing the episode jumps to ${fmt(S.battle)}`, (await readout(page)) === fmt(S.battle) && Math.floor(await getT(page)) === histToT(S.battle), `${await readout(page)} t=${await getT(page)}`);
    const panel = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="info-panel"]');
      return {
        h2: el.querySelector("h2")?.textContent ?? "",
        badges: [...el.querySelectorAll(".badge")].map((b) => b.textContent),
        h3: [...el.querySelectorAll("h3")].map((h) => h.textContent),
        facts: [...el.querySelectorAll("ul.facts")].map((u) => ({ cls: u.className, n: u.querySelectorAll("li").length })),
        links: el.querySelectorAll(".sources a").length,
        eyebrow: el.querySelector(".eyebrow")?.textContent ?? "",
        text: el.textContent ?? "",
      };
    });
    record("episode panel opens with the episode name", panel.h2 === ep.name, panel.h2);
    record("panel lists Well evidenced / Tradition or late sources / Not known", ["Well evidenced", "Tradition or late sources"].every((h) => panel.h3.includes(h)) && panel.h3.some((h) => /Not known/.test(h)), JSON.stringify(panel.h3));
    record("attested / tradition / unknown lists match the data counts", panel.facts.length === 3 && panel.facts[0].n === ep.attested && panel.facts[1].n === ep.tradition && panel.facts[2].n === ep.unknown, JSON.stringify({ panel: panel.facts, data: [ep.attested, ep.tradition, ep.unknown] }));
    record("episode panel shows evidence/confidence badges and sources", panel.badges.length >= 2 && panel.links === ep.sources, JSON.stringify({ badges: panel.badges, links: panel.links, sources: ep.sources }));
    record("episode date note is shown", panel.eyebrow.length > 5, panel.eyebrow.slice(0, 120));
    note("episode panel", { badges: panel.badges, lists: panel.facts });
    // ?event= deep link
    const r = await openSite(site, `event=${ep.id}`);
    record("?event=<id> deep link jumps to the battle year and opens its panel", (await readout(r.page)) === fmt(S.battle) && (await r.page.locator(`${tid("info-panel")} h2`).innerText()) === ep.name, `${await readout(r.page)} / ${await r.page.locator(`${tid("info-panel")} h2`).innerText()}`);
    await r.ctx.close();

    // ---- staged landmarks present only in the battle year ----
    const staged = await page.evaluate(() => window.__lttData.landmarks.filter((l) => l.phases.some((p) => p.model.kind === "troops" || p.model.kind === "zone-marker")).map((l) => ({ id: l.id, name: l.name, evidence: l.evidence, confidence: l.confidence, kinds: l.phases.map((p) => p.model.kind), phases: l.phases.map((p) => [p.from, p.to]), sources: l.sources.length })));
    record(`${staged.length} staged landmarks (troops / zone-marker) exist`, staged.length >= 5, staged.map((s) => s.id).join(", "));
    const status = (id, y) => page.evaluate(([id, t]) => window.__ltt.landmarkStatus(id, t), [id, histToT(y) + 0.5]);
    const vis = (s) => s.some((p) => p.height > 0.001);
    for (const l of staged) {
      const before = await status(l.id, S.battle - 1), at = await status(l.id, S.battle), after = await status(l.id, S.battle + 1);
      const early = await status(l.id, S.start), late = await status(l.id, S.end);
      record(`${l.id}: absent in ${S.battle - 1}, present in ${S.battle}, absent in ${S.battle + 1}`, !vis(before) && vis(at) && !vis(after), JSON.stringify({ before: before.map((x) => x.state), at: at.map((x) => x.state), after: after.map((x) => x.state) }));
      record(`${l.id}: absent at ${fmt(S.start)} and ${fmt(S.end)}`, !vis(early) && !vis(late));
    }
    // scene graph agrees
    for (const [y, expectVisible] of [[S.battle - 1, false], [S.battle, true], [S.battle + 1, false]]) {
      await page.evaluate((t) => window.__ltt.setT(t), histToT(y) + 0.5);
      await settle(page, 500);
      const r2 = await page.evaluate((ids) => {
        const layer = window.__ltt.landmarks;
        if (!layer?.entries) return null;
        const per = {};
        for (const e of layer.entries) if (ids.includes(e.lm.id)) per[e.lm.id] = (per[e.lm.id] ?? false) || e.group.visible;
        return per;
      }, staged.map((s) => s.id));
      if (r2 == null) { note("scene-graph check skipped", "engine internals not reachable"); break; }
      const wrong = Object.entries(r2).filter(([, v]) => v !== expectVisible).map(([k]) => k);
      record(`scene graph: staged landmarks ${expectVisible ? "visible" : "hidden"} in ${y}`, wrong.length === 0, wrong.join(", "));
    }
    // labelled conjectural in the info panel (select via the real landmark label or the engine's select event)
    for (const l of staged) {
      await page.evaluate((t) => window.__ltt.setT(t), histToT(S.battle) + 0.5);
      await page.evaluate((id) => {
        const lm = window.__lttData.landmarks.find((x) => x.id === id);
        for (const cb of window.__ltt.selectListeners) cb({ type: "landmark", landmark: lm });
      }, l.id);
      await settle(page, 250);
      const pn = await page.evaluate(() => {
        const el = document.querySelector('[data-testid="info-panel"]');
        return { h2: el.querySelector("h2")?.textContent, badges: [...el.querySelectorAll(".badge")].map((b) => b.textContent), noSource: /No source recorded yet/.test(el.textContent), links: el.querySelectorAll(".sources a").length, unc: el.querySelector(".uncertain")?.textContent ?? "" };
      });
      record(`${l.id}: panel is labelled conjectural ("Conjecture" badge) and as a stand-in`, pn.h2 === l.name && pn.badges.some((b) => /^Conjecture$/.test(b)) && pn.badges.some((b) => /Stand-in/.test(b)), JSON.stringify(pn.badges));
      record(`${l.id}: panel shows low confidence${l.kinds.includes("troops") || l.kinds.includes("zone-marker") ? "" : ""}`, pn.badges.some((b) => /Confidence: low/.test(b)), JSON.stringify(pn.badges));
      record(`${l.id}: panel says what is not known / sources or no-source text present`, pn.unc.length > 20 && (pn.links > 0 || pn.noSource), `unc=${pn.unc.length} chars links=${pn.links}`);
    }
    // names make the staging obvious too
    const unlabeled = staged.filter((l) => !/conjectur|stand-in|by modern reconstruction|area of possibility|suggested|registered|possible/i.test(l.name));
    note("staged landmarks whose own name does not say stand-in/conjecture (the panel badges do; informational)", unlabeled.map((l) => l.name));
    // try a real click on one troop block (informational)
    const target = staged.find((l) => l.kinds.includes("troops"));
    await page.evaluate((t) => window.__ltt.setT(t), histToT(S.battle) + 0.5);
    await page.evaluate((id) => { window.__ltt.setView(window.__lttData.episodes[0].id ? "overview" : "overview"); window.__ltt.goToEpisode(window.__lttData.episodes[0].id); }, target.id);
    await settle(page, 800);
    const proj = await page.evaluate((id) => {
      const e = window.__ltt.landmarks.entries.find((x) => x.lm.id === id && x.group.visible);
      if (!e) return null;
      const box = e.group.userData.box;
      const v = (box ? box.getCenter(new window.__ltt.camera.position.constructor()) : e.group.position.clone()).project(window.__ltt.camera);
      const r = document.querySelector('[data-testid="stage"] canvas').getBoundingClientRect();
      return { x: (v.x * 0.5 + 0.5) * r.width + r.left, y: (-v.y * 0.5 + 0.5) * r.height + r.top, z: v.z };
    }, target.id);
    if (!proj) note("real click on troop block skipped", "entry not reachable");
    else {
      await page.mouse.click(proj.x, proj.y);
      await settle(page, 400);
      const title = await page.locator(`${tid("info-panel")} h2`).innerText();
      note("real mouse click at projected troop block", { at: [Math.round(proj.x), Math.round(proj.y)], panelTitle: title, expected: target.name });
    }
  });

  await inGroup("7 data validity", site, async (page) => {
    const bad = await page.evaluate(() => {
      const ds = window.__lttData;
      const EV = new Set(["attested-standing", "attested-excavated", "attested-documentary", "attested-pictorial", "reconstructed", "conjectural"]);
      const CF = new Set(["high", "medium", "low"]);
      const o = { landmarks: [], zones: [], episodes: [], sources: [], years: [], tiers: [] };
      const src = (w, ids) => { for (const s of ids ?? []) if (!ds.sources[s]) o.sources.push(`${w}: unknown source ${s}`); };
      for (const l of ds.landmarks) {
        if (!EV.has(l.evidence)) o.landmarks.push(`${l.id}: evidence ${l.evidence}`);
        if (!CF.has(l.confidence)) o.landmarks.push(`${l.id}: confidence ${l.confidence}`);
        if (!["district", "overview"].includes(l.tier)) o.tiers.push(`${l.id}: tier ${l.tier}`);
        if (l.phases.some((p) => p.model.kind === "troops") && l.evidence !== "conjectural") o.landmarks.push(`${l.id}: troops must be conjectural`);
        if (l.phases.some((p) => p.model.kind === "zone-marker") && l.evidence !== "conjectural") o.landmarks.push(`${l.id}: zone-marker must be conjectural`);
        if (!l.summary || !l.name) o.landmarks.push(`${l.id}: missing name/summary`);
        if (!(l.sources ?? []).length) o.landmarks.push(`${l.id}: no sources`);
        src(`landmark ${l.id}`, l.sources);
        for (const p of l.phases) for (const k of ["from", "to", "built"]) { const y = p[k]; if (y != null && (!Number.isInteger(y) || y === 0 || y < ds.site.timeline.start - 0 && false)) o.years.push(`${l.id}.${k}=${y}`); }
        // phases dated before the site's window (but allowed) are reported
        for (const p of l.phases) if (p.from < ds.site.timeline.start || p.from > ds.site.timeline.end) o.years.push(`${l.id}: phase from ${p.from} outside the window ${ds.site.timeline.start}–${ds.site.timeline.end}`);
        // phases in order and not overlapping
        l.phases.forEach((p, i) => { if (i > 0) { const q = l.phases[i - 1]; const h = (y) => (y < 0 ? y + 1 : y); if (q.to != null && h(p.from) < h(q.to) && !p.continues) o.years.push(`${l.id}: phase ${i} starts ${p.from} before phase ${i - 1} ends ${q.to}`); if (h(p.from) < h(q.from)) o.years.push(`${l.id}: phases out of order`); } });
      }
      for (const z of ds.zones) {
        if (!EV.has(z.evidence)) o.zones.push(`${z.id}: evidence ${z.evidence}`);
        if (!CF.has(z.confidence)) o.zones.push(`${z.id}: confidence ${z.confidence}`);
        if (z.evidence.startsWith("attested")) o.zones.push(`${z.id}: generic fill must never be "attested" (${z.evidence})`);
        if (!(z.sources ?? []).length) o.zones.push(`${z.id}: no sources`);
        src(`zone ${z.id}`, z.sources);
        const [g0, g1] = z.grow;
        if (!Number.isInteger(g0) || !Number.isInteger(g1) || g0 === 0 || g1 === 0 || g1 < g0) o.years.push(`zone ${z.id}: grow ${z.grow}`);
        if (z.decline && (z.decline[1] < z.decline[0] || z.decline[0] < g1)) o.years.push(`zone ${z.id}: decline ${z.decline} before growth ends`);
      }
      for (const e of ds.episodes) {
        if (!EV.has(e.evidence)) o.episodes.push(`${e.id}: evidence ${e.evidence}`);
        if (!CF.has(e.confidence)) o.episodes.push(`${e.id}: confidence ${e.confidence}`);
        src(`episode ${e.id}`, e.sources);
      }
      return o;
    });
    for (const [k, v] of Object.entries(bad)) record(`${k}: every evidence/confidence/source/date is valid`, v.length === 0, v.slice(0, 10).join(" || "));
    const conj = await page.evaluate(() => ({ landmarks: window.__lttData.landmarks.length, zones: window.__lttData.zones.length, byEv: Object.fromEntries([...window.__lttData.landmarks, ...window.__lttData.zones].reduce((m, x) => m.set(x.evidence, (m.get(x.evidence) ?? 0) + 1), new Map())) }));
    note("evidence mix across landmarks and zones", conj);
    // every landmark opens a well-formed panel
    const badPanels = [];
    const ids = await page.evaluate(() => window.__lttData.landmarks.map((l) => l.id));
    for (const id of ids) {
      await page.evaluate((id) => { const lm = window.__lttData.landmarks.find((x) => x.id === id); for (const cb of window.__ltt.selectListeners) cb({ type: "landmark", landmark: lm }); }, id);
      await page.waitForTimeout(20);
      const p = await page.evaluate(() => { const el = document.querySelector('[data-testid="info-panel"]'); return { h2: el.querySelector("h2")?.textContent, ev: el.querySelector(".badge")?.textContent, phases: el.querySelectorAll(".phases li").length, src: el.querySelectorAll(".sources a").length, nosrc: /No source recorded yet/.test(el.textContent) }; });
      const lm = await page.evaluate((id) => { const l = window.__lttData.landmarks.find((x) => x.id === id); return { name: l.name, phases: l.phases.length, src: l.sources.length }; }, id);
      if (p.h2 !== lm.name || p.phases !== lm.phases || !/Evidence|Reconstruction|Conjecture/.test(p.ev ?? "") || (lm.src ? p.src < 1 : !p.nosrc)) badPanels.push(`${id}: ${JSON.stringify(p)}`);
    }
    record(`all ${ids.length} landmark info panels render name, evidence badge, phases and sources`, badPanels.length === 0, badPanels.slice(0, 5).join(" || "));
    // zone panels
    const zr = await page.evaluate(() => window.__lttData.zones.map((z) => z.id));
    const zbad = [];
    for (const id of zr) {
      await page.evaluate((id) => { const z = window.__lttData.zones.find((x) => x.id === id); for (const cb of window.__ltt.selectListeners) cb({ type: "zone", zone: z }); }, id);
      await page.waitForTimeout(20);
      const p = await page.evaluate(() => { const el = document.querySelector('[data-testid="info-panel"]'); return { h2: el.querySelector("h2")?.textContent, b: [...el.querySelectorAll(".badge")].map((x) => x.textContent) }; });
      if (!p.h2 || p.b.length < 2) zbad.push(`${id}: ${JSON.stringify(p)}`);
    }
    record(`all ${zr.length} zone info panels render`, zbad.length === 0, zbad.join(" || "));
  });

  await inGroup("8 scope badge", site, async (page) => {
    const views = await page.evaluate(() => window.__lttData.site.views.map((v) => ({ id: v.id, scope: v.scope })));
    const district = await page.evaluate(() => !!window.__lttData.site.district);
    record("site declares no benchmark district (whole site schematic)", district === false);
    for (const v of [{ id: null }, ...views]) {
      await page.evaluate((id) => (id ? window.__ltt.setView(id) : window.__ltt.resetView()), v.id);
      await settle(page, 350);
      const txt = (await page.locator(tid("scope-badge")).innerText()).trim();
      record(`scope badge in view ${v.id ?? "(reset)"} reads "Schematic site"`, /^schematic site$/i.test(txt), txt);
    }
  });

  await inGroup("9 quality switch", site, async (page, m) => {
    await page.evaluate((y) => { window.__ltt.resetView(); window.__ltt.setT(y + 0.5); }, S.battle);
    await settle(page, 500);
    const c0 = await getCam(page), y0 = await readout(page);
    const before = m.errors.length;
    const seen = {};
    for (const q of ["low", "high", "medium", "low", "medium"]) {
      await page.locator(tid("quality-select")).selectOption(q);
      await page.waitForFunction((q) => window.__ltt.getState().quality === q, q, { timeout: 30000 }).catch(() => {});
      await settle(page, 1200);
      const st = await state(page);
      const stats = await page.evaluate(() => window.__ltt.stats());
      seen[q] = stats;
      const shot = await samplePng(await page.screenshot({ clip: { x: 350, y: 180, width: 700, height: 420 } }));
      record(`quality → ${q}: applied, year and camera kept, still rendering`, st.quality === q && (await readout(page)) === y0 && camDiff(c0, await getCam(page)) < 1e-6 && shot.distinct >= 12, `quality=${st.quality} year=${await readout(page)} camDiff=${camDiff(c0, await getCam(page))} distinct=${shot.distinct} tris=${stats.triangles} calls=${stats.calls} dpr=${stats.pixelRatio}`);
    }
    record("no errors while switching quality", m.errors.length === before, JSON.stringify(m.errors.slice(before)).slice(0, 300));
    record("low quality draws no more triangles than high", seen.low.triangles <= seen.high.triangles, `low=${seen.low.triangles} high=${seen.high.triangles}`);
    record("quality select reflects state", (await page.locator(tid("quality-select")).inputValue()) === "medium");
    await page.locator(tid("evidence-toggle")).click();
    await settle(page, 300);
    const ev = (await state(page)).evidence, legend = await page.locator(".legend").count();
    await page.locator(tid("evidence-toggle")).click();
    record("evidence toggle works", ev === true && legend === 1 && (await state(page)).evidence === false);
    const mem0 = await page.evaluate(() => (window.__ltt.renderer ? { ...window.__ltt.renderer.info.memory } : null));
    if (mem0) {
      for (let i = 0; i < 3; i++) for (const q of ["low", "medium"]) { await page.evaluate((q) => window.__ltt.setQuality(q), q); await settle(page, 600); }
      const mem1 = await page.evaluate(() => ({ ...window.__ltt.renderer.info.memory }));
      record("geometry count does not grow across repeated quality switches", mem1.geometries <= mem0.geometries * 1.1 + 5, `before=${JSON.stringify(mem0)} after=${JSON.stringify(mem1)}`);
    }
  });
}

// ---- perf --------------------------------------------------------------------------------
const perf = { when: new Date().toISOString(), viewport: VIEWPORT, note: "fps = engine rAF average after ~3 s (60 Hz cap); benchMs = engine.benchmark(30) synchronous render + readPixels. dsf=1.", runs: [] };
if (!NO_PERF && (!ONLY || "perf".includes(ONLY.toLowerCase()))) {
  group = "perf";
  groupBuf = [];
  for (const site of Object.keys(SITES)) {
    if (SITE_ONLY && SITE_ONLY !== site) continue;
    const S = SITES[site];
    for (const quality of ["low", "medium", "high"]) {
      let p;
      try {
        const t0 = Date.now();
        p = await openSite(site, `quality=${quality}&year=${S.battle}`);
        const loadMs = Date.now() - t0;
        const views = await p.page.evaluate(() => window.__lttData.site.views.map((v) => v.id));
        for (const view of views) {
          for (const year of [S.battle - 1, S.battle]) {
            await p.page.evaluate(([view, y]) => { window.__ltt.setView(view); window.__ltt.setT(y + 0.5); }, [view, year]);
            await p.page.waitForTimeout(2800);
            const r = await p.page.evaluate(async () => {
              const stats = window.__ltt.stats();
              const raf = await new Promise((res) => { let n = 0; const t0 = performance.now(); const f = (now) => { n++; if (now - t0 >= 1000) res((n * 1000) / (now - t0)); else requestAnimationFrame(f); }; requestAnimationFrame(f); });
              return { ...stats, rafFps: +raf.toFixed(1), benchMs: window.__ltt.benchmark(30).msPerFrame };
            });
            const row = { site, quality, view, year: `${year} CE`, fps: r.fps, rafFps: r.rafFps, frameMs: r.frameMs, worstMs: r.worstMs, benchMs: r.benchMs, benchFps: +(1000 / r.benchMs).toFixed(0), triangles: r.triangles, calls: r.calls, instances: r.instances, trees: r.trees, pixelRatio: r.pixelRatio, loadMs };
            perf.runs.push(row);
            console.log("PERF ", JSON.stringify(row));
          }
        }
        record(`perf run ${site} quality=${quality} completed without errors`, p.errors.filter((e) => !isFavicon(e)).length === 0, JSON.stringify(p.errors).slice(0, 400));
      } catch (e) {
        record(`perf run ${site} quality=${quality} completed`, false, String(e).slice(0, 300));
      } finally {
        await p?.ctx.close().catch(() => {});
      }
    }
  }
}

group = "session";
groupBuf = [];
for (const [site, m] of Object.entries(mains)) {
  const real = m.errors.filter((e) => !isFavicon(e));
  record(`${site}: no page/console errors during the whole run (favicon aside)`, real.length === 0, JSON.stringify(real).slice(0, 1000));
  await m.ctx.close().catch(() => {});
}
await browser.close();
const failed = results.filter((r) => !r.pass);
const summary = { when: new Date().toISOString(), base: BASE, passed: results.length - failed.length, failed: failed.length, total: results.length };
writeFileSync(join(HERE, "sites-results.json"), JSON.stringify({ summary, results, retried, info, perf: perf.runs }, null, 2));
console.log(`\n${summary.passed}/${summary.total} checks passed, ${summary.failed} failed`);
for (const f of failed) console.log(`  FAIL [${f.group}] ${f.name} — ${f.detail.slice(0, 300)}`);
for (const r of retried) console.log(`  RETRIED [${r.group}] ${r.firstAttemptFailures.length} first-attempt failure(s)${r.looksLikeHotReload ? " (hot-reload suspected)" : ""}`);
process.exit(failed.length ? 1 : 0);
