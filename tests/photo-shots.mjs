// Photo mode (path-traced stills): live frame and converged photograph side by side, with timings, budgets and memory.
// Usage: node tests/photo-shots.mjs [filter] [samples] [--headed]
//   writes docs/screenshots/photo/<name>-live.png, <name>-photo.png, <name>-pair.png and results.json
// The dev server must already be running (http://127.0.0.1:4310 unless LTT_URL is set).
// Same launch flags as tests/dbg.mjs (headless system Chrome, ANGLE on Metal), plus --expose-gc for the memory check.
import { chromium } from "playwright-core";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";

const BASE = process.env.LTT_URL ?? "http://127.0.0.1:4310";
const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const only = args[0] && args[0] !== "all" ? args[0] : null;
const SAMPLES = parseInt(args[1] ?? "160", 10);
const headed = process.argv.includes("--headed");
const dir = "docs/screenshots/photo";
mkdirSync(dir, { recursive: true });

// [name, site, year, view, camera]. camera: null (the view as defined), { eye, look, pitch } (eye level, walk mode),
// or { focus: landmarkId } (frame a landmark from the view's direction).
const SHOTS = [
  ["london-bridge-low-1616", "london", 1616, "bridge-low", null],
  ["london-bridgehead-1616", "london", 1616, "bridgehead", null],
  ["london-thames-street-1616", "london", 1616, "bridgehead", { eye: [-150, -101], look: [-20, -68], pitch: 0.05 }],
  ["london-bridge-150", "london", 150, "bridge", null],
  ["london-bridge-2000bce", "london", -2000, "bridge", null],
  ["stonehenge-default", "stonehenge", null, null, null],
  ["barnet-1471", "barnet", 1471, "hadley-green", null],
  // landmarks under construction must show partly built, as in the live view
  ["london-bridge-1195-construction", "london", 1195, "bridge", null],
  ["london-westminster-abbey-1450-construction", "london", 1450, "westminster", { focus: "westminster-abbey" }],
  // the other look presets (?look=): overcast and misty dawn skies
  ["london-bridgehead-1616-overcast", "london", 1616, "bridgehead", null, "overcast"],
  ["london-bridge-low-1616-dawn", "london", 1616, "bridge-low", null, "dawn"],
];

