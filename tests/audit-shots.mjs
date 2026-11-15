// Screenshots for the placement audit (docs/AUDIT.md): before/after pairs of the worst offenders, and a systematic
// walk along both London banks, round the wall, the Tower, St Paul's, the bridgeheads and the suburbs' edges.
//   node tests/audit-shots.mjs pairs            # docs/screenshots/audit/<case>-before.png / -after.png
//   node tests/audit-shots.mjs walk [years...]  # docs/screenshots/audit/walk/<year>-<view>.png
// "before" is the same build with ?placement=legacy (the old placement rules, see src/scene/placementMode.ts).
import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, "..", "docs", "screenshots", "audit");
const BASE = process.env.LTT_URL ?? "http://127.0.0.1:4310";
const mode = process.argv[2] ?? "pairs";

/** case: year, target [x, z], camera offset [dx, dy, dz] from the target (y is above the ground there) */
const PAIRS = [
  { id: "waterfront-1449", year: 1449, at: [-560, -150], off: [-70, 45, 110], note: "revetment of 1253 stranded 30 m inland as the bank advanced" },
  { id: "roman-quay-barges-249", year: 249, at: [-60, -95], off: [-60, 35, 110], note: "Roman quay of 105 and barges moored on what is by 249 dry land" },
  { id: "eastcheap-1300", year: 1300, at: [270, -240], off: [60, 40, 90], note: "overview houses standing in Eastcheap beyond the district" },
  { id: "tower-ward-1300", year: 1300, at: [700, 40], off: [-140, 110, 160], note: "houses inside the Tower's outer ward" },
  { id: "thames-street-1600", year: 1600, at: [-250, -185], off: [40, 30, 80], note: "houses near the river sunk metres into ground raised by reclamation" },
  { id: "walbrook-1239", year: 1239, at: [-300, -300], off: [50, 40, 90], note: "Walbrook stream buried under the silted valley" },
  { id: "city-1533", year: 1533, at: [200, -650], off: [70, 50, 100], note: "medieval and Tudor houses on the same plots at once" },
  { id: "bridge-foot-1150", year: 1150, at: [-40, 300], off: [-80, 45, 110], note: "Southwark houses on the Saxon bridge approach" },
  { id: "roman-roads-60", year: 60, at: [400, -900], off: [80, 45, 110], note: "trees standing in Ermine Street" },
  { id: "londinium-smoke-56", year: 56, at: [-40, -250], off: [60, 35, 90], note: "smoke and door figures where no house stands" },
];

/**
 * The structural fixes of the second pass (abbey anchor, timber bridge line, dock inlets, bridge ramps, dated lanes):
 * no legacy switch reproduces them, so "before" is shot from the build before the change and "after" from the build
 * after it (`node tests/audit-shots.mjs fixes before|after [ids...]`). `ll` targets are [lat, lon].
 */
const FIXES = [
  { id: "abbey-1520", year: 1520, ll: [51.4994, -0.1265], off: [-40, 90, 150], note: "Westminster Abbey (nave complete) and Henry VII's Chapel" },
  { id: "abbey-1450", year: 1450, ll: [51.4994, -0.1268], off: [-40, 90, 150], note: "the new nave rising westwards from Henry III's church" },
  { id: "st-pauls-1300", year: 1300, ll: [51.5138, -0.0984], off: [-60, 110, 170], note: "Old St Paul's New Work rising at the east end" },
  { id: "timber-bridge-1190", year: 1190, at: [-70, 215], off: [-90, 40, 70], note: "timber bridge and stone bridge under construction at the Southwark end" },
  { id: "timber-bridge-1190-north", year: 1190, at: [-10, 30], off: [70, 45, -40], note: "both bridges at the City end, 1190" },
  { id: "queenhithe-1300", year: 1300, ll: [51.5103, -0.0949], off: [60, 60, 90], note: "Queenhithe, 1300" },
  { id: "queenhithe-1550", year: 1550, ll: [51.5103, -0.0949], off: [60, 60, 90], note: "Queenhithe, 1550" },
  { id: "billingsgate-1350", year: 1350, ll: [51.5087, -0.0843], off: [-60, 55, 90], note: "Billingsgate, 1350" },
  { id: "billingsgate-1550", year: 1550, ll: [51.5087, -0.0843], off: [-60, 55, 90], note: "Billingsgate, 1550" },
  { id: "bridge-ramp-north-1600", year: 1600, at: [2, -15], off: [48, 14, 42], note: "bridge deck and Fish Street Hill, 1600" },
  { id: "bridge-ramp-south-1600", year: 1600, at: [-90, 268], off: [45, 14, -48], note: "bridge deck and Borough High Street, 1600" },
  { id: "bridge-ramp-north-1250", year: 1250, at: [6, -32], off: [50, 16, 55], note: "bridge approach and Fish Street Hill, 1250" },
  { id: "bridge-ramp-north-1250-west", year: 1250, at: [12, -52], off: [-60, 28, 20], note: "(after only) the approach and ramp from the west, 1250" },
  { id: "bridge-ramp-south-1400-west", year: 1400, at: [-100, 290], off: [-60, 26, -10], note: "(after only) the Southwark ramp from the west, 1400" },
  { id: "lanes-1200", year: 1200, at: [-120, -60], off: [-40, 70, 90], note: "lanes running to the river, 1200" },
];

