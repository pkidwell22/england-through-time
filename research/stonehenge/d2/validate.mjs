#!/usr/bin/env node
// Standalone checker for data/locations/stonehenge/{landmarks,zones}.json: validateDataset's landmark/zone rules, source ids against
// the research sources-*.json, tier vs the district rectangle, and anachronism spot checks. node research/stonehenge/d2/validate.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const J = (f) => JSON.parse(fs.readFileSync(path.join(root, f), "utf8"));
const landmarks = J("data/locations/stonehenge/landmarks.json");
const zones = J("data/locations/stonehenge/zones.json");
const site = J("data/locations/stonehenge/site.json");
const polys = site.polygons || {};
const sources = new Set();
for (const f of fs.readdirSync(path.join(root, "research/stonehenge")).filter((f) => /^sources-.*\.json$/.test(f))) for (const k of Object.keys(J("research/stonehenge/" + f))) sources.add(k);
const siteSources = new Set(Object.keys(J("data/locations/stonehenge/sources.json")));

const out = [];
const T = (y) => (y < 0 ? y + 1 : y);
const valid = (y, w) => { if (!Number.isInteger(y) || y === 0) { out.push(`${w}: ${y} not a valid year`); return false; } return true; };
const start = site.timeline.start, end = site.timeline.end;
const STAGED = new Set(["troops", "zone-marker", "tents", "camp"]);
const PATH_KINDS = new Set(["wall", "bridge", "road", "stream", "quay", "waterfront", "boats", "hedge", "ford", "stone-bridge"]);
const RING_KINDS = new Set(["zone-marker", "field-strips"]);

const ids = new Set();
for (const lm of landmarks) {
  if (ids.has(lm.id)) out.push(`${lm.id}: duplicate id`);
  ids.add(lm.id);
  for (const k of ["name", "summary", "uncertainty"]) if (!lm[k] || typeof lm[k] !== "string") out.push(`${lm.id}: missing ${k}`);
  for (const k of ["evidence", "confidence", "tier"]) if (!lm[k]) out.push(`${lm.id}: missing ${k}`);
  if (!["attested-standing", "attested-excavated", "attested-documentary", "attested-pictorial", "reconstructed", "conjectural"].includes(lm.evidence)) out.push(`${lm.id}: bad evidence`);
  if (!["high", "medium", "low"].includes(lm.confidence)) out.push(`${lm.id}: bad confidence`);
  if (typeof lm.lat !== "number" || typeof lm.lon !== "number") out.push(`${lm.id}: lat/lon`);
  if (!lm.sources?.length) out.push(`${lm.id}: no sources`);
  // tier vs district rectangle (anchor)
  const MLON = 111320 * Math.cos((site.origin.lat * Math.PI) / 180);
  const x = (lm.lon - site.origin.lon) * MLON, z = -(lm.lat - site.origin.lat) * 111250;
  const D = site.district.bounds;
  const inD = x >= D.xMin && x <= D.xMax && z >= D.zMin && z <= D.zMax;
  if ((lm.tier === "district") !== inD) out.push(`${lm.id}: tier ${lm.tier} but anchor at x ${x.toFixed(0)} z ${z.toFixed(0)}`);
  if (!lm.phases.length) out.push(`${lm.id}: no phases`);
  for (const p of lm.phases) {
    const k = p.model?.kind;
    const own = Array.isArray(p.model?.path) ? p.model.path.length : 0;
    const pts = Math.max(own, lm.path?.length ?? 0);
    if (PATH_KINDS.has(k) && pts < 2) out.push(`${lm.id}: kind ${k} needs a path`);
    if (RING_KINDS.has(k) && pts < 3) out.push(`${lm.id}: ring kind ${k}`);
    if (k === "troops" && lm.evidence !== "conjectural") out.push(`${lm.id}: troops`);
    if (!p.dateNote && !lm.phases.every((q) => q.dateNote)) { /* phases may omit dateNote */ }
  }
  let prevEnd = -Infinity;
  lm.phases.forEach((p, i) => {
    const w = `${lm.id} phase ${i}`;
    if (!valid(p.from, `${w}.from`)) return;
    if (p.built != null && valid(p.built, `${w}.built`) && T(p.built) < T(p.from)) out.push(`${w}: built before from`);
    if (p.to != null && valid(p.to, `${w}.to`) && T(p.to) < T(p.built ?? p.from)) out.push(`${w}: ends before it is built`);
    if (p.goneBy != null && valid(p.goneBy, `${w}.goneBy`) && p.to != null && T(p.goneBy) < T(p.to)) out.push(`${w}: goneBy before to`);
    if (T(p.from) < prevEnd) out.push(`${w}: starts before previous ends`);
    if (p.continues && i === 0 && T(p.from) > T(start)) out.push(`${w}: continues on a late first phase`);
    if (p.continues && i > 0 && lm.phases[i - 1].to !== p.from) out.push(`${w}: continues but not at previous to`);
    if (p.to == null && i < lm.phases.length - 1) out.push(`${w}: open-ended phase not last`);
    prevEnd = p.to != null ? T(p.to) : Infinity;
    if (p.from > 1625) out.push(`${w}: from ${p.from} after 1625`);
    if (p.to != null && p.to > 1626) out.push(`${w}: to ${p.to} after 1625`);
    if (!p.dateNote) out.push(`${w}: no dateNote`);
    if (p.model?.catalogue && !Array.isArray(p.model.stones)) out.push(`${w}: catalogue not synced`);
  });
  for (const s of lm.sources) {
    if (!sources.has(s)) out.push(`${lm.id}: source ${s} not in research sources-*.json`);
    if (!siteSources.has(s)) out.push(`${lm.id}: source ${s} not (yet) in stonehenge/sources.json`);
  }
}
for (const z of zones) {
  const w = `zone ${z.id}`;
  valid(z.grow[0], w); valid(z.grow[1], w);
  if (z.decline) { valid(z.decline[0], w); valid(z.decline[1], w); if (T(z.decline[0]) < T(z.grow[0])) out.push(`${w}: declines before it grows`); }
  if (z.shape.type === "ref" && !polys[z.shape.polygon]) out.push(`${w}: unknown polygon ${z.shape.polygon}`);
  for (const s of z.sources) {
    if (!sources.has(s)) out.push(`${w}: source ${s} not in research`);
    if (!siteSources.has(s)) out.push(`${w}: source ${s} not in stonehenge/sources.json`);
  }
  if (z.grow[1] > 1625 || (z.decline && z.decline[1] > 1625)) out.push(`${w}: after 1625`);
}

