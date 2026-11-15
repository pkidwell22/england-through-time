/**
 * Bake the textures that need a renderer, after scripts/optimize-models.mjs:
 *   - tree leaf-cluster atlases (leaf0_c.webp, leaf1_c.webp), rendered from the real leaf triangles
 *   - crossed-billboard impostors for trees (LOD2) and plants (LOD1): imp<variant>_c.webp + _n.webp
 *     (albedo and view-space normal from front and side, used as a tangent-space normal map on the quads)
 *
 *   node scripts/bake-models.mjs            # every optimised asset that has something to bake
 *   node scripts/bake-models.mjs fern_02
 *
 * Uses headless Chrome (playwright-core, channel "chrome") against the running dev server
 * (LTT_URL, default http://127.0.0.1:4310), page /assets/models/bake.html. Does not start servers.
 */
import fs from "node:fs";
import sharp from "sharp";
import { chromium } from "playwright-core";
import { writeIndex } from "./optimize-models.mjs";

const OUT = "public/assets/models";
const URL0 = process.env.LTT_URL ?? "http://127.0.0.1:4310";
const manifest = JSON.parse(fs.readFileSync("data/models.json", "utf8"));
const only = new Set(process.argv.slice(2).filter((a) => !a.startsWith("--")));

const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
const page = await browser.newPage();
page.on("pageerror", (e) => console.error("PAGE ERROR", e.message));
page.on("console", (m) => { if (m.type() === "error") console.log("console:", m.text().slice(0, 300)); });
await page.goto(`${URL0}/assets/models/bake.html`);
await page.waitForFunction(() => window.bakeReady === true, null, { timeout: 60000 });

const save = async (dataUrl, file, quality) => {
  const buf = Buffer.from(dataUrl.split(",")[1], "base64");
  await sharp(buf).webp({ quality, alphaQuality: 90 }).toFile(file);
};

for (const a of manifest.assets) {
  if (only.size && !only.has(a.id)) continue;
  const mp = `${OUT}/${a.id}/model.json`;
  if (!fs.existsSync(mp)) continue;
  const meta = JSON.parse(fs.readFileSync(mp, "utf8"));
  if (!meta.bake.leaf && !meta.bake.impostors.length) {
    if (!meta.baked) { meta.baked = true; fs.writeFileSync(mp, JSON.stringify(meta)); }
    continue;
  }
  const t0 = Date.now();
  const r = await page.evaluate((id) => window.bake(id), a.id);
  for (const [name, url] of Object.entries(r.leaf)) await save(url, `${OUT}/${a.id}/${name}_c.webp`, 85);
  for (const im of r.imp) {
    await save(im.c, `${OUT}/${a.id}/imp${im.variant}_c.webp`, 85);
    await save(im.n, `${OUT}/${a.id}/imp${im.variant}_n.webp`, 90);
  }
  meta.baked = true;
  fs.writeFileSync(mp, JSON.stringify(meta));
  console.log(`baked ${a.id.padEnd(26)} leaf atlases ${Object.keys(r.leaf).length}  impostors ${r.imp.length}  ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}
await browser.close();
writeIndex();