const results = existsSync(`${dir}/results.json`) ? JSON.parse(readFileSync(`${dir}/results.json`, "utf8")) : {};
const browser = await chromium.launch({
  channel: "chrome", headless: !headed,
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--js-flags=--expose-gc"],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
page.on("pageerror", (e) => console.error("PAGE ERROR", e.message));
page.on("console", (m) => { if (m.type() === "error") console.log("console:", m.text().slice(0, 300)); });

async function open(site, year, view, look = null) {
  const q = [`site=${site}`, year != null ? `year=${year}` : null, view ? `view=${view}` : null, look ? `look=${look}` : null, "quality=high", "ui=0", "labels=0"].filter(Boolean).join("&");
  await page.goto(`${BASE}/?${q}`, { timeout: 120000 });
  await page.waitForFunction(() => window.__ltt && window.__ltt.getState().ready, null, { timeout: 120000 });
  await page.waitForTimeout(4500);
}

async function setCamera(cam) {
  if (!cam) return;
  if (cam.focus) {
    await page.evaluate((id) => window.__ltt.focusLandmark(id), cam.focus);
    await page.waitForTimeout(2500);
    return;
  }
  // as tests/street-shots.mjs: walk mode stands the camera on the orbit target, facing away from the old position
  for (let k = 0; k < 2; k++) {
    await page.evaluate(([eye, look, pitch]) => {
      const e = window.__ltt;
      const tr = e.terrain;
      const yp = tr.yearParams(e.getT());
      const gy = tr.floor(tr.heightFrom(tr.staticSample(eye[0], eye[1]), yp));
      const dx = look[0] - eye[0], dz = look[1] - eye[1], l = Math.hypot(dx, dz);
      e.setCamera([eye[0] - (dx / l) * 30, gy + 20, eye[1] - (dz / l) * 30], [eye[0], gy, eye[1]]);
      if (e.getState().mode === "walk") e.setMode("orbit");
      e.setMode("walk");
      e.pitch = pitch;
    }, [cam.eye, cam.look, cam.pitch]);
    await page.waitForTimeout(2000);
  }
}

const memory = () => page.evaluate(async () => {
  if (window.gc) { window.gc(); await new Promise((r) => setTimeout(r, 300)); window.gc(); }
  const r = window.__ltt.getRenderContext().renderer.info.memory;
  return { geometries: r.geometries, textures: r.textures, heapMB: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null };
});

async function photo(target, timeoutS = 600) {
  await page.evaluate(() => window.dispatchEvent(new Event("ltt:photo")));
  await page.waitForFunction(() => !!window.__lttPhoto, null, { timeout: 240000 });
  await page.evaluate((n) => window.__lttPhoto.setTarget(n), target);
  const t0 = Date.now();
  let st;
  for (;;) {
    await page.waitForTimeout(1000);
    st = await page.evaluate(() => (window.__lttPhoto ? window.__lttPhoto.getStatus() : { phase: "closed" }));
    if (st.phase === "done" || st.phase === "error" || st.phase === "closed") break;
    if ((Date.now() - t0) / 1000 > timeoutS) { st.timedOut = true; break; }
  }
  return st;
}

async function savePhoto(path, caption = true) {
  const b64 = await page.evaluate(async (cap) => {
    const blob = await window.__lttPhoto.toBlob(cap);
    const buf = new Uint8Array(await blob.arrayBuffer());
    let s = "";
    for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return btoa(s);
  }, caption);
  writeFileSync(path, Buffer.from(b64, "base64"));
  return b64;
}

async function pair(liveB64, photoB64, labelL, labelR, path) {
  const b64 = await page.evaluate(async ([a, b, la, lb]) => {
    const load = (src) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
    const A = await load(`data:image/png;base64,${a}`), B = await load(`data:image/png;base64,${b}`);
    const h = 450, wa = Math.round((A.width * h) / A.height), wb = Math.round((B.width * h) / B.height);
    const cv = document.createElement("canvas");
    cv.width = wa + wb + 6; cv.height = h;
    const c = cv.getContext("2d");
    c.fillStyle = "#111"; c.fillRect(0, 0, cv.width, h);
    c.drawImage(A, 0, 0, wa, h); c.drawImage(B, wa + 6, 0, wb, h);
    c.font = "600 14px system-ui"; c.textBaseline = "top";
    for (const [x, t] of [[8, la], [wa + 14, lb]]) { const w = c.measureText(t).width; c.fillStyle = "rgba(0,0,0,0.6)"; c.fillRect(x - 4, 6, w + 8, 22); c.fillStyle = "#fff"; c.fillText(t, x, 10); }
    return cv.toDataURL("image/png").split(",")[1];
  }, [liveB64, photoB64, labelL, labelR]);
  writeFileSync(path, Buffer.from(b64, "base64"));
}

// Other agents edit the scene while this runs; a hot reload can rebuild the page mid-shot. Such a shot is retried.
async function shot(name, site, year, view, cam, look) {
  {
    await open(site, year, view, look);
    await setCamera(cam);
    const before = await page.evaluate(() => ({ cam: window.__ltt.getCamera(), t: window.__ltt.getT(), q: window.__ltt.getState().quality }));
    const liveBench = await page.evaluate(() => window.__ltt.benchmark(10).msPerFrame);
    const liveStats = await page.evaluate(() => window.__ltt.stats());
    const livePng = await page.screenshot({ path: `${dir}/${name}-live.png` });
    const mem0 = await memory();
    const st = await photo(SAMPLES);
    console.log(JSON.stringify({ phase: st.phase, samples: st.samples, timeToTarget: st.timeToTarget, bakeMs: st.bakeMs, bvhMs: st.bvhMs, tris: st.stats?.triangles, env: st.env, error: st.error }));
    let r = { site, year, view, camera: cam, phase: st.phase, error: st.error ?? null, timedOut: !!st.timedOut };
    if (st.stats) r.tileSizes = st.stats.tileSizes;
    if (st.phase === "done" || (st.phase === "rendering" && st.samples > 0)) {
      const photoB64 = await savePhoto(`${dir}/${name}-photo.png`, true);
      if (name === "london-bridge-low-1616") await savePhoto(`${dir}/${name}-photo-uncaptioned.png`, false);
      // the on-screen mode (panel, caption) once, for the documentation
      if (name === "london-bridgehead-1616") await page.screenshot({ path: `${dir}/${name}-onscreen.png` });
      await pair(livePng.toString("base64"), photoB64, `Live view (raster), ${liveBench} ms/frame`, `Photo mode (path traced, ${st.samples} samples, ${st.timeToTarget ?? st.elapsed} s)`, `${dir}/${name}-pair.png`);
      const memIn = await memory();
      await page.evaluate(() => window.__lttPhoto?.exit("test"));
      await page.waitForTimeout(800);
      const mem1 = await memory();
      const after = await page.evaluate(() => ({ cam: window.__ltt.getCamera(), t: window.__ltt.getT(), q: window.__ltt.getState().quality }));
      const same = JSON.stringify(after) === JSON.stringify(before);
      r = {
        ...r, samples: st.samples, target: st.target, timeToTargetS: st.timeToTarget, samplesPerSecond: st.timeToTarget ? +(st.samples / st.timeToTarget).toFixed(2) : null,
        bakeMs: st.bakeMs, bvhMs: st.bvhMs, size: st.size, env: st.env, envInfo: st.envInfo ?? null, look: look ?? "clear", exposure: st.exposure, snapshot: st.stats,
        liveMsPerFrame: liveBench, liveTriangles: liveStats.triangles, liveCalls: liveStats.calls,
        memory: { before: mem0, inPhoto: memIn, afterExit: mem1 }, liveRestored: same, before, after,
      };
    } else {
      r.message = st.message;
      await page.evaluate(() => window.__lttPhoto?.exit("test"));
    }
    return r;
  }
}

for (const [name, site, year, view, cam, look] of SHOTS) {
  if (only && !only.split(",").some((o) => name === o || (!only.includes(",") && name.includes(o)))) continue;
  for (let attempt = 1; attempt <= 3; attempt++) {
    console.log(`--- ${name} (attempt ${attempt})`);
    let r;
    try {
      r = await shot(name, site, year, view, cam, look);
    } catch (e) {
      console.error(name, "failed:", e.message);
      r = { error: e.message };
    }
    r.attempts = attempt;
    results[name] = r;
    writeFileSync(`${dir}/results.json`, JSON.stringify(results, null, 1));
    if (r.phase === "done") break;
  }
}

// 2× resolution: re-render the low river view at twice the screen size and save it
if (!only || only === "2x") {
  console.log("--- 2x");
  try {
    await open("london", 1616, "bridge-low");
    await photo(4);
    await page.evaluate(() => { window.__lttPhoto.setResolution(2); window.__lttPhoto.setTarget(96); });
    let st;
    for (let i = 0; i < 600; i++) {
      await page.waitForTimeout(1000);
      st = await page.evaluate(() => window.__lttPhoto?.getStatus() ?? { phase: "closed" });
      if (st.phase === "done" || st.phase === "closed" || st.phase === "error") break;
    }
    if (st.phase === "done") await savePhoto(`${dir}/london-bridge-low-1616-photo-2x.png`, true);
    results["london-bridge-low-1616-2x"] = { phase: st.phase, size: st.size, samples: st.samples, timeToTargetS: st.timeToTarget, memory: await memory() };
    await page.evaluate(() => window.__lttPhoto?.exit("test"));
  } catch (e) {
    results["london-bridge-low-1616-2x"] = { error: e.message };
  }
  writeFileSync(`${dir}/results.json`, JSON.stringify(results, null, 1));
}

// repeated enter/exit: renderer memory and JS heap must not grow
if (!only || only === "memory") {
  console.log("--- memory cycles");
  try {
    await open("london", 1616, "bridgehead");
    const cycles = [await memory()];
    for (let i = 0; i < 4; i++) {
      const st = await photo(8);
      await page.evaluate(() => window.__lttPhoto?.exit("test"));
      await page.waitForTimeout(800);
      const m = await memory();
      cycles.push({ ...m, phase: st.phase, tris: st.stats?.triangles });
      console.log(JSON.stringify(cycles[cycles.length - 1]));
    }
    results["memory-cycles"] = cycles;
  } catch (e) {
    results["memory-cycles"] = { error: e.message };
  }
  writeFileSync(`${dir}/results.json`, JSON.stringify(results, null, 1));
}
await browser.close();