// ---- anachronism spot checks (phaseStatus semantics from src/lib/lifecycle.ts, simplified)
function present(lm, year) {
  const t = T(year) + 0.5; // mid-year
  for (const p of lm.phases) {
    const t0 = T(p.from);
    if (t < t0) continue;
    if (STAGED.has(p.model.kind)) { if (p.to == null || t < T(p.to)) return true; continue; }
    if (p.to == null) return true;
    const tEnd = T(p.to);
    if (t < tEnd) return true;
    const e = p.end ?? "replaced";
    if (e === "handover") continue;
    if (e === "replaced" || e === "demolished") { if (t - tEnd < 1) return true; continue; }
    const g = p.goneBy != null ? T(p.goneBy) : Infinity;
    if (t < g) return true;
  }
  return false;
}
const L = Object.fromEntries(landmarks.map((l) => [l.id, l]));
const expect = (id, year, want, why) => { if (!L[id]) { out.push(`spot: no landmark ${id}`); return; } const got = present(L[id], year); if (got !== want) out.push(`SPOT ${id} at ${year}: expected ${want ? "present" : "absent"} (${why})`); };
const sarsenIds = ["trilithons", "sarsen-circle"];
for (const id of sarsenIds) { expect(id, -2650, false, "no sarsens before 2600 BCE"); expect(id, -3000, false, "no sarsens"); expect(id, -2400, true, "sarsens up"); expect(id, 1625, true, "ruin present"); expect(id, 1, true, "handover continuity"); expect(id, -2000, true, ""); }
expect("stonehenge-ditch-bank", -3001, false, "ditch not dug before 3000"); expect("stonehenge-ditch-bank", -2900, true, "ditch present by 2900"); expect("stonehenge-ditch-bank", 1625, true, "");
expect("aubrey-holes", -2999, true, "pits"); expect("aubrey-holes", 1625, true, "");
expect("avenue", -2500, false, "Avenue absent before its date"); expect("avenue", -2000, true, "Avenue present"); expect("avenue", 1625, true, "");
for (const id of ["normanton-down-barrows", "king-barrows", "cursus-barrows", "bush-barrow"]) { expect(id, -3000, false, "barrows absent at 3000 BCE"); expect(id, -1800, true, "barrows present at 1800 BCE"); expect(id, 1625, true, ""); }
expect("amesbury-abbey", 978, false, "abbey absent before 979"); expect("amesbury-abbey", 1000, true, ""); expect("amesbury-abbey", 1600, false, "demolished by 1580");
expect("greater-cursus", -3600, false, "cursus after 3550"); expect("greater-cursus", -3400, true, "");
expect("durrington-walls-henge", -2500, false, "henge after 2480"); expect("durrington-walls-henge", -2300, true, "");
expect("woodhenge", -2300, true, ""); expect("woodhenge", -2000, false, "posts rotted by 2150");
expect("vespasians-camp", -1000, false, "Iron Age"); expect("vespasians-camp", 1000, true, "");
expect("solstice-sunrise-marker", -2500, true, ""); expect("solstice-sunrise-marker", -2499, false, ""); expect("solstice-sunrise-marker", -2502, false, "");
expect("aubrey-bluestones", -3500, false, ""); expect("aubrey-bluestones", -2900, true, ""); expect("aubrey-bluestones", -2500, false, "");
expect("bluestone-circle", -2000, true, ""); expect("bluestone-horseshoe", -2100, false, ""); expect("bluestone-horseshoe", -1800, true, "");
expect("river-avon", -4000, true, ""); expect("river-avon", 1625, true, "");
const zid = Object.fromEntries(zones.map((z) => [z.id, z]));
if (!(zid["durrington-houses"].grow[0] >= -2525)) out.push("zone houses grow");

console.log(`landmarks ${landmarks.length}, zones ${zones.length}, research sources ${sources.size}, site sources ${siteSources.size}`);
const bad = out.filter((o) => !/not \(yet\) in stonehenge\/sources\.json|not in stonehenge\/sources\.json/.test(o));
const soft = out.filter((o) => /sources\.json/.test(o) && /stonehenge\/sources/.test(o));
console.log(bad.length ? `PROBLEMS (${bad.length}):\n  ` + bad.join("\n  ") : "no hard problems");
if (soft.length) console.log(`site sources.json lacks ${soft.length} ids:\n  ` + soft.slice(0, 20).join("\n  "));
process.exit(bad.length ? 1 : 0);
