// Same-page A/B timing of the ground shader: the current one, the pre-realism-round one (two scales of five
// scanned layers + bump map), and no ground at all. Other content is identical within a run.
// Usage: node tests/ground-ab.mjs [site] [year] [view] [dpr] [quality]
import { chromium } from "playwright-core";
const [site = "london", year = "1616", view = "overview", dpr = "2", quality = "high"] = process.argv.slice(2);
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1500, height: 900 }, deviceScaleFactor: +dpr });
await page.goto(`http://127.0.0.1:4310/?site=${site}&year=${encodeURIComponent(year)}${view ? `&view=${view}` : ""}&quality=${quality}&ui=0`);
await page.waitForFunction(() => window.__ltt && window.__ltt.stats && window.__ltt.stats().triangles > 0, null, { timeout: 180000 });
await page.waitForTimeout(4000);
const r = await page.evaluate(async () => {
  const e = window.__ltt;
  const mesh = e.terrainMesh.mesh;
  const cur = mesh.material;
  const { tex, tile } = cur.userData.ground;
  const Std = cur.constructor;
  const old = new Std({ vertexColors: false, roughness: 1, metalness: 0, bumpMap: tex.tGrass, bumpScale: 0.5 });
  old.onBeforeCompile = (shader) => {
    for (const [k, v] of Object.entries(tex)) shader.uniforms[k] = { value: v };
    shader.vertexShader = "attribute vec4 aSplat;\nvarying vec4 vSplat;\nvarying vec2 vWxz;\n" + shader.vertexShader.replace("#include <begin_vertex>", "#include <begin_vertex>\nvSplat = aSplat;\nvWxz = position.xz;");
    shader.fragmentShader = "uniform sampler2D tGrass, tDry, tForest, tMud, tDirt;\nvarying vec4 vSplat;\nvarying vec2 vWxz;\n" + shader.fragmentShader.replace("#include <color_fragment>", `{
      vec2 ua = vWxz / ${tile.toFixed(1)}, ub = vWxz / ${(tile * 7.3).toFixed(1)} + 0.37;
      #define LAYER(t) (texture2D(t, ua).rgb * 0.55 + texture2D(t, ub).rgb * 0.45)
      float wf = vSplat.x, wm = vSplat.y, wd = vSplat.z, wy = vSplat.w;
      float wg = max(0.0, 1.0 - wf - wm - wd - wy);
      vec3 dirt = LAYER(tDirt);
      dirt = mix(vec3(dot(dirt, vec3(0.3333))), dirt, 0.45) * vec3(0.92, 0.88, 0.8);
      vec3 ground = LAYER(tGrass) * vec3(0.33, 0.5, 0.23) * wg + LAYER(tForest) * vec3(0.5, 0.62, 0.36) * wf + LAYER(tMud) * wm + dirt * wd + LAYER(tDry) * vec3(0.62, 0.68, 0.4) * wy;
      diffuseColor.rgb = ground / max(0.001, wg + wf + wm + wd + wy);
    }`);
  };
  old.customProgramCacheKey = () => "ground-old-ab";
  const run = async (label, setup) => {
    setup();
    e.benchmark(10);
    const xs = [];
    for (let i = 0; i < 4; i++) { xs.push(e.benchmark(40).msPerFrame); await new Promise((q) => setTimeout(q, 150)); }
    return [label, Math.min(...xs)];
  };
  const set = { new: () => { mesh.visible = true; mesh.material = cur; }, old: () => { mesh.visible = true; mesh.material = old; }, none: () => { mesh.visible = false; } };
  // warm up (shader compile) before timing anything
  for (const k of Object.keys(set)) { set[k](); e.benchmark(15); }
  const res = { new: [], old: [], none: [] };
  for (let rep = 0; rep < 5; rep++) for (const k of Object.keys(set)) res[k].push((await run(k, set[k]))[1]);
  mesh.visible = true; mesh.material = cur;
  const med = (a) => [...a].sort((x, y) => x - y)[a.length >> 1];
  return Object.entries(res).map(([k, v]) => [k, med(v), Math.min(...v)]);
});
console.log(`${site} ${year} ${view} dpr ${dpr} ${quality} (median / best of 5, ms per frame):`, r.map(([l, m, b]) => `${l} ${m.toFixed(2)} / ${b.toFixed(2)}`).join("   "));
await browser.close();
