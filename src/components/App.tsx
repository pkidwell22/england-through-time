"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { LOCATION_IDS } from "@/lib/data";
import { formatT, histToT, parseYearInput, tToHist } from "@/lib/years";
import NationalViewer from "./NationalViewer";
import Viewer from "./Viewer";
import { Veil } from "./ui/Chrome";
import { landingFor, loadSiteWindow } from "./ui/siteWindow";

/**
 * Shell: the national map by default; a detailed site when the user descends into one.
 *
 *   /                      national map
 *   /?map=1&year=1066      national map in 1066
 *   /?site=london          the London site
 *   /?year=1616&view=bridge   any site-viewer parameter without `map` opens the default site,
 *                             so links from before the national map existed keep working
 *
 * The year is carried both ways; the address bar is kept in step so Back and reload behave. Entering a site whose
 * window does not include the map's year lands on the site's own initial year, and that is the year written to
 * the address bar. A veil covers each hand-off: it fades in over the view being left, names the destination and
 * the year, and lifts when the new view reports that it is ready.
 */

type MapRoute = { mode: "map"; t?: number; key: number; unknownSite?: string };
type SiteRoute = { mode: "site"; site: string; t?: number; key: number; title?: string };
type Route = MapRoute | SiteRoute;
type RouteSpec = Omit<MapRoute, "key"> | Omit<SiteRoute, "key">;

const DEFAULT_SITE = "london";
/** Parameters the site viewer understood before the national map existed. */
const SITE_PARAMS = ["year", "view", "event", "quality", "labels", "evidence", "ui"];
const NATIONAL_TITLE = "England and Wales";

let seq = 0;

function routeFromUrl(search: string): Route {
  const p = new URLSearchParams(search);
  const y = p.get("year");
  const parsed = y ? parseYearInput(y) : null;
  const t = parsed != null ? histToT(parsed) : undefined;
  if (p.has("map")) return { mode: "map", t, key: ++seq };
  const site = p.get("site");
  if (site) return LOCATION_IDS.includes(site) ? { mode: "site", site, t, key: ++seq } : { mode: "map", t, key: ++seq, unknownSite: site.slice(0, 40) };
  if (SITE_PARAMS.some((k) => p.has(k))) return { mode: "site", site: DEFAULT_SITE, t, key: ++seq };
  return { mode: "map", t, key: ++seq };
}

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
const pause = (ms: number) => new Promise((r) => window.setTimeout(r, ms));

export default function App() {
  const [route, setRoute] = useState<Route | null>(null);
  const [readyKey, setReadyKey] = useState<number | null>(null);
  const [handoff, setHandoff] = useState<{ title: string; year?: string } | null>(null);
  const busy = useRef(false);

  useEffect(() => {
    const read = () => {
      setHandoff(null);
      setRoute(routeFromUrl(window.location.search));
    };
    read();
    window.addEventListener("popstate", read);
    return () => window.removeEventListener("popstate", read);
  }, []);

  const go = useCallback(async (title: string, year: number | undefined, url: string, next: RouteSpec) => {
    if (busy.current) return;
    busy.current = true;
    setHandoff({ title, year: year != null && Number.isFinite(year) ? formatT(year) : undefined });
    if (!reducedMotion()) await pause(260);
    window.history.pushState(null, "", url);
    setRoute({ ...next, key: ++seq } as Route);
    busy.current = false;
  }, []);

  const enterSite = useCallback(async (site: string, t: number, placeName?: string) => {
    if (!LOCATION_IDS.includes(site)) return;
    const win = await loadSiteWindow(site);
    const land = win ? landingFor(win, t) : { t, inside: true };
    const title = win?.name ?? placeName ?? "Detailed site";
    await go(title, land.t, `?site=${encodeURIComponent(site)}&year=${tToHist(land.t)}`, { mode: "site", site, t: land.t, title });
  }, [go]);

  const exitSite = useCallback(async (t: number) => {
    const ok = Number.isFinite(t);
    await go(NATIONAL_TITLE, ok ? t : undefined, ok ? `?map=1&year=${tToHist(t)}` : "?map=1", { mode: "map", t: ok ? t : undefined });
  }, [go]);

  // a site opened straight from a link: name it on the veil as soon as its site.json is read
  const [linkTitle, setLinkTitle] = useState<string | undefined>();
  useEffect(() => {
    if (route?.mode !== "site" || route.title) return;
    let live = true;
    loadSiteWindow(route.site).then((w) => live && setLinkTitle(w?.name));
    return () => { live = false; };
  }, [route]);

  const ready = route != null && readyKey === route.key;
  const onReady = useCallback((key: number) => {
    setReadyKey(key);
    setHandoff(null);
  }, []);

  const veilTitle = handoff?.title ?? (route?.mode === "site" ? route.title ?? linkTitle ?? "Opening the detailed site" : NATIONAL_TITLE);
  const veilYear = handoff ? handoff.year : route?.t != null && Number.isFinite(route.t) ? formatT(route.t) : undefined;
  const veilLine =
    handoff || !route ? undefined
      : route.mode === "map" ? "Unrolling the map of England and Wales…"
      : route.site === "london" ? "Building 5,600 years of riverbank…"
      : "Building the landscape…";

  return (
    <>
      {route?.mode === "site" ? (
        <Viewer key={route.key} location={route.site} initialT={route.t} onExit={exitSite} onReady={() => onReady(route.key)} />
      ) : route?.mode === "map" ? (
        <NationalViewer key={route.key} initialT={route.t} onEnterSite={enterSite} onReady={() => onReady(route.key)} unknownSite={route.unknownSite} />
      ) : null}
      <Veil visible={!ready || handoff != null} title={veilTitle} year={veilYear} line={veilLine} />
    </>
  );
}
