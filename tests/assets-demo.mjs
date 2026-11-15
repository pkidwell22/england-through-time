/**
 * Offline check + contact sheets for the scanned model library.
 *
 *   node tests/assets-demo.mjs            # report + contact sheets
 *   node tests/assets-demo.mjs --report   # report only (no browser)
 *
 * 1. Loads every optimised LOD from public/assets/models/<id>/ (model.json + geo.bin) in Node, decodes the
 *    geometry, and reports triangles, vertex bounds, index validity and budget compliance per LOD.
 * 2. Renders public/assets/models/preview.html (static page, vendored three.js) through the running dev
 *    server in headless Chrome and saves contact sheets to docs/screenshots/assets/.
 * Exit code 1 if any LOD breaks its budget or has invalid geometry.
 */
import fs from "node:fs";
import path from "node:path";

const OUT = "public/assets/models";
const SHOTS = "docs/screenshots/assets";
const manifest = JSON.parse(fs.readFileSync("data/models.json", "utf8"));
let bad = 0;
const rows = [];
for (const a of manifest.assets) {
  const mp = path.join(OUT, a.id, "model.json");
  if (!fs.existsSync(mp)) { console.log(`MISSING ${a.id}`); bad++; continue; }
  const m = JSON.parse(fs.readFileSync(mp, "utf8"));
  const bin = fs.readFileSync(path.join(OUT, a.id, m.bin));
  const ab = bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.length);
  const budget = { ...manifest.budgets[a.category], ...(a.budget || {}) };
  const limits = [budget.lod0, budget.lod1, budget.lod2];
  for (const [vi, v] of m.variants.entries()) {
    const tri = [];
    for (const [li, l] of v.lods.entries()) {
      let t = 0;
      const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
      for (const p of l.parts) {
        const pos = new Float32Array(ab, p.position, p.vertices * 3);
        const idx = p.indexType === "u32" ? new Uint32Array(ab, p.index, p.triangles * 3) : new Uint16Array(ab, p.index, p.triangles * 3);
        for (let k = 0; k < pos.length; k++) if (!Number.isFinite(pos[k])) { console.log(`NaN position ${a.id} v${vi} lod${li}`); bad++; break; }
        for (const i of idx) if (i >= p.vertices) { console.log(`index out of range ${a.id} v${vi} lod${li}`); bad++; break; }
        for (let k = 0; k < pos.length; k += 3) for (let c = 0; c < 3; c++) { mn[c] = Math.min(mn[c], pos[k + c]); mx[c] = Math.max(mx[c], pos[k + c]); }
        for (const tex of [p.material.map, p.material.normalMap, p.material.armMap]) {
          if (tex && !fs.existsSync(path.join(OUT, a.id, tex))) { console.log(`missing texture ${a.id}/${tex}`); bad++; }
        }
        t += idx.length / 3;
      }
      if (t !== l.triangles) { console.log(`triangle count mismatch ${a.id} lod${li}: ${t} vs ${l.triangles}`); bad++; }
      if (limits[li] !== undefined && t > limits[li]) { console.log(`OVER BUDGET ${a.id} v${vi} lod${li}: ${t} > ${limits[li]}`); bad++; }
      if (t === 0) { console.log(`EMPTY ${a.id} v${vi} lod${li}`); bad++; }
      tri.push(t);
      if (li === 0) v._b = { mn, mx };
    }
    const s = v._b;
    rows.push({ id: vi ? `${a.id} v${vi}` : a.id, cat: a.category, tri: tri.join("/"), size: `${(s.mx[0] - s.mn[0]).toFixed(2)} x ${(s.mx[1] - s.mn[1]).toFixed(2)} x ${(s.mx[2] - s.mn[2]).toFixed(2)} m` });
  }
}
for (const r of rows) console.log(`${r.id.padEnd(30)} ${r.cat.padEnd(12)} ${r.tri.padEnd(18)} ${r.size}`);
console.log(`\n${manifest.assets.length} assets, ${rows.length} variants, ${bad} problems`);

if (!process.argv.includes("--report")) {
  const { chromium } = await import("playwright-core");
  fs.mkdirSync(SHOTS, { recursive: true });
  const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  page.on("pageerror", (e) => console.error("PAGE ERROR", e.message));
  const base = process.env.LTT_URL ?? "http://127.0.0.1:4310";
  const sheets = [
    ["trees", "cat=tree&cell=300"],
    ["plants", "cat=shrub,groundcover,grass&cell=220"],
    ["plant-variants", "cat=shrub,groundcover,grass&variants=all&cell=160"],
    ["deadwood-rocks", "cat=deadwood,rock&cell=220"],
    ["props", "cat=prop&cell=200"],
    ["vessels", "cat=vessel&cell=360"],
  ];
  for (const [name, query] of sheets) {
    await page.goto(`${base}/assets/models/preview.html?${query}`);
    await page.waitForFunction(() => window.previewDone === true, null, { timeout: 180000 });
    await page.waitForTimeout(300);
    const el = await page.$("body");
    await el.screenshot({ path: `${SHOTS}/${name}.png` });
    console.log(`saved ${SHOTS}/${name}.png`);
  }
  await browser.close();
}
process.exit(bad ? 1 : 0);