/** walk viewpoints: [id, target x, z, camera offset] */
const VIEWS = [
  ["north-bank-west", -900, -260, [-60, 60, 160]],
  ["north-bank-east", 200, -40, [60, 60, 160]],
  ["south-bank", -300, 200, [-60, 60, -160]],
  ["bridge-north", 0, -20, [-90, 45, 70]],
  ["bridge-south", -60, 330, [90, 45, -70]],
  ["tower", 720, 40, [-150, 120, 180]],
  ["st-pauls", -800, -560, [120, 110, 160]],
  ["wall-north", -500, -1000, [80, 80, 160]],
  ["suburb-west", -1700, -350, [100, 90, 180]],
];

const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
const open = async (extra) => {
  const page = await browser.newPage({ viewport: { width: 1400, height: 800 } });
  page.on("pageerror", (e) => console.error("PAGE ERROR", e.message));
  await page.goto(`${BASE}/?site=london&quality=high&ui=0&labels=0&year=1000${extra}`, { timeout: 120000 });
  await page.waitForFunction(() => window.__ltt && window.__ltt.getState().ready, null, { timeout: 180000 });
  await page.waitForTimeout(2500);
  return page;
};
const shoot = async (page, file, year, at, off, labels = false, ll = null) => {
  await page.evaluate(({ year, at, off, labels, ll }) => {
    const E = window.__ltt;
    E.pause();
    E.setLabels(labels);
    if (ll) at = E.terrain.proj.toLocal(ll[0], ll[1]);
    E.setT(year < 0 ? year + 1 + 0.5 : year + 0.5);
    const g = Math.max(0, E.terrain.height(at[0], at[1], E.getT()));
    E.setCamera([at[0] + off[0], g + off[1], at[1] + off[2]], [at[0], g + 2, at[1]]);
  }, { year, at, off, labels, ll });
  await page.waitForTimeout(3500);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await page.screenshot({ path: file });
};

if (mode === "pairs") {
  const only = process.argv.slice(3);
  const cases = only.length ? PAIRS.filter((p) => only.includes(p.id)) : PAIRS;
  for (const [suffix, extra] of [["before", "&placement=legacy"], ["after", ""]]) {
    const page = await open(extra);
    for (const c of cases) {
      await shoot(page, path.join(OUT, `${c.id}-${suffix}.png`), c.year, c.at, c.off, !!c.labels);
      console.log(`${c.id}-${suffix}.png  ${c.note}`);
    }
    await page.close();
  }
} else if (mode === "fixes") {
  const suffix = process.argv[3] ?? "after";
  const only = process.argv.slice(4);
  const cases = only.length ? FIXES.filter((p) => only.includes(p.id)) : FIXES;
  const page = await open("");
  for (const c of cases) {
    await shoot(page, path.join(OUT, `${c.id}-${suffix}.png`), c.year, c.at ?? [0, 0], c.off, !!c.labels, c.ll ?? null);
    console.log(`${c.id}-${suffix}.png  ${c.note}`);
  }
  await page.close();
} else {
  const years = process.argv.slice(3).map(Number);
  const page = await open("");
  for (const y of years.length ? years : [60, 150, 300, 600, 900, 1100, 1233, 1400, 1550, 1616])
    for (const [id, x, z, off] of VIEWS) {
      await shoot(page, path.join(OUT, "walk", `${y}-${id}.png`), y, [x, z], off);
      console.log(`walk/${y}-${id}.png`);
    }
  await page.close();
}
await browser.close();
