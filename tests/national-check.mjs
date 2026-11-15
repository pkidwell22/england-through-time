// Behaviour checks for the national map and the map <-> site shell. Needs the dev server (default http://127.0.0.1:4310).
import { chromium } from "playwright-core";
const BASE = process.env.LTT_URL ?? "http://127.0.0.1:4310";
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
let fail = 0;
const ok = (name, cond, extra = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`); if (!cond) fail++; };
const natReady = () => page.waitForFunction(() => window.__nat && window.__nat.getState().ready && document.querySelector('[data-testid="year-readout"]'), null, { timeout: 90000 });
const siteReady = () => page.waitForFunction(() => window.__ltt && window.__ltt.getState().ready && document.querySelector('[data-testid="year-readout"]'), null, { timeout: 120000 });
const text = (id) => page.locator(`[data-testid="${id}"]`).first().innerText();

await page.goto(`${BASE}/`);
await natReady();
ok("bare URL opens the national map", await page.evaluate(() => !!window.__nat));
await page.goto(`${BASE}/?map=1&year=1066`);
await natReady();
ok("?map=1&year=1066 sets the year", (await text("year-readout")) === "1066 CE", await text("year-readout"));

// camera must not move with the year
const cam0 = await page.evaluate(() => JSON.stringify(window.__nat.getCamera()));
await page.evaluate(() => { window.__nat.setT(150); window.__nat.setT(-3000 + 1); window.__nat.setT(NaN); window.__nat.setT(1300); });
await page.waitForTimeout(400);
ok("camera unchanged by year changes", cam0 === (await page.evaluate(() => JSON.stringify(window.__nat.getCamera()))));
ok("setT ignores non-finite", (await page.evaluate(() => window.__nat.getT())) === 1300);

// timeline UI
await page.click('[data-testid="year-readout"]');
await page.fill('[data-testid="year-input"]', "55 BCE");
await page.keyboard.press("Enter");
await page.waitForTimeout(300);
ok("typed year 55 BCE", (await text("year-readout")) === "55 BCE", await text("year-readout"));
const eras = await page.evaluate(() => window.__natData.eras.map((e) => [e.id, e.presetYear]));
await page.click(`[data-testid="era-${eras[1][0]}"]`);
await page.waitForTimeout(300);
ok("era preset jumps", (await page.evaluate(() => window.__nat.getT())) === (eras[1][1] < 0 ? eras[1][1] + 1 : eras[1][1]));
await page.selectOption('[data-testid="speed-select"]', "5");
await page.click('[data-testid="play-pause"]');
await page.waitForTimeout(1200);
const st = await page.evaluate(() => window.__nat.getState());
ok("plays forward", st.playing && st.t > eras[1][1] + 5, `t=${st.t.toFixed(1)}`);
await page.click('[data-testid="reverse"]');
await page.waitForTimeout(600);
ok("reverse", (await page.evaluate(() => window.__nat.getState().direction)) === -1);
await page.click('[data-testid="play-pause"]');
ok("pause", !(await page.evaluate(() => window.__nat.getState().playing)));

// selection by clicking the marker of an enterable place
await page.evaluate(() => { window.__nat.setT(1300); window.__nat.resetView(); });
await page.waitForTimeout(500);
const site = await page.evaluate(() => { const p = window.__natData.places.find((x) => x.site === "london"); const s = p && window.__nat.placeStatus(p.id); return p ? { id: p.id, ...s } : null; });
ok("a place offers the london site", !!site, JSON.stringify(site));
if (site) {
  await page.mouse.click(site.screen[0], site.screen[1]);
  await page.waitForTimeout(400);
  ok("clicking the marker selects it", (await page.evaluate(() => window.__nat.getSelection()?.place?.id)) === site.id);
  ok("info panel shows badges and enter button", (await page.locator('[data-testid="evidence-badge"]').count()) === 1 && (await page.locator('[data-testid="enter-site"]').count()) === 1);
  await page.click('[data-testid="enter-site"]');
  await siteReady();
  ok("entered the site at the same year", (await text("year-readout")) === "1300 CE" && page.url().includes("site=london"), `${await text("year-readout")} ${page.url()}`);
  await page.evaluate(() => window.__ltt.setT(1500));
  await page.waitForTimeout(300);
  await page.locator('[data-testid="back-to-map"]').last().click();
  await natReady();
  ok("back to the map carries the year", (await text("year-readout")) === "1500 CE" && page.url().includes("map=1"), `${await text("year-readout")} ${page.url()}`);
}
// toggles
await page.click('[data-testid="evidence-toggle"]');
await page.click('[data-testid="polities-toggle"]');
await page.selectOption('[data-testid="quality-select"]', "low");
await page.waitForTimeout(400);
const s2 = await page.evaluate(() => window.__nat.getState());
ok("evidence / polities / quality toggles", s2.evidence && !s2.polities && s2.quality === "low", JSON.stringify(s2));
ok("fps readout", /\d+ fps/.test(await text("fps")));

// old deep links still open the London site
await page.goto(`${BASE}/?year=1616&view=bridge`);
await siteReady();
ok("legacy deep link opens the London site in 1616", (await text("year-readout")) === "1616 CE" && (await page.evaluate(() => !window.__nat)));
await page.goto(`${BASE}/?site=london`);
await siteReady();
ok("?site=london opens the site", true);

ok("no page errors", errors.length === 0, errors.join(" | ").slice(0, 400));
await browser.close();
process.exit(fail ? 1 : 0);
