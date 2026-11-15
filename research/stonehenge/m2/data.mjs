// Test dataset for the earthwork builders (not real site data).
const LAT0 = 51.17888, LON0 = -1.82619;
export const ll = (x, z) => [+(LAT0 - z / 111195).toFixed(7), +(LON0 + x / 69750).toFixed(7)];
const circle = (cx, cz, r, n = 64) => Array.from({ length: n + 1 }, (_, i) => ll(cx + r * Math.sin((2 * Math.PI * i) / n), cz - r * Math.cos((2 * Math.PI * i) / n)));

const lm = (id, x, z, model, extra = {}) => {
  const [lat, lon] = ll(x, z);
  return {
    id, name: id, lat, lon, tier: "district", evidence: "conjectural", confidence: "low", summary: "test", sources: [],
    phases: [{ label: id, from: -3100, built: -3000, to: null, model }], ...extra,
  };
};

export function build(setName, surface) {
  const S = surface;
  const valleys = [
    { name: "ditch", path: circle(0, 0, 55), depth: 1.6, sigma: 2.0 },
    { name: "ditch2", path: circle(-450, 200, 45), depth: 1.4, sigma: 2.0 },
    { name: "barrowditch", path: circle(-190, -150, 16), depth: 0.7, sigma: 1.3 },
  ];
  const site = {
    id: "ewtest", name: "Earthwork test", subtitle: "", scopeNote: "", origin: { lat: LAT0, lon: LON0 },
    bounds: { xMin: -800, xMax: 800, zMin: -800, zMax: 600 }, timeline: { start: -4000, end: 1625, initialYear: -2400 },
    terrain: { base: 40, valleys },
    district: { name: "d", bounds: { xMin: -500, xMax: 600, zMin: -700, zMax: 350 }, note: "" },
    views: [{ id: "a", name: "a", position: [0, 200, 200], target: [0, 40, 0], scope: "district" }],
  };
  const rampart = [[-460, -250], [-400, -340], [-320, -360], [-250, -290], [-240, -200], [-300, -140], [-390, -150], [-450, -190]];
  const cursus = [[-250, -430], [-250, -650]];
  const landmarks = [
    lm("henge", 0, 0, { kind: "henge", r: 55, ditchW: 5, bank: "inner", bankW: 6, bankH: 1.8, counterscarp: { w: 2.5, h: 0.5 }, gaps: [[40, 60], [200, 215]], surface: S }),
    lm("aubrey", 0, 0, { kind: "pit-ring", r: 43.3, count: 56, pitR: 0.5, filled: false, surface: S }),
    lm("henge2", -450, 200, { kind: "henge", r: 45, ditchW: 5, bank: "outer", bankW: 6, bankH: 1.5, segments: 14, surface: S }),
    lm("filledpits", 120, 0, { kind: "pit-ring", r: 15, count: 20, pitR: 0.7, filled: true, surface: S }),
    lm("avenue", 0, 0, { kind: "banked-avenue", path: [[46, -39], [200, -150], [300, -230], [420, -230], [520, -130]].map(([x, z]) => ll(x, z)), width: 21, surface: S }),
    lm("timber", 200, 120, { kind: "timber-circle", bearing: 40, rings: [{ r: 12, count: 24, d: 0.5, h: 4 }, { r: 18, count: 36, d: 0.6, h: 4.5 }, { rx: 25, rz: 19, count: 48, d: 0.7, h: 5 }] }),
    lm("palisade", 200, 120, { kind: "palisade", closed: true, path: circle(200, 120, 40, 40), h: 3 }),
    lm("barrows", -200, -150, { kind: "barrow-group", surface: S, barrows: [
      { x: 0, z: 0, form: "bowl", d: 20, h: 1.8 }, { x: 50, z: 10, form: "bell", d: 25, h: 2.2 }, { x: -50, z: 0, form: "disc", d: 30 },
      { x: 5, z: 55, form: "saucer", d: 20 }, { x: 55, z: 60, form: "pond", d: 14 },
    ] }),
    lm("long", -200, 100, { kind: "long-barrow", bearing: 80, l: 50, w: 20, w2: 12, h: 2.5, surface: S }),
    lm("fort", -350, -250, { kind: "rampart", path: rampart.map(([x, z]) => ll(x, z)), gaps: [3], surface: S }),
    lm("turf", 0, -170, { kind: "turf", path: [[-40, -200], [40, -200], [40, -140], [-40, -140]].map(([x, z]) => ll(x, z)), tufts: 0.8 }),
    lm("cursus", 0, 0, { kind: "banked-avenue", closed: true, path: cursus.map(([x, z]) => ll(x, z)), width: 60, bankW: 5, bankH: 1.0, ditchW: 3, surface: S }),
  ];
  const zones = [
    { id: "z1", label: "houses", style: "neolithic-house", shape: { type: "ellipse", lat: ll(330, -20)[0], lon: ll(330, -20)[1], rx: 60, rz: 40 }, spacing: 14, fill: 0.7, tier: "district", grow: [-3000, -3000], decline: null, evidence: "conjectural", confidence: "low", note: "t", sources: [] },
    { id: "z2", label: "large", style: "neolithic-house-large", shape: { type: "ellipse", lat: ll(430, 60)[0], lon: ll(430, 60)[1], rx: 40, rz: 25 }, spacing: 34, fill: 0.9, tier: "district", grow: [-3000, -3000], decline: null, evidence: "conjectural", confidence: "low", note: "t", sources: [] },
  ];
  if (setName === "edge") {
    landmarks.length = 0;
    landmarks.push(
      lm("e-henge-min", 0, 0, { kind: "henge" }),
      lm("e-oval", 300, 0, { kind: "henge", rx: 90, rz: 50, bearing: 30, bank: "outer", counterscarp: true, gaps: [[350, 10], [170, 190]], surface: "weathering" }),
      lm("e-none", -300, 0, { kind: "henge", r: 40, bank: "none", surface: "chalk", segments: 6 }),
      lm("e-pits-arc", 0, 200, { kind: "pit-ring", r: 20, count: 9, from: 90, to: 270, skip: [2], depth: 2 }),
      lm("e-fort-min", 0, -300, { kind: "rampart", polygon: "none", path: circle(0, -300, 70, 12).slice(0, -1).map((p) => p), surface: "chalk" }),
      lm("e-pal-open", 300, 200, { kind: "palisade", path: [[300, 200], [350, 230], [420, 220]].map(([x, z]) => ll(x, z)), h: 2.5 }),
      lm("e-barrow-ll", 0, 300, { kind: "barrow-group", barrows: [{ lat: ll(0, 300)[0], lon: ll(0, 300)[1] }, { x: 40, z: 0, form: "bell" }] }),
      lm("e-long-default", -300, 300, { kind: "long-barrow" }),
      lm("e-turf-default", 200, -300, { kind: "turf", path: circle(200, -300, 30, 10).slice(0, -1) }),
      lm("e-timber-empty", 100, 100, { kind: "timber-circle" }),
      lm("e-avenue-sharp", 0, -600, { kind: "banked-avenue", path: [[0, -600], [100, -600], [100, -500], [20, -500]].map(([x, z]) => ll(x, z)), smooth: 0 }),
    );
  }
  const files = { site, landmarks, zones, eras: [], events: [], episodes: [], sources: {} };
  const g = 43.4;
  const views = [
    { name: "henge-in", pos: [-6, g, 12], target: [0, 41.2, -52] },
    { name: "henge-bank-close", pos: [10, 42.6, -30], target: [8, 41.4, -50] },
    { name: "henge-100", pos: [0, 80, 120], target: [0, 40, 0] },
    { name: "henge-high", pos: [0, 330, 160], target: [0, 40, 0] },
    { name: "henge-entrance", pos: [20, 44, -8], target: [42, 41, -50] },
    { name: "henge2-seg", pos: [-450, 62, 275], target: [-450, 40, 200] },
    { name: "aubrey", pos: [4, 42.2, -33], target: [0, 40.8, -43] },
    { name: "avenue-close", pos: [168, 44, -108], target: [200, 41, -150] },
    { name: "avenue-high", pos: [260, 220, -60], target: [260, 40, -170] },
    { name: "timber", pos: [200, 46, 160], target: [200, 42, 120] },
    { name: "timber-high", pos: [200, 90, 190], target: [200, 40, 120] },
    { name: "barrows", pos: [-200, 55, -80], target: [-200, 40, -150] },
    { name: "barrows-close", pos: [-170, 43.2, -105], target: [-150, 41.5, -140] },
    { name: "long", pos: [-260, 48, 150], target: [-200, 41, 100] },
    { name: "fort", pos: [-350, 120, -80], target: [-350, 40, -250] },
    { name: "turf", pos: [0, 41.8, -120], target: [0, 40, -170] },
    { name: "turf-high", pos: [0, 70, -110], target: [0, 40, -170] },
    { name: "cursus", pos: [-100, 60, -380], target: [-250, 40, -500] },
    { name: "edge-oval", pos: [300, 150, 190], target: [300, 40, 0] },
    { name: "edge-none", pos: [-300, 90, 110], target: [-300, 40, 0] },
    { name: "edge-avenue", pos: [50, 110, -420], target: [50, 40, -560] },
    { name: "edge-all", pos: [0, 330, 250], target: [0, 40, -80] },
    { name: "houses", pos: [300, 45.5, 20], target: [330, 41, -20] },
    { name: "houses-high", pos: [330, 80, 40], target: [330, 40, -20] },
    { name: "large", pos: [400, 46, 110], target: [430, 41, 60] },
  ];
  return { files, views, stats: true };
}
