// Figures before/after: eye-level views 2, 8 and 25 m from a standing figure, a wide view, and the Barnet 1471 battle.
// Usage: node tests/figure-shots.mjs [after|before|both] [filter]
//   writes docs/screenshots/realism/figures/{after,before}/*.png (and cameras.json, chosen on the "after" pass so that
//   "before" (?figures=blocks) uses the same cameras). The dev server must be running (LTT_URL, default :4310).
// Eye-level cameras use walk mode, entered after the orbit camera has been placed (see shoot()).
import { chromium } from "playwright-core";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const BASE = process.env.LTT_URL ?? "http://127.0.0.1:4310";
const which = process.argv[2] ?? "both";
const only = process.argv[3] ?? null;
const ROOT = "docs/screenshots/realism/figures";
const CAMS = `${ROOT}/cameras.json`;
const SCENES = [
  // 2400 BCE: the data has no settlement in use near the monument (Durrington's village is dated c. 2506-2494 BCE),
  // so the populace is empty in both passes; 2500 BCE shows the village's figures
  { name: "stonehenge-2400bce", q: "site=stonehenge&year=2400%20BCE", wide: "" },
  // the populace places no people at Stonehenge in any year (the Durrington village style has no street life in the
  // populace code); the prehistoric dress is seen in London's Late Bronze Age farmsteads
  { name: "london-1000bce", q: "site=london&year=1000%20BCE", wide: "&view=bridgehead", focus: [51.507, -0.098], high: true },
  { name: "london-150", q: "site=london&year=150", wide: "&view=bridgehead" },
  { name: "london-900", q: "site=london&year=900", wide: "&view=bridgehead", focus: [51.512, -0.092] },
  { name: "london-1300", q: "site=london&year=1300", wide: "&view=bridgehead" },
  { name: "london-1616", q: "site=london&year=1616", wide: "&view=bridgehead" },
  { name: "barnet-1471", q: "site=barnet&year=1471", wide: "", troops: true },
];
const DISTS = [2, 8, 25];

const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1400, height: 850 }, deviceScaleFactor: 1 });
page.on("pageerror", (e) => console.error("PAGE ERROR", e.message));
page.on("console", (m) => { if (m.type() === "error") console.log("console:", m.text().slice(0, 300)); });

async function open(q, extra) {
  await page.goto(`${BASE}/?${q}${extra}&quality=high&ui=0&labels=0`, { timeout: 180000 });
  await page.waitForFunction(() => window.__ltt && window.__ltt.getState().ready, null, { timeout: 150000 });
  // figures load after the scene is ready; give them (and the populace tiles) time
  await page.waitForTimeout(8000);
}

