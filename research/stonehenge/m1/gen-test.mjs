// Writes test-site.json and test-landmarks.json (synthetic Stonehenge-like layout).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const site = JSON.parse(fs.readFileSync(path.join(here, "../../../data/locations/stonehenge/site.json"), "utf8"));
site.id = "sto-test";
if (process.env.SLOPE) site.terrain = { base: 40, slope: { bearing: 60, gradient: Number(process.env.SLOPE) } };
const stones = [];
const R = 15.4;
for (let i = 0; i < 30; i++) {
  const s = { id: `u${i}`, type: "sarsen", role: "upright", az: i * 12 + 3, r: R, w: 2.1, t: 1.1, h: 4.1, dressed: true, tenons: true, state: "standing" };
  stones.push(s);
}
const find = (id) => stones.find((s) => s.id === id);
find("u7").state = "leaning"; find("u7").lean = 8; find("u7").leanToward = 100;
find("u18").state = "fallen"; find("u18").fallToward = 200;
find("u21").state = "broken"; find("u21").pieces = 2; find("u21").fallToward = 250;
find("u25").state = "stump";
for (let i = 0; i < 30; i++) {
  const a = `u${i}`, b = `u${(i + 1) % 30}`;
  const missing = [17, 18, 20, 21, 24, 25].includes(i) || [18, 21, 25].includes((i + 1) % 30);
  if (missing) continue;
  stones.push({ id: `l${i}`, type: "sarsen", role: "lintel", az: i * 12 + 9, r: R, w: 3.2, t: 1.0, h: 0.8, on: [a, b], curved: true, dressed: true, state: "standing" });
}
// fallen lintel
stones.push({ id: "lf", type: "sarsen", role: "lintel", x: -18, z: 6, w: 3.2, t: 1.0, h: 0.8, state: "fallen", fallToward: 70, dressed: true });
// trilithons
const hs = [6.0, 6.5, 7.3, 6.5, 6.0];
const offs = [-108, -54, 0, 54, 108];
hs.forEach((H, k) => {
  const th = (230 + offs[k]) * Math.PI / 180;
  const cr = 7.4;
  const cx = cr * Math.sin(th), cz = -cr * Math.cos(th);
  const tx = Math.cos(th), tz = Math.sin(th);
  const az = (230 + offs[k]);
  for (const [j, sgn] of [["a", -1], ["b", 1]]) {
    stones.push({ id: `t${k}${j}`, type: "sarsen", role: "upright", x: cx + sgn * 1.45 * tx, z: cz + sgn * 1.45 * tz, w: 2.1, t: 1.4, h: H - 1.0, face: az + 180 - 180 + 180 - 180 + 180, dressed: true, tenons: true, state: "standing" });
  }
  stones.push({ id: `tl${k}`, type: "sarsen", role: "lintel", x: cx, z: cz, w: 5.4, t: 1.4, h: 1.0, on: [`t${k}a`, `t${k}b`], dressed: true, state: "standing" });
});
// face toward the horseshoe centre: set explicitly (az of stone from anchor + 180 = toward anchor, fine as default)
for (const s of stones) if (s.id.startsWith("t") && s.role === "upright") delete s.face;
find("t0b").state = "fallen"; find("t0b").fallToward = 140; find("t0b").h = 5.0;
stones.find((s) => s.id === "tl0").state = "fallen"; Object.assign(stones.find((s) => s.id === "tl0"), { x: 1.5, z: 3.8, fallToward: 20 });
// altar
stones.push({ id: "alt", type: "altar", role: "slab", x: 0.4, z: -1.2, w: 4.9, t: 1.0, h: 0.5, state: "standing" });
// heel stone
stones.push({ id: "heel", type: "sarsen", role: "outlier", az: 51, r: 77, w: 2.4, t: 2.1, h: 4.7, state: "leaning", lean: 25, leanToward: 231 });
// some bluestone singles
stones.push({ id: "bs-stump", type: "bluestone", role: "upright", az: 100, r: 11.2, w: 0.8, t: 0.5, h: 0.6, state: "stump" });
stones.push({ id: "bs-fall", type: "bluestone", role: "upright", az: 140, r: 11.5, w: 0.9, t: 0.6, h: 2.0, state: "fallen", fallToward: 30 });
stones.push({ id: "bs-lean", type: "bluestone", role: "upright", az: 170, r: 11.5, w: 0.9, t: 0.6, h: 2.1, state: "leaning", lean: 15, leanToward: 250 });
stones.push({ id: "bs-bur", type: "bluestone", role: "upright", az: 190, r: 11.5, w: 0.9, t: 0.6, h: 1.8, state: "buried" });
const rings = [{ type: "bluestone", r: 11.6, count: 60, from: 0, to: 360, w: [0.6, 1.1], t: [0.4, 0.7], h: [1.4, 2.3], jitter: 0.3, skip: [2, 3, 10, 11, 12, 31, 40], state: "standing", seed: 7 }];
const lm = [{
  id: "sto-test", name: "Test stones", lat: site.origin.lat, lon: site.origin.lon, tier: "district", bearing: 49.9,
  evidence: "reconstructed", confidence: "low", summary: "test", uncertainty: "test",
  phases: [{ label: "Stones", from: -3000, built: -3000, to: null, model: { kind: "megaliths", stones, rings } }],
  sources: [],
}, {
  id: "sto-sight", name: "Sightline", lat: site.origin.lat, lon: site.origin.lon, tier: "district", bearing: 49.9,
  evidence: "reconstructed", confidence: "low", summary: "test", uncertainty: "test",
  phases: [{ label: "Sightline", from: -3000, built: -3000, to: null, model: { kind: "sightline", az: 49.9, length: 300, el: 0.5, sun: true } }],
  sources: [],
}];
fs.writeFileSync(path.join(here, "test-site.json"), JSON.stringify(site, null, 1));
fs.writeFileSync(path.join(here, "test-landmarks.json"), JSON.stringify(lm, null, 1));
console.log("stones", stones.length);
