// Interface screenshot set: every chrome state of the national map and the sites, at five viewport sizes.
// Usage: node tests/interface-shots.mjs <label> [viewportFilter] [stateFilter]
//   label           output folder under docs/screenshots/interface/ (e.g. "before", "after")
//   viewportFilter  substring of a viewport name (desk1440, hd1920, lap1280, tab820, phone390)
//   stateFilter     substring of a state name (e.g. "map-", "london-landmark")
// Needs the dev server (default http://127.0.0.1:4310, override with LTT_URL). Writes PNGs and an index.json.
import { chromium } from "playwright-core";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const BASE = process.env.LTT_URL ?? "http://127.0.0.1:4310";
const label = process.argv[2] ?? "current";
const vpFilter = process.argv[3] ?? "";
const stFilter = process.argv[4] ?? "";
const dir = `docs/screenshots/interface/${label}`;
mkdirSync(dir, { recursive: true });

const VIEWPORTS = [
  { name: "desk1440", width: 1440, height: 900 },
  { name: "hd1920", width: 1920, height: 1080 },
  { name: "lap1280", width: 1280, height: 720 },
  { name: "tab820", width: 820, height: 1180, touch: true },
  { name: "phone390", width: 390, height: 844, touch: true, mobile: true },
];

const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
const index = [];
const problems = [];

const natReady = (page) => page.waitForFunction(() => window.__nat && window.__nat.getState().ready && document.querySelector('[data-testid="year-readout"]'), null, { timeout: 120000 });
const siteReady = (page) => page.waitForFunction(() => window.__ltt && window.__ltt.getState().ready && document.querySelector('[data-testid="year-readout"]'), null, { timeout: 150000 });
/** A state is wanted when its name contains the filter; a section or group is wanted when the filter starts with its prefix. */
const want = (state) => !stFilter || state.includes(stFilter) || stFilter.startsWith(state);
/** Click a control by test id even when it sits in a collapsed menu (DOM click, not a pointer click). */
const domClick = (page, id) => page.$eval(`[data-testid="${id}"]`, (el) => el.click()).catch(() => problems.push(`no ${id}`));

async function shot(page, vp, state, note = "") {
  if (!want(state)) return;
  const file = `${vp.name}--${state}.png`;
  await page.screenshot({ path: `${dir}/${file}` });
  index.push({ viewport: vp.name, state, file, note });
  console.log(file);
}

async function open(vp, path, ready) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1, hasTouch: !!vp.touch, isMobile: !!vp.mobile });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => problems.push(`${vp.name} ${path}: ${e.message}`));
  await page.goto(`${BASE}${path}`);
  if (ready) await ready(page);
  await page.waitForTimeout(1400);
  return { ctx, page };
}

for (const vp of VIEWPORTS) {
  if (vpFilter && !vp.name.includes(vpFilter)) continue;
  try {
    await shootViewport(vp);
  } catch (e) {
    // another file may be mid-edit (hot reload); keep going with the next viewport and report it
    problems.push(`${vp.name}: ${String(e).split("\n")[0]}`);
    console.log(`${vp.name} failed: ${String(e).split("\n")[0]}`);
  }
}

