#!/usr/bin/env node
// Copies StoneSpecs from data/locations/stonehenge/stones.json (the single source of truth) into every landmark phase whose
// model is { kind: "megaliths", catalogue: { sets: [...], state: "built" | "1625" } }, as model.stones.
//
//   node scripts/stonehenge/sync-stones.mjs            write landmarks.json
//   node scripts/stonehenge/sync-stones.mjs --check    exit 1 if landmarks.json is out of sync (writes nothing)
//   --stones <file> --landmarks <file>                 override the default paths (tests)
//
// Rules: state "built": every stone whose `built` is not "absent", with state = built (no lean/fall fields: it was standing).
//        state "1625":  every stone whose `state1625` is not "missing", with state = state1625 and its lean/fall fields.
// Only StoneSpec fields are copied. Nothing is derived or invented: a lintel's `on` list is copied as is and a lintel is only
// fallen/broken if stones.json says so. Key order and the 1-space JSON indentation of landmarks.json are preserved.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const check = args.includes("--check");
const stonesFile = path.resolve(flag("--stones") ?? path.join(root, "data/locations/stonehenge/stones.json"));
const landmarksFile = path.resolve(flag("--landmarks") ?? path.join(root, "data/locations/stonehenge/landmarks.json"));

const FIELDS = ["id", "type", "role", "az", "r", "x", "z", "w", "t", "h", "face", "state", "lean", "leanToward", "fallToward", "pieces", "on", "curved", "dressed", "tenons"];
const FALL_FIELDS = new Set(["lean", "leanToward", "fallToward", "pieces"]);

function fail(msg, code = 2) {
  console.error(`sync-stones: ${msg}`);
  process.exit(code);
}
function readJson(file) {
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (e) {
    fail(`cannot read ${file}: ${e.code ?? e.message}`);
  }
  try {
    return { text, data: JSON.parse(text) };
  } catch (e) {
    fail(`${file} is not valid JSON: ${e.message}`);
  }
}

const { data: stonesRaw } = readJson(stonesFile);
const catalogue = Array.isArray(stonesRaw) ? stonesRaw : Array.isArray(stonesRaw?.stones) ? stonesRaw.stones : null;
if (!catalogue) fail(`${stonesFile} must be an array of stones (or an object with a "stones" array)`);
const { text: lmText, data: landmarks } = readJson(landmarksFile);
if (!Array.isArray(landmarks)) fail(`${landmarksFile} must be an array of landmarks`);

const warnings = [];
function specsFor(sets, state, where) {
  const want = new Set(sets);
  const known = new Set(catalogue.map((s) => s.set));
  for (const s of sets) if (!known.has(s)) warnings.push(`${where}: no stone belongs to set "${s}"`);
  const out = [];
  for (const s of catalogue) {
    if (!want.has(s.set)) continue;
    let st;
    if (state === "built") {
      st = s.built ?? "standing";
      if (st === "absent") continue;
    } else {
      st = s.state1625;
      if (st === undefined) {
        warnings.push(`${where}: stone ${s.id} has no state1625, left out`);
        continue;
      }
      if (st === "missing") continue;
    }
    const spec = {};
    for (const f of FIELDS) {
      const v = f === "state" ? st : s[f];
      if (v === undefined || v === null) continue;
      if (state === "built" && FALL_FIELDS.has(f)) continue;
      spec[f] = v;
    }
    out.push(spec);
  }
  return out;
}

const changed = [];
let synced = 0;
for (const lm of landmarks) {
  for (const [i, phase] of (lm.phases ?? []).entries()) {
    const model = phase.model;
    const cat = model?.catalogue;
    if (!cat) continue;
    const where = `${lm.id} phase ${i}`;
    if (!Array.isArray(cat.sets) || !["built", "1625"].includes(cat.state)) {
      fail(`${where}: catalogue needs { sets: [...], state: "built" | "1625" }`);
    }
    const stones = specsFor(cat.sets, cat.state, where);
    synced++;
    if (JSON.stringify(model.stones) !== JSON.stringify(stones)) changed.push(`${where} (${stones.length} stones)`);
    if ("stones" in model) model.stones = stones;
    else {
      // insert straight after `catalogue`, keeping the other keys in order
      const entries = Object.entries(model);
      for (const k of Object.keys(model)) delete model[k];
      for (const [k, v] of entries) {
        model[k] = v;
        if (k === "catalogue") model.stones = stones;
      }
    }
  }
}
for (const w of warnings) console.warn(`sync-stones: warning: ${w}`);

const next = JSON.stringify(landmarks, null, 1) + (lmText.endsWith("\n") ? "\n" : "");
const dirty = next !== lmText;
if (check) {
  if (dirty || changed.length) {
    console.error(`sync-stones: ${landmarksFile} is out of sync with ${stonesFile}${changed.length ? ":\n  " + changed.join("\n  ") : ""}\nRun: node scripts/stonehenge/sync-stones.mjs`);
    process.exit(1);
  }
  console.log(`sync-stones: in sync (${synced} catalogue phase${synced === 1 ? "" : "s"})`);
  process.exit(0);
}
if (!dirty) {
  console.log(`sync-stones: already in sync (${synced} catalogue phase${synced === 1 ? "" : "s"})`);
  process.exit(0);
}
const tmp = `${landmarksFile}.${process.pid}.tmp`;
fs.writeFileSync(tmp, next);
fs.renameSync(tmp, landmarksFile);
console.log(`sync-stones: updated ${changed.length} phase${changed.length === 1 ? "" : "s"}${changed.length ? ":\n  " + changed.join("\n  ") : " (formatting only)"}`);
