// Fixed views of the ordinary house fabric (realism round): eye level, rooftop, bridgehead, bridge-low and city,
// in several periods. Usage: node tests/house-shots.mjs <label> [--only=substr,substr] [--tris=1] [--qs=houses=plain]
//   writes docs/screenshots/realism/houses/<label>/<shot>.png (+ stats.json with triangle counts)
//   --tris=1 also records the scene's triangles with the fabric hidden, so the houses' share can be read off.
// The dev server must already be running (http://127.0.0.1:4310 unless LTT_URL is set).
import { chromium } from "playwright-core";
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = process.env.LTT_URL ?? "http://127.0.0.1:4310";
const args = process.argv.slice(2);
const label = args.find((a) => !a.startsWith("--")) ?? "current";
const opt = (k, d) => {
  const a = args.find((x) => x.startsWith(`--${k}=`));
  return a ? a.slice(k.length + 3) : d;
};
const only = opt("only", null);
const tris = opt("tris", "0") === "1";
// extra query string, e.g. --qs=houses=plain (the fabric without this round's shape, wear, windows and alternates)
const qs = opt("qs", "");

// `legacy`: the camera sequence of tests/street-shots.mjs and the first ("before") capture of this script, which on its second
// pass re-aims the walk camera about 70 m ahead along the street; kept for those views so before and after pairs match
const EYE_FSH = { eye: [63, -184], look: [40, -118], pitch: 0.07, legacy: true };
// [name, year, view, camera]: camera = eye-level {eye, look, pitch} or free {pos, target}
const SHOTS = [];
for (const y of [150, 900, 1300, 1616]) {
  SHOTS.push([`eye-fish-street-hill-${y}`, y, "bridgehead", EYE_FSH]);
  SHOTS.push([`roofs-${y}`, y, "bridgehead", { pos: [135, 24, -200], target: [60, 6, -175] }]);
  for (const v of ["bridgehead", "bridge-low", "city"]) SHOTS.push([`${v}-${y}`, y, v, null]);
}
for (const y of [1300, 1616]) {
  // close facades across Fish Street Hill (its east frontage)
  SHOTS.push([`facade-${y}`, y, "bridgehead", { eye: [61, -189], look: [80, -186], pitch: 0.12 }]);
  SHOTS.push([`shopfront-${y}`, y, "bridgehead", { eye: [64, -196], look: [80, -186], pitch: 0.08 }]);
}
SHOTS.push(["eye-fish-street-hill-1050", 1050, "bridgehead", EYE_FSH]);
SHOTS.push(["eye-roman-street-150", 150, "bridgehead", { eye: [-20, -140], look: [30, -140], pitch: 0.06 }]);
SHOTS.push(["eye-thames-street-1616", 1616, "bridgehead", { eye: [-150, -101], look: [-20, -68], pitch: 0.05, legacy: true }]);
SHOTS.push(["eye-lane-1616", 1616, "bridgehead", { eye: [112, -128], look: [117, -220], pitch: 0.08, legacy: true }]);
SHOTS.push(["eye-borough-high-street-1616", 1616, "bridgehead", { eye: [-150, 410], look: [-96, 300], pitch: 0.06, legacy: true }]);