async function shootViewport(vp) {

  // ---------------- national map ----------------
  if (["map-", "transition"].some(want)) {
    const { ctx, page } = await open(vp, "/?map=1&year=1300", natReady);
    await shot(page, vp, "map-default");
    if (want("map-about")) {
      await domClick(page, "about-toggle");
      await page.waitForTimeout(400);
      await shot(page, vp, "map-about");
      await page.$$eval("details.credits", (ds) => ds.forEach((d) => { d.open = true; d.scrollIntoView(); })).catch(() => {});
      await page.waitForTimeout(250);
      await shot(page, vp, "map-about-credits");
      await domClick(page, "about-toggle");
    }
    if (want("map-place")) {
      await page.evaluate(() => { window.__nat.selectPlace("london"); window.__nat.focusPlace("london"); });
      await page.waitForTimeout(1500);
      await shot(page, vp, "map-place-explore", "London selected: Explore this site");
      await page.evaluate(() => { window.__nat.select(null); window.__nat.resetView(); window.__nat.selectPlace("york"); window.__nat.focusPlace("york"); });
      await page.waitForTimeout(1500);
      await shot(page, vp, "map-place-long", "York: many phases, names, sources");
      await page.$eval('[data-testid="info-panel"]', (el) => { const sc = el.querySelector(".panel-scroll") ?? el; sc.scrollTop = sc.scrollHeight; }).catch(() => {});
      await page.waitForTimeout(300);
      await shot(page, vp, "map-place-long-scrolled");
      await page.evaluate(() => { const d = window.__natData; const l = d.lines.find((x) => x.kind === "roman-road") ?? d.lines[0]; window.__nat.select({ type: "line", line: l }); });
      await page.waitForTimeout(500);
      await shot(page, vp, "map-line");
      await page.evaluate(() => { const d = window.__natData; const p = d.polities.find((x) => x.polygon) ?? d.polities[0]; window.__nat.select({ type: "polity", polity: p }); });
      await page.waitForTimeout(500);
      await shot(page, vp, "map-polity");
      await page.evaluate(() => { window.__nat.select(null); window.__nat.resetView(); });
      await page.waitForTimeout(1200);
    }
    if (want("map-evidence")) {
      await page.evaluate(() => window.__nat.setEvidence(true));
      await domClick(page, "key-toggle");
      await page.waitForTimeout(800);
      await shot(page, vp, "map-evidence-key");
      await domClick(page, "key-toggle");
      await page.waitForTimeout(300);
      await shot(page, vp, "map-evidence-only");
      await page.evaluate(() => window.__nat.setEvidence(false));
    }
    if (want("map-polities-off")) {
      await page.evaluate(() => window.__nat.setPolities(false));
      await page.waitForTimeout(700);
      await shot(page, vp, "map-polities-off");
      await page.evaluate(() => window.__nat.setPolities(true));
    }
    if (want("map-playing")) {
      await page.evaluate(() => { window.__nat.setSpeed(25, 1); window.__nat.play(1); });
      await page.waitForTimeout(1500);
      await shot(page, vp, "map-playing");
      await page.evaluate(() => window.__nat.pause());
    }
    if (want("map-focus")) {
      await page.evaluate(() => document.activeElement && document.activeElement.blur());
      await page.mouse.click(5, Math.round(vp.height / 2));
      for (let i = 0; i < 4; i++) await page.keyboard.press("Tab");
      await page.waitForTimeout(250);
      await shot(page, vp, "map-focus", "after four Tab presses");
      await page.locator('[data-testid="year-slider"]').focus().catch(() => {});
      await page.waitForTimeout(250);
      await shot(page, vp, "map-focus-slider");
    }
    if (want("transition")) {
      await page.evaluate(() => { window.__nat.selectPlace("london"); window.__nat.focusPlace("london"); });
      await page.waitForTimeout(1200);
      await domClick(page, "enter-site");
      await page.waitForTimeout(120);
      await shot(page, vp, "transition-1-entering");
      await page.waitForTimeout(700);
      await shot(page, vp, "transition-2-loading");
      await siteReady(page);
      await page.waitForTimeout(1200);
      await shot(page, vp, "transition-3-site");
      await page.evaluate(() => window.__ltt.setT(1500.5));
      await page.locator('[data-testid="back-to-map"]').last().evaluate((el) => el.click());
      await page.waitForTimeout(150);
      await shot(page, vp, "transition-4-leaving");
      await natReady(page);
      await page.waitForTimeout(1200);
      await shot(page, vp, "transition-5-map");
    }
    await ctx.close();
  }

  // ---------------- unknown site ----------------
  if (want("error-unknown-site")) {
    const { ctx, page } = await open(vp, "/?site=nonsense", natReady);
    await shot(page, vp, "error-unknown-site");
    await ctx.close();
  }

  // ---------------- loading ----------------
  if (want("loading")) {
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1, hasTouch: !!vp.touch, isMobile: !!vp.mobile });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/?site=london&year=1616`);
    await page.waitForSelector(".loading", { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(250);
    await shot(page, vp, "loading-site");
    await page.goto(`${BASE}/?map=1`);
    await page.waitForSelector(".loading", { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(250);
    await shot(page, vp, "loading-map");
    await ctx.close();
  }

  // ---------------- London ----------------
  if (want("london")) {
    const { ctx, page } = await open(vp, "/?site=london&year=1616", siteReady);
    await shot(page, vp, "london-default");
    if (want("london-about")) {
      await page.locator("button.link, [data-testid='about-toggle']").first().evaluate((el) => el.click()).catch(() => problems.push("no about toggle"));
      await page.waitForTimeout(400);
      await shot(page, vp, "london-about");
      await page.$$eval("details.credits", (ds) => ds.forEach((d) => { d.open = true; d.scrollIntoView(); })).catch(() => {});
      await page.waitForTimeout(250);
      await shot(page, vp, "london-about-credits");
      await page.locator("button.link, [data-testid='about-toggle']").first().evaluate((el) => el.click()).catch(() => {});
    }
    if (want("london-landmark")) {
      const id = await page.evaluate(() => {
        const d = window.__lttData;
        const lm = [...d.landmarks].sort((a, b) => b.phases.length + b.sources.length - (a.phases.length + a.sources.length))[0];
        for (const cb of window.__ltt.selectListeners) cb({ type: "landmark", landmark: lm });
        window.__ltt.focusLandmark(lm.id);
        return lm.id;
      });
      await page.waitForTimeout(1800);
      await shot(page, vp, "london-landmark-long", id);
      await page.$eval('[data-testid="info-panel"]', (el) => { const sc = el.querySelector(".panel-scroll") ?? el; sc.scrollTop = sc.scrollHeight; }).catch(() => {});
      await page.waitForTimeout(300);
      await shot(page, vp, "london-landmark-long-scrolled");
      await page.evaluate(() => {
        const d = window.__lttData;
        const lm = d.landmarks.find((l) => l.id === "london-bridge" || /bridge/i.test(l.id)) ?? d.landmarks[0];
        for (const cb of window.__ltt.selectListeners) cb({ type: "landmark", landmark: lm });
        window.__ltt.setView("bridge");
      });
      await page.waitForTimeout(1800);
      await shot(page, vp, "london-landmark-district", "bridge view: benchmark district badge");
    }
    if (want("london-zone")) {
      await page.evaluate(() => {
        const z = window.__lttData.zones[0];
        for (const cb of window.__ltt.selectListeners) cb({ type: "zone", zone: z });
      });
      await page.waitForTimeout(500);
      await shot(page, vp, "london-zone");
    }
    if (want("london-evidence")) {
      await page.evaluate(() => { for (const cb of window.__ltt.selectListeners) cb(null); window.__ltt.resetView(); window.__ltt.setEvidence(true); });
      await page.waitForTimeout(1500);
      await shot(page, vp, "london-evidence");
      await page.evaluate(() => window.__ltt.setEvidence(false));
    }
    if (want("london-walk")) {
      await page.evaluate(() => window.__ltt.setMode("walk"));
      await page.waitForTimeout(1200);
      await shot(page, vp, "london-walk");
      await page.evaluate(() => window.__ltt.setMode("orbit"));
    }
    if (want("london-early")) {
      await page.evaluate(() => { window.__ltt.resetView(); window.__ltt.setT(-2500); });
      await page.waitForTimeout(1500);
      await shot(page, vp, "london-early", "bright prehistoric sky behind the chrome");
    }
    await ctx.close();
  }

  // ---------------- the battle sites and Stonehenge ----------------
  for (const site of ["brentford", "barnet", "stonehenge"]) {
    if (!want(site)) continue;
    const { ctx, page } = await open(vp, `/?site=${site}`, siteReady);
    await shot(page, vp, `${site}-default`);
    const ep = await page.evaluate(() => window.__lttData.episodes[0]?.id ?? null);
    if (ep && want(`${site}-episode`)) {
      await page.evaluate((id) => window.__ltt.goToEpisode(id), ep);
      await page.waitForTimeout(2000);
      await shot(page, vp, `${site}-episode`, ep);
    }
    await ctx.close();
  }
}

// merge with an earlier partial run of the same label, so filtered runs keep one complete index
const prev = existsSync(`${dir}/index.json`) ? JSON.parse(readFileSync(`${dir}/index.json`, "utf8")).shots ?? [] : [];
const merged = [...prev.filter((p) => !index.some((s) => s.file === p.file)), ...index].sort((a, b) => a.file.localeCompare(b.file));
writeFileSync(`${dir}/index.json`, JSON.stringify({ when: new Date().toISOString(), base: BASE, shots: merged, problems }, null, 2));
console.log(`${index.length} screenshots in ${dir}`);
if (problems.length) console.log("problems:\n  " + problems.slice(0, 30).join("\n  "));
await browser.close();
