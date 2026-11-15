/**
 * Bake hemi-octahedral impostors for the broadleaf tree scans (docs/VEGETATION.md, "Impostors"):
 * N x N orthographic views of LOD0 over the upper hemisphere, colour + (normal, crown occlusion), into
 *   public/assets/models/<id>/octa_c.webp   colour (sRGB) + coverage
 *   public/assets/models/<id>/octa_n.webp   R,G octahedral object-space normal, B crown occlusion, A coverage (half size)
 *   public/assets/models/<id>/octa.json     { N, cell, center, radius, height }
 *
 *   node scripts/bake-octa.mjs                    # the four broadleaf scans
 *   node scripts/bake-octa.mjs island_tree_01
 *
 * Needs the dev server (LTT_URL, default http://127.0.0.1:4310) for public/assets/models/bake-octa.html; does not
 * start one. Uses headless Chrome via playwright-core and sharp, like scripts/bake-models.mjs.
 */
import fs from "node:fs";
import sharp from "sharp";
import { chromium } from "playwright-core";

const OUT = "public/assets/models";
const URL0 = process.env.LTT_URL ?? "http://127.0.0.1:4310";
const IDS = ["island_tree_01", "island_tree_02", "island_tree_03", "tree_small_02"];
const N = 12, CELL = 128;
const only = process.argv.slice(2).filter((a) => !a.startsWith("--"));

const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
const page = await browser.newPage();
page.on("pageerror", (e) => console.error("PAGE ERROR", e.message));
page.on("console", (m) => { if (m.type() === "error") console.log("console:", m.text().slice(0, 300)); });
await page.goto(`${URL0}/assets/models/bake-octa.html`);
await page.waitForFunction(() => window.bakeReady === true, null, { timeout: 60000 });

for (const id of only.length ? only : IDS) {
  if (!fs.existsSync(`${OUT}/${id}/model.json`)) { console.log(`skip ${id}: not optimised`); continue; }
  const t0 = Date.now();
  const r = await page.evaluate(({ id, N, CELL }) => window.bakeOcta(id, N, CELL), { id, N, CELL });
  const buf = (u) => Buffer.from(u.split(",")[1], "base64");
  await sharp(buf(r.c)).webp({ quality: 88, alphaQuality: 95, smartSubsample: true, exact: true }).toFile(`${OUT}/${id}/octa_c.webp`);
  const S = N * CELL;
  await sharp(buf(r.n)).resize(S / 2, S / 2, { kernel: "lanczos3" }).webp({ quality: 92, alphaQuality: 90, exact: true }).toFile(`${OUT}/${id}/octa_n.webp`);
  fs.writeFileSync(`${OUT}/${id}/octa.json`, JSON.stringify(r.info));
  const kb = (f) => Math.round(fs.statSync(`${OUT}/${id}/${f}`).size / 1024);
  console.log(`baked ${id.padEnd(16)} ${N}x${N} frames of ${CELL}px  colour ${kb("octa_c.webp")} KB  normal ${kb("octa_n.webp")} KB  ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}
await browser.close();
