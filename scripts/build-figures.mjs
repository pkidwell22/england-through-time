#!/usr/bin/env node
/**
 * Regenerate the crowd figures from scratch (MakeHuman/MPFB bodies in Blender, procedural period garments, baked
 * animation) into public/assets/figures/. Needs Blender 4.2+ on PATH with the MPFB extension enabled
 * (bl_ext.blender_org.mpfb). No downloads.
 *
 *   node scripts/build-figures.mjs                 # all bodies, all sets, then pack
 *   node scripts/build-figures.mjs --jobs 4        # parallel Blender workers (default: 6)
 *   node scripts/build-figures.mjs man_a woman_a   # rebuild these bodies' caches, then pack
 *   node scripts/build-figures.mjs --pack          # pack the existing caches only
 *
 * Caches (one pickle per body) go to research/figures-work/cache/ (not shipped).
 */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cache = path.join(root, "research/figures-work/cache");
const out = path.join(root, "public/assets/figures");
const args = process.argv.slice(2);
let jobs = 6;
const ji = args.indexOf("--jobs");
if (ji >= 0) { jobs = Math.max(1, +args[ji + 1] || 1); args.splice(ji, 2); }
const packOnly = args.includes("--pack");
const specSrc = readFileSync(path.join(root, "scripts/figures/spec.py"), "utf8");
const all = [...specSrc.matchAll(/dict\(id="([a-z_]+)"/g)].map((m) => m[1]);
const ids = packOnly ? [] : args.filter((a) => !a.startsWith("--")).length ? args.filter((a) => !a.startsWith("--")) : all;

function run(script, extra) {
  return new Promise((resolve, reject) => {
    const p = spawn("blender", ["-b", "--factory-startup", "--python", path.join(root, "scripts/figures", script), "--", ...extra], { cwd: root });
    let log = "";
    const onData = (d) => {
      log += d;
      for (const line of String(d).split("\n")) if (/^\[|^sets |Traceback|Error/.test(line)) console.log(line);
    };
    p.stdout.on("data", onData);
    p.stderr.on("data", onData);
    p.on("close", (code) => (code === 0 && !/Traceback/.test(log) ? resolve() : reject(new Error(`${script} ${extra[0]} failed\n${log.slice(-3000)}`))));
  });
}

const t0 = Date.now();
const queue = [...ids];
await Promise.all(Array.from({ length: Math.min(jobs, queue.length) }, async () => {
  while (queue.length) await run("build_body.py", [queue.shift(), cache]);
}));
await run("pack.py", [cache, out]);
console.log(`figures built in ${((Date.now() - t0) / 1000).toFixed(0)} s -> ${path.relative(root, out)}`);