const dir = `docs/screenshots/realism/houses/${label}`;
mkdirSync(dir, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
const errors = [];
page.on("pageerror", (e) => { errors.push(e.message); console.error("PAGE ERROR", e.message); });
page.on("console", (m) => { if (m.type() === "error") { errors.push(m.text()); console.log("console:", m.text().slice(0, 400)); } });
const stats = { label, shots: {} };

async function open(year, view) {
  await page.goto("about:blank");
  await page.goto(`${BASE}/?site=london&year=${year}&view=${view}&quality=high&ui=0&labels=0${qs ? `&${qs}` : ""}`, { timeout: 120000 });
  await page.waitForFunction(() => window.__ltt && window.__ltt.getState().ready, null, { timeout: 120000 });
  await page.waitForTimeout(3000);
}
async function eyeLevel(cam) {
  for (let pass = 0; pass < 2; pass++) {
    await page.evaluate(({ eye, look, pitch, h, legacy }) => {
      const e = window.__ltt;
      const tr = e.terrain;
      const yp = tr.yearParams(e.getT());
      const gy = tr.floor(tr.heightFrom(tr.staticSample(eye[0], eye[1]), yp));
      const dx = look[0] - eye[0], dz = look[1] - eye[1], l = Math.hypot(dx, dz);
      // leave walk mode first: leaving it re-aims the orbit target 70 m ahead, which would move the walk camera
      if (!legacy && e.getState().mode === "walk") e.setMode("orbit");
      e.setCamera([eye[0] - (dx / l) * 30, gy + 20, eye[1] - (dz / l) * 30], [eye[0], gy, eye[1]]);
      if (legacy && e.getState().mode === "walk") e.setMode("orbit");
      e.setMode("walk");
      e.pitch = pitch;
      if (h) e.eye = h;
    }, cam);
    await page.waitForTimeout(1200);
  }
}

for (const [name, year, view, cam] of SHOTS) {
  if (only && !only.split(",").some((o) => name.includes(o))) continue;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await open(year, view);
      if (cam?.eye) await eyeLevel(cam);
      else if (cam?.pos) {
        await page.evaluate(({ pos, target }) => {
          const e = window.__ltt;
          const tr = e.terrain;
          const yp = tr.yearParams(e.getT());
          const gy = tr.floor(tr.heightFrom(tr.staticSample(target[0], target[2]), yp));
          e.setCamera([pos[0], gy + pos[1], pos[2]], [target[0], gy + target[1], target[2]]);
        }, cam);
        await page.waitForTimeout(1500);
      }
      await page.waitForTimeout(1500);
      if (cam?.eye && !cam.legacy) {
        // a hot reload from another save can reset the camera: insist on walk mode at eye height
        const ok = await page.evaluate((eye) => {
          const e = window.__ltt, p = e.camera.position;
          return e.getState().mode === "walk" && Math.hypot(p.x - eye[0], p.z - eye[1]) < 0.5;
        }, cam.eye);
        if (!ok) throw new Error("camera not at the eye point in walk mode");
      }
      const s = await page.evaluate((withTris) => {
        const e = window.__ltt;
        e.benchmark(3);
        const all = e.stats().triangles;
        let noFabric = null;
        if (withTris) {
          e.fabric.root.visible = false;
          e.benchmark(2);
          noFabric = e.stats().triangles;
          e.fabric.root.visible = true;
          e.benchmark(3);
        }
        // the fabric's own triangles in the main view: visible instanced meshes x their live instance count
        let fabric = 0;
        e.fabric.root.traverse((m) => {
          if (!m.isInstancedMesh || !m.visible || !m.count) return;
          const g = m.geometry;
          fabric += ((g.index ? g.index.count : g.attributes.position.count) / 3) * m.count;
        });
        return { triangles: all, noFabric, houses: noFabric == null ? null : all - noFabric, fabric: Math.round(fabric) };
      }, tris);
      if (process.env.DEBUG_CAM) console.log(name, "camera", JSON.stringify(await page.evaluate(() => { const e = window.__ltt; return { p: e.camera.position.toArray().map((v) => +v.toFixed(1)), yaw: +e.yaw.toFixed(2), pitch: e.pitch, mode: e.getState().mode }; })));
      await page.screenshot({ path: `${dir}/${name}.png` });
      stats.shots[name] = s;
      console.log(name, JSON.stringify(s));
      break;
    } catch (e) {
      console.error("retry", name, e.message.slice(0, 200));
    }
  }
}
stats.errors = errors.slice(0, 40);
writeFileSync(`${dir}/stats.json`, JSON.stringify(stats, null, 2));
await browser.close();