/** After pass: choose a standing figure with a clear view to 25 m and return cameras for each distance. */
async function chooseCivil(minPres = 0.7, clear = 27) {
  return page.evaluate(([dists, minPres, clear]) => {
    const e = window.__ltt;
    let f = null, w = null;
    e.scene.traverse((o) => { if (o.name === "populace") { f = o.userData.figures; w = o.userData.populace; } });
    if (!f || !w) return null;
    const t = e.getT();
    const rec = f.people, d = rec.data, S = 27;
    const tgt = e.getCamera().target;
    const cands = [];
    for (let i = 0; i < rec.n; i++) {
      const o = i * S;
      if (d[o + 4] > 0.5 || d[o + 17] < minPres || d[o + 23] > 2.5) continue; // standing (not seated), fully present
      cands.push([Math.hypot(d[o] - tgt[0], d[o + 1] - tgt[2]), d[o], d[o + 8], d[o + 1], Math.atan2(d[o + 2], d[o + 3])]);
    }
    cands.sort((a, b) => a[0] - b[0]);
    for (const [, x, y, z, yaw] of clear > 0 ? cands.slice(0, 60) : []) {
      for (const da of [0, 0.5, -0.5, 1, -1, 1.6, -1.6]) {
        const a = yaw + da, dx = Math.sin(a), dz = Math.cos(a);
        let ok = true;
        const tr = e.terrain, yp = tr.yearParams(t);
        for (let s = 1.2; s <= clear && ok; s += 0.8) {
          const px = x + dx * s, pz = z + dz * s;
          if (!w.free(px, pz, t, null, false)) ok = false;
          // level ground: no quay edge, wall or bank between the camera and the figure
          else if (Math.abs(tr.floor(tr.heightFrom(tr.staticSample(px, pz), yp)) - y) > 0.6) ok = false;
        }
        if (!ok) continue;
        return dists.filter((D) => D < clear).map((D) => ({ D, pos: [x + dx * D, y + 1.6, z + dz * D], tgt: [x, y + (D < 4 ? 1.35 : D < 12 ? 1.1 : 0.9), z] }));
      }
    }
    // no standing figure with a clear view: a walker, seen along its street (streets are clear along their length)
    const tm = f.time;
    const tr2 = e.terrain, yp2 = tr2.yearParams(t);
    const gnd = (px, pz) => tr2.floor(tr2.heightFrom(tr2.staticSample(px, pz), yp2));
    let wk = null, wd = 1e9;
    for (let i = 0; i < rec.n; i++) {
      const o = i * S, L = d[o + 4];
      if (L < 14 || d[o + 17] < minPres) continue;
      const cyc = d[o + 5] + (tm * d[o + 6]) / (2 * L);
      const u = cyc - Math.floor(cyc), tri = 0.5 - 0.5 * Math.cos(2 * Math.PI * u);
      const x = d[o] + d[o + 2] * tri * L + d[o + 3] * d[o + 7], z = d[o + 1] + d[o + 3] * tri * L - d[o + 2] * d[o + 7];
      const dd = Math.hypot(x - tgt[0], z - tgt[2]);
      if (dd >= wd) continue;
      const sgn = u < 0.5 ? 1 : -1, wy = (d[o + 8] + d[o + 11]) / 2;
      // the camera stands on the same street: dry, level, clear of houses and landmarks
      let ok = true;
      for (let s2 = 2; s2 <= 27 && ok; s2 += 1) {
        const px = x + d[o + 2] * sgn * s2, pz = z + d[o + 3] * sgn * s2;
        if (!w.free(px, pz, t, null, false) || Math.abs(gnd(px, pz) - wy) > 0.8 || (tr2.hasRiver && gnd(px, pz) < 0.6)) ok = false;
      }
      if (ok) { wd = dd; wk = [x, wy, z, d[o + 2] * sgn, d[o + 3] * sgn]; }
    }
    if (!wk) return null;
    const [x, y, z, dx, dz] = wk;
    return dists.map((D) => ({ D, pos: [x + dx * (D + 1.5), y + 1.6, z + dz * (D + 1.5)], tgt: [x + dx * 1.5, y + (D < 4 ? 1.35 : D < 12 ? 1.1 : 0.9), z + dz * 1.5] }));
  }, [DISTS, minPres, clear]);
}

/** Barnet: stand in front of a formation's front rank, facing a soldier (works with blocks or figures). */
async function chooseTroops() {
  return page.evaluate((dists) => {
    const e = window.__ltt;
    let best = null;
    e.scene.traverse((o) => {
      const tr = o.userData && o.userData.troops;
      if (!tr || best) return;
      const s = tr.spots;
      const n = s.length / 5;
      const rot = s[3], fx = Math.cos(rot), fz = -Math.sin(rot);
      let cx = 0, cz = 0;
      for (let i = 0; i < n; i++) { cx += s[i * 5]; cz += s[i * 5 + 2]; }
      cx /= n; cz /= n;
      let bi = 0, bv = -1e9;
      for (let i = 0; i < n; i++) {
        const along = (s[i * 5] - cx) * fx + (s[i * 5 + 2] - cz) * fz;
        const side = Math.abs((s[i * 5] - cx) * fz - (s[i * 5 + 2] - cz) * fx);
        const v = along * 10 - side;
        if (v > bv) { bv = v; bi = i; }
      }
      best = { x: s[bi * 5], y: s[bi * 5 + 1] + 0.05, z: s[bi * 5 + 2], fx, fz };
    });
    if (!best) return null;
    const { x, y, z, fx, fz } = best;
    // a little to one side so the rank recedes into the picture
    return dists.map((D) => ({ D, pos: [x + fx * D + fz * D * 0.35, y + 1.6, z + fz * D - fx * D * 0.35], tgt: [x, y + (D < 4 ? 1.35 : 1.0), z] }));
  }, DISTS);
}

async function shoot(cams, dir, name, high = false) {
  for (const c of cams) {
    if (high) {
      // over tall vegetation: an orbit camera about 3.5 m up instead of walk mode's 1.7 m eye
      await page.evaluate((c) => {
        const e = window.__ltt;
        if (e.getState().mode === "walk") e.setMode("orbit");
        e.controls.minDistance = 0.3;
        e.setCamera([c.pos[0], c.tgt[1] + 2.6, c.pos[2]], c.tgt);
      }, c);
      await page.waitForTimeout(1500);
      await page.screenshot({ path: `${dir}/${name}-eye-${c.D}m.png` });
      continue;
    }
    // walk mode stands the camera on the orbit target at eye height (1.7 m), facing away from the orbit camera: leave walk
    // mode first, place the orbit camera behind the eye point, then enter walk mode and tilt towards the figure
    await page.evaluate((c) => {
      const e = window.__ltt;
      if (e.getState().mode === "walk") e.setMode("orbit");
      const dx = c.tgt[0] - c.pos[0], dz = c.tgt[2] - c.pos[2], l = Math.hypot(dx, dz) || 1;
      const tr = e.terrain, yp = tr.yearParams(e.getT());
      const gy = tr.floor(tr.heightFrom(tr.staticSample(c.pos[0], c.pos[2]), yp));
      e.setCamera([c.pos[0] - (dx / l) * 30, gy + 20, c.pos[2] - (dz / l) * 30], [c.pos[0], gy, c.pos[2]]);
      e.setMode("walk");
      e.pitch = Math.atan2(c.tgt[1] - (gy + 1.7), l);
    }, c);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${dir}/${name}-eye-${c.D}m.png` });
  }
  await page.evaluate(() => { const e = window.__ltt; if (e.getState().mode === "walk") e.setMode("orbit"); });
}

const cams = existsSync(CAMS) ? JSON.parse(readFileSync(CAMS, "utf8")) : {};
const passes = which === "both" ? ["after", "before"] : [which];
for (const pass of passes) {
  const dir = `${ROOT}/${pass}`;
  mkdirSync(dir, { recursive: true });
  const extra = pass === "before" ? "&figures=blocks" : "";
  for (const sc of SCENES) {
    if (only && !sc.name.includes(only)) continue;
    console.log(pass, sc.name);
    await open(sc.q + sc.wide, extra);
    await page.screenshot({ path: `${dir}/${sc.name}-wide.png` });
    if (sc.focus || sc.focusPolygon) {
      // go where the people are (the populace fills in around the camera's point of interest)
      await page.evaluate((sc) => {
        const e = window.__ltt, ds = window.__lttData;
        let ll = sc.focus;
        if (sc.focusPolygon) {
          const ring = ds.site.polygons[sc.focusPolygon];
          ll = [ring.reduce((a, p) => a + p[0], 0) / ring.length, ring.reduce((a, p) => a + p[1], 0) / ring.length];
        }
        const [x, z] = e.terrain.proj.toLocal(ll[0], ll[1]);
        const tr = e.terrain, yp = tr.yearParams(e.getT());
        const gy = tr.floor(tr.heightFrom(tr.staticSample(x, z), yp));
        e.setCamera([x + 50, gy + 45, z + 50], [x, gy, z]);
      }, sc);
      await page.waitForTimeout(7000);
    }
    if (pass === "after" || !cams[sc.name]) {
      // sparse years (few people, all still fading in): accept partly present figures and a shorter clear view
      let c = sc.troops ? await chooseTroops() : (await chooseCivil(0.7, 10)) ?? (await chooseCivil(0.45, 10)) ?? (await chooseCivil(0.35, 10));
      // 25 m: along a street from a walker (streets are clear along their length; doorway lines often are not)
      if (c && !sc.troops) {
        const far = await chooseCivil(0.45, 0);
        if (far) c = [...c.filter((x) => x.D < 10), ...far.filter((x) => x.D >= 10)];
      }
      if (c) cams[sc.name] = c;
      writeFileSync(CAMS, JSON.stringify(cams, null, 1));
    }
    if (cams[sc.name]) await shoot(cams[sc.name], dir, sc.name, !!sc.high);
    else console.log("  no clear standing figure found for", sc.name);
  }
}
await browser.close();
