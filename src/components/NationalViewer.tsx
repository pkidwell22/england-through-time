"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "../../app/national.css";
import { LOCATION_IDS, eraAt } from "@/lib/data";
import type { Source } from "@/lib/types";
import { TimeScale, formatHist, formatT, histToT, parseYearInput } from "@/lib/years";
import { type LoadReport, loadNational, nationalLoadReport, validYear } from "@/national/data";
import type { NationalEngine, NationalSelection, NationalState, Quality } from "@/national/engine";
import { type IconId, iconSvg } from "@/national/icons";
import type { LineFeature, LineKind, NationalDataset, Place, PlaceKind, Polity } from "@/national/types";
import { NatTimeline } from "@/national/ui/NatTimeline";
import { Credits, Fatal, HiddenToast, Notice, useHotkeys } from "./ui/Chrome";
import { EvidenceBadges, EvidenceKey } from "./ui/evidence";
import { Icon } from "./ui/icons";
import { NotKnown, PhaseItem, Section, SourceList } from "./ui/Panel";
import { type SiteWindow, formatSpan, landingFor, loadSiteWindow } from "./ui/siteWindow";

const KIND_LABEL: Record<PlaceKind, string> = {
  city: "City", town: "Town", port: "Port", fort: "Fort", hillfort: "Hillfort", monument: "Monument", monastery: "Monastery",
  cathedral: "Cathedral", castle: "Castle", palace: "Palace", battle: "Battle", mine: "Mine", other: "Place",
};
const LINE_LABEL: Record<LineKind, string> = {
  "roman-road": "Roman road", road: "Road", "frontier-wall": "Frontier wall", dyke: "Dyke", "river-route": "River route", border: "Border",
};
const POLITY_LABEL: Record<Polity["kind"], string> = {
  people: "People", province: "Province", kingdom: "Kingdom", principality: "Principality", earldom: "Earldom", march: "March", realm: "Realm",
};
const SIZE_LABEL = ["abandoned, site known", "minor", "small", "middling", "large", "among the largest in Britain"];
/** Shown in the key, drawn from the same symbols as the map (src/national/icons.ts). */
const KEY_KINDS: PlaceKind[] = ["city", "town", "port", "hillfort", "fort", "castle", "monastery", "cathedral", "palace", "monument", "battle", "mine"];
const KEY_LINES: LineKind[] = ["roman-road", "road", "frontier-wall", "dyke", "border", "river-route"];
/** Key strokes, matching LINE_STYLE in the engine: core colour, width, dash. */
const KEY_STROKE: Record<LineKind, { c: string; w: number; dash?: string }> = {
  "roman-road": { c: "#9a2f1c", w: 2 }, road: { c: "#5a3b20", w: 1.6, dash: "4 3" }, "frontier-wall": { c: "#231713", w: 3.4 },
  dyke: { c: "#34421c", w: 2.8, dash: "4 2" }, border: { c: "#5b3c86", w: 1.7, dash: "7 3" }, "river-route": { c: "#245f86", w: 1.8 },
};

declare global {
  interface Window {
    __nat?: NationalEngine;
    __natData?: NationalDataset;
  }
}

const fmtYear = (y: number | null | undefined, open = "after 1625") => (y == null ? open : validYear(y) ? formatHist(y) : "date not recorded");
/** Must match NEAR_EXAGGERATION in src/national/engine.ts (kept here so the engine module stays lazily loaded). */
const NEAR_EXAG = 4;
const reduced = () => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

function Glyph({ id, size = 22, ground }: { id: IconId; size?: number; ground?: string }) {
  return <b className="glyph" aria-hidden="true" dangerouslySetInnerHTML={{ __html: iconSvg(id, size, ground) }} />;
}

export interface NationalViewerProps {
  /** Timeline value to open at (takes precedence over ?year=). */
  initialT?: number;
  /** Called when the user descends into a detailed site, with the current timeline value and the place's name. */
  onEnterSite?: (siteId: string, t: number, placeName?: string) => void;
  /** Called once the map is up (or has failed), so the shell can lift its loading veil. */
  onReady?: () => void;
  /** A `?site=` value that names no site: shown as a notice over the map. */
  unknownSite?: string;
}

export default function NationalViewer({ initialT, onEnterSite, onReady, unknownSite }: NationalViewerProps) {
  const host = useRef<HTMLDivElement>(null);
  const engineRef = useRef<NationalEngine | null>(null);
  const enterRef = useRef<(siteId: string, name?: string, placeId?: string) => void>(() => {});
  const [ds, setDs] = useState<NationalDataset | null>(null);
  const [report, setReport] = useState<LoadReport>({ stubbed: [], problems: [] });
  const [st, setSt] = useState<NationalState | null>(null);
  const [sel, setSel] = useState<NationalSelection>(null);
  const [error, setError] = useState<string | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [ui, setUi] = useState(true);
  const [hiddenByKey, setHiddenByKey] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [exag, setExag] = useState(12);
  const [procedural, setProcedural] = useState(false);
  const [windows, setWindows] = useState<Record<string, SiteWindow>>({});
  const [noticeOpen, setNoticeOpen] = useState(!!unknownSite);
  const [folded, setFolded] = useState(false);
  const [diving, setDiving] = useState<{ name: string; year: string } | null>(null);
  const chromeRef = useRef<HTMLDivElement | null>(null);
  const [view, setView] = useState<{ heading: number; kmPerPx: number }>({ heading: 0, kmPerPx: 1 });

  // tell the engine where the panels are, so map lettering is not set under them
  const measure = useCallback(() => {
    const e = engineRef.current, c = chromeRef.current, h = host.current;
    if (!e || !h) return;
    const base = h.getBoundingClientRect();
    const rects = c ? [...c.querySelectorAll<HTMLElement>(".nat-card, .nt, .nat-tools, .nat-mark, .nat-about-toggle, .nat-key, .nat-about, .nat-instr")]
      .map((el) => el.getBoundingClientRect()).filter((r) => r.width > 0 && r.height > 0)
      .map((r) => ({ x0: r.left - base.left - 4, y0: r.top - base.top - 4, x1: r.right - base.left + 4, y1: r.bottom - base.top + 4 })) : [];
    e.setObstacles(rects);
  }, []);
  useEffect(() => {
    const c = chromeRef.current;
    measure();
    if (!c) return;
    const ro = new ResizeObserver(measure);
    for (const el of c.children) ro.observe(el);
    const id = window.setTimeout(measure, 900); // after the entrance animation settles
    return () => { ro.disconnect(); window.clearTimeout(id); };
  });

  useEffect(() => {
    // the period notes start folded on short screens, so the map keeps the room; the reader's choice is remembered
    let v: string | null = null;
    try {
      v = window.localStorage.getItem("nat-era-folded");
    } catch {
      /* storage unavailable: keep the default */
    }
    setFolded(v != null ? v === "1" : window.innerHeight < 820);
  }, []);
  const toggleFold = () => setFolded((v) => {
    try { window.localStorage.setItem("nat-era-folded", v ? "0" : "1"); } catch { /* ignore */ }
    return !v;
  });

  useEffect(() => {
    let cancelled = false;
    let engine: NationalEngine | null = null;
    (async () => {
      try {
        const data = await loadNational();
        if (cancelled || !host.current) return;
        const params = new URLSearchParams(window.location.search);
        const y = params.get("year");
        const parsed = y ? parseYearInput(y) : null;
        const q = params.get("quality") as Quality | null;
        const { NationalEngine } = await import("@/national/engine");
        if (cancelled || !host.current) return;
        const last = data.eras[data.eras.length - 1];
        engine = await NationalEngine.create(host.current, data, {
          t: Number.isFinite(initialT) ? initialT : parsed != null ? histToT(parsed) : last && validYear(last.presetYear) ? histToT(last.presetYear) : undefined,
          quality: q && ["low", "medium", "high"].includes(q) ? q : "medium",
          labels: params.get("labels") !== "0",
          polities: params.get("polities") !== "0",
          evidence: params.get("evidence") === "1",
        });
        if (cancelled) {
          engine.dispose();
          return;
        }
        if (params.get("ui") === "0") setUi(false);
        engineRef.current = engine;
        window.__nat = engine;
        window.__natData = data;
        setExag(engine.exaggeration);
        setProcedural(engine.grid.procedural);
        setReport(nationalLoadReport());
        engine.onChange(setSt);
        engine.onSelect(setSel);
        engine.onView(setView);
        engine.onEnter((siteId, place) => enterRef.current(siteId, place.name, place.id));
        const place = params.get("place");
        if (place) {
          engine.selectPlace(place);
          engine.focusPlace(place);
        }
        setDs(data);
        // the years each enterable site covers, so the Explore control can say which year will open
        const ids = [...new Set(data.places.map((p) => p.site).filter((s): s is string => !!s && LOCATION_IDS.includes(s)))];
        const wins = await Promise.all(ids.map((id) => loadSiteWindow(id)));
        if (!cancelled) setWindows(Object.fromEntries(wins.filter((w): w is SiteWindow => !!w).map((w) => [w.id, w])));
      } catch (e) {
        console.error(e);
        if (!cancelled) setError((e as Error).message || String(e));
      }
    })();
    return () => {
      cancelled = true;
      engine?.dispose();
      engineRef.current = null;
      if (window.__nat === engine) window.__nat = undefined;
    };
    // The engine is built once; initialT is only its starting year.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const scale = useMemo(() => {
    try {
      return ds ? new TimeScale(ds.site.timeline.scale) : null;
    } catch {
      return null;
    }
  }, [ds]);
  const eras = useMemo(() => (ds ? ds.eras.filter((e) => validYear(e.from) && validYear(e.to) && validYear(e.presetYear)) : []), [ds]);
  const events = useMemo(() => (ds ? ds.events.filter((ev) => validYear(ev.year)) : []), [ds]);
  const eng = engineRef.current;
  const isReady = !!(ds && st) || !!error;
  const readyRef = useRef(onReady);
  readyRef.current = onReady;
  useEffect(() => {
    if (isReady) readyRef.current?.();
  }, [isReady]);

  // The way into a site: a short dive towards it with the destination named, then the shell takes over.
  const entering = useRef(false);
  enterRef.current = (siteId: string, name?: string, placeId?: string) => {
    const e = engineRef.current;
    if (!e || !onEnterSite || !LOCATION_IDS.includes(siteId) || entering.current) return;
    entering.current = true;
    const t = e.getT();
    const win = windows[siteId];
    const land = win ? landingFor(win, t) : { t };
    setDiving({ name: win?.name ?? name ?? "Detailed site", year: formatT(land.t) });
    const go = () => {
      entering.current = false;
      onEnterSite(siteId, t, name);
    };
    if (placeId && !reduced()) e.diveInto(placeId).then(go);
    else go();
  };

  const togglePlay = useCallback(() => {
    const e = engineRef.current;
    if (!e) return;
    const s = e.getState();
    if (s.playing) e.pause();
    else e.play(s.direction);
  }, []);
  useHotkeys({
    togglePlay,
    toggleUi: () => setUi((v) => { setHiddenByKey(v); return !v; }),
    escape: () => {
      if (aboutOpen) setAboutOpen(false);
      else engineRef.current?.select(null);
    },
  });

  if (error) return <Fatal title="The national map could not be opened" message={error} />;

  const t = st?.t ?? 0;
  const era = ds && ds.eras.length ? eraAt(ds.eras, t) : null;
  const enterable = ds ? ds.places.filter((p) => p.site && LOCATION_IDS.includes(p.site)) : [];
  const sources = (ids: string[] = []) => (ds ? (ids ?? []).map((id) => ds.sources[id]).filter((s): s is Source => !!s) : []);

  const jump = (y: number) => {
    if (validYear(y)) eng?.setT(histToT(y));
  };
  const close = () => eng?.select(null);
  const stubbedData = report.stubbed.filter((f) => !f.startsWith("sources-"));
  const woodPct = Math.round((eng?.stats().woodland ?? 0) * 100);

  const selKey = sel ? sel.type + ":" + (sel.type === "place" ? sel.place.id : sel.type === "line" ? sel.line.id : sel.polity.id) : null;
  const panel = !ds || !era ? null : sel?.type === "place" ? (
    placePanel({
      place: sel.place, t, sources: sources(sel.place.sources), onYear: jump, onFocus: () => eng?.flyToPlace(sel.place.id, 160),
      canEnter: !!sel.place.site && LOCATION_IDS.includes(sel.place.site) && !!onEnterSite, onEnter: () => sel.place.site && enterRef.current(sel.place.site, sel.place.name, sel.place.id),
      win: sel.place.site ? windows[sel.place.site] : undefined,
    })
  ) : sel?.type === "line" ? (
    linePanel(sel.line, t, sources(sel.line.sources), jump)
  ) : sel?.type === "polity" ? (
    polityPanel(sel.polity, t, sources(sel.polity.sources), jump)
  ) : {
    head: (
      <>
        <p className="kicker">{fmtYear(era.from)} – {fmtYear(era.to)}</p>
        <h2>{era.name}</h2>
      </>
    ),
    body: (
      <>
        <p className="lede">{era.blurb}</p>
        <p className="hint-line">Select a symbol, a road or a shaded territory for its dates, evidence and sources. Drag to pan, scroll to zoom, right-drag to tilt.</p>
        {enterable.length ? (
          <Section title="Places you can go into">
            <ul className="nat-sites">
              {enterable.map((p) => (
                <li key={p.id}>
                  <button className="site-link" data-testid={`site-link-${p.site}`} onClick={() => { eng?.selectPlace(p.id); eng?.flyToPlace(p.id, 160); }}>
                    <i className="beacon" aria-hidden="true" />
                    <span>{p.name}</span>
                    {p.site && windows[p.site] ? <small>{formatSpan(windows[p.site].start, windows[p.site].end)}</small> : null}
                  </button>
                </li>
              ))}
            </ul>
          </Section>
        ) : null}
      </>
    ),
  };

  const curPhase = sel?.type === "place" ? sel.place.phases.find((ph) => inSpan(ph.from, ph.to, t)) : undefined;
  const glyphNow: IconId | null = sel?.type === "place" ? (curPhase?.size === 0 ? "gone" : ((curPhase?.kind ?? sel.place.kind) as IconId)) : null;

  return (
    <div className={"app nat" + (ui ? "" : " bare") + (diving ? " is-diving" : "")}>
      <div ref={host} className="stage" data-testid="stage" />
      {!ui ? <HiddenToast show={hiddenByKey} /> : null}
      {!onReady && (!ds || !st) ? <div className="veil on loading"><div className="veil-card"><p className="veil-title">Unrolling the map of England and Wales…</p></div></div> : null}
      {diving ? (
        <div className="nat-dive" role="status" aria-live="polite">
          <p><span>Going into</span><b>{diving.name}</b><em>{diving.year}</em></p>
        </div>
      ) : null}
      {ds && st && scale && era && panel && ui ? (
        <div className="nat-chrome" data-tools={toolsOpen ? "open" : "closed"} ref={chromeRef}>
          {/* ---- title mark ---- */}
          <div className="nat-title">
            <div className="nat-mark">
              <svg viewBox="0 0 40 40" width="34" height="34" aria-hidden="true" className="nat-emblem">
                <circle cx="20" cy="20" r="18.5" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.55" />
                <circle cx="20" cy="20" r="14" fill="none" stroke="currentColor" strokeWidth="0.8" strokeDasharray="1.2 2.2" opacity="0.6" />
                <path d="M20 4.5l3.2 15.5L20 35.5l-3.2-15.5z" fill="currentColor" />
                <path d="M4.5 20l15.5-2.6L35.5 20 20 22.6z" fill="currentColor" opacity="0.45" />
                <circle cx="20" cy="20" r="2.2" fill="var(--n-smoke-solid)" stroke="currentColor" strokeWidth="1" />
              </svg>
              <div className="nat-name">
                <h1>{ds.site.name}</h1>
                <p className="sub">{fmtYear(ds.site.timeline.start)} to {fmtYear(ds.site.timeline.end)}</p>
              </div>
            </div>
            <button className="about-toggle nat-about-toggle" data-testid="about-toggle" onClick={() => setAboutOpen((v) => !v)} aria-expanded={aboutOpen} aria-controls="nat-about">
              <Icon name="info" size={15} />
              <span>{aboutOpen ? "Hide the scope note" : "What am I looking at?"}</span>
            </button>
            {aboutOpen ? (
              <div className="nat-about" id="nat-about" data-testid="about" role="region" aria-label="What am I looking at?">
                <button className="about-close" onClick={() => setAboutOpen(false)} aria-label="Close the scope note"><Icon name="close" size={16} /></button>
                <p className="nat-about-lede">{ds.site.subtitle}</p>
                <p>{ds.site.scopeNote}</p>
                <h3>The land and the water</h3>
                <p>
                  The relief is today&rsquo;s land surface and sea floor (Copernicus GLO-90 and GEBCO), drawn {exag}&times; taller than true scale when
                  the whole map is in view and less as you come closer (down to {NEAR_EXAG}&times;), lit by a fixed low sun from the north-west, with soft shadows and sky light computed from the same elevation. Slopes are shaded
                  from a 150 m version of the data; the finer grain you see close up is generic texture, not survey.
                </p>
                <p>
                  The coastline is where the sea of the chosen year, raised or lowered on that present-day surface, is joined to open water. It cannot
                  show land since built up, silted, drained or washed away. The sea-level curve is for southern Britain and should not be trusted north
                  of about 53.5&deg; N. Tidal flats show ground within a couple of metres below that sea level.
                </p>
                <p>
                  Rivers are traced from the elevation by where water would flow today, so their lines are approximate and their widths indicative.
                  They are not drawn across the fens and levels, which are shown as wetland for the whole period because the terrain notes say they
                  were wet until drainage after 1625; there, today&rsquo;s drains are artificial cuts. Only natural lakes are drawn: the elevation
                  cannot tell modern reservoirs from lakes, so reservoirs are left out on purpose.
                </p>
                <h3>Woods, fields and fen</h3>
                <p>
                  Woodland follows one national estimate of cover for the year ({woodPct}% now). Where the woods stand is a generic pattern on
                  ground where trees can grow, not a map of real woods. {ds.site.woodland.note} The field patchwork that grows as the woods fall,
                  the fen carr of the early millennia and the meres in the wetland are also generic.
                </p>
                <h3>Symbols and territories</h3>
                <p>
                  Symbols show what a place was in this year and grow with its size at the time; a broken ring marks a site that is abandoned but known,
                  and a slow gold beacon marks a place you can go into. Where symbols crowd, the less important shrink to a dot until you come closer.
                  Shaded extents of kingdoms and peoples are indicative only: borders were rarely lines. Roads and walls linger as a ghost after they
                  pass out of formal use.
                </p>
                <h3>How sure each thing is</h3>
                <EvidenceKey />
                <Credits />
              </div>
            ) : null}
          </div>

          {/* ---- one control cluster ---- */}
          <button className="nat-tools-toggle" onClick={() => setToolsOpen((v) => !v)} aria-expanded={toolsOpen} aria-controls="nat-tools">
            <Icon name="sliders" size={17} />
            <span>Map controls</span>
          </button>
          <div className="nat-tools" id="nat-tools" role="toolbar" aria-label="Map controls">
            <div className="nat-seg" role="group" aria-label="Layers">
              <button className={"nat-sw" + (st.labels ? " on" : "")} aria-pressed={st.labels} onClick={() => eng?.setLabels(!st.labels)} data-testid="labels-toggle" title="Place names">
                <Icon name="labels" size={16} /><span>Names</span>
              </button>
              <button className={"nat-sw" + (st.polities ? " on" : "")} aria-pressed={st.polities} onClick={() => eng?.setPolities(!st.polities)} data-testid="polities-toggle" title="Kingdoms and peoples">
                <Icon name="kingdoms" size={16} /><span>Territories</span>
              </button>
              <button className={"nat-sw" + (st.evidence ? " on" : "")} aria-pressed={st.evidence} onClick={() => eng?.setEvidence(!st.evidence)} data-testid="evidence-toggle" title="Colour symbols and lines by how well they are evidenced">
                <Icon name="evidence" size={16} /><span>Evidence</span>
              </button>
            </div>
            <span className="nat-div" aria-hidden="true" />
            <button data-testid="key-toggle" className={"nat-sw" + (showKey ? " on" : "")} onClick={() => setShowKey((v) => !v)} aria-expanded={showKey} aria-pressed={showKey} title="Map key">
              <Icon name="key" size={16} /><span>Key</span>
            </button>
            <button className="nat-icon-btn" data-testid="reset-view" onClick={() => eng?.flyHome()} aria-label="Reset view" title="Back to the whole map">
              <Icon name="reset" size={17} />
            </button>
            <span className="nat-div" aria-hidden="true" />
            <label className="nat-quality" title="Drawing quality">
              <span className="sr-only">Quality</span>
              <select data-testid="quality-select" value={st.quality} onChange={(e) => eng?.setQuality(e.target.value as Quality)} aria-label="Quality">
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </label>
            <span className="nat-fps" data-testid="fps" title="Frames per second">{st.fps} fps</span>
          </div>

          {stubbedData.length || procedural || (unknownSite && noticeOpen) ? (
            <div className="notices nat-notices">
              {unknownSite && noticeOpen ? (
                <Notice tone="info" onDismiss={() => setNoticeOpen(false)}>
                  There is no detailed site called &ldquo;{unknownSite}&rdquo;. This is the national map; places with a gold beacon open the sites that exist.
                </Notice>
              ) : null}
              {stubbedData.length || procedural ? (
                <Notice tone="warn" testId="stub-note" title={report.stubbed.join(", ")}>
                  {procedural ? "Stand-in terrain. " : ""}
                  {stubbedData.length ? `Placeholder data for ${stubbedData.join(", ")}` : ""}
                </Notice>
              ) : null}
            </div>
          ) : null}

          {/* ---- key and map instruments, bottom left ---- */}
          <div className="nat-corner">
          {st.evidence || showKey ? (
            <div className="nat-key" data-testid="key" aria-label="Map key" role="region">
              {showKey ? (
                <button className="nat-key-close" onClick={() => setShowKey(false)} aria-label="Close the key"><Icon name="close" size={15} /></button>
              ) : null}
              {st.evidence ? (
                <section className="nat-key-sec">
                  <h3>Evidence tint</h3>
                  <EvidenceKey compact={showKey} />
                </section>
              ) : null}
              {showKey ? (
                <>
                  <section className="nat-key-sec">
                    <h3>Places</h3>
                    <div className="nat-key-grid">
                      {KEY_KINDS.map((k) => (
                        <span key={k}><Glyph id={k} /><span>{KIND_LABEL[k]}</span></span>
                      ))}
                      <span><Glyph id="gone" /><span>Abandoned site</span></span>
                      <span><b className="glyph beacon-glyph" aria-hidden="true" dangerouslySetInnerHTML={{ __html: iconSvg("town", 14) }} /><span>Place you can go into</span></span>
                    </div>
                  </section>
                  <section className="nat-key-sec">
                    <h3>Lines</h3>
                    <div className="nat-key-grid lines">
                      {KEY_LINES.map((k) => (
                        <span key={k}>
                          <svg className="stroke" viewBox="0 0 30 10" width="30" height="10" aria-hidden="true">
                            <path d="M1 5h28" stroke="#f3ead6" strokeOpacity="0.55" strokeWidth={KEY_STROKE[k].w + 2.4} strokeLinecap="round" />
                            <path d="M1 5h28" stroke={KEY_STROKE[k].c} strokeWidth={KEY_STROKE[k].w} strokeDasharray={KEY_STROKE[k].dash} />
                          </svg>
                          <span>{LINE_LABEL[k]}</span>
                        </span>
                      ))}
                    </div>
                  </section>
                  <p className="legend-foot">A bigger symbol means a bigger place at the time. Relief is drawn up to {exag}&times; taller than true scale.</p>
                </>
              ) : null}
            </div>
          ) : null}
            <MapInstruments heading={view.heading} kmPerPx={view.kmPerPx} onNorth={() => eng?.faceNorth()} />
          </div>

          {/* ---- the card ---- */}
          <aside
            className={"nat-card" + (sel ? " has-sel" : "") + (!sel && folded ? " folded" : "")} data-testid="info-panel"
            aria-label={selKey ? "Details of the selection" : "About this period"}
          >
            <div className="nat-card-head">
              {sel ? (
                <button className="close" onClick={close} aria-label="Close details" title="Close (Esc)"><Icon name="close" size={18} /></button>
              ) : (
                <button className="nat-fold" onClick={toggleFold} aria-expanded={!folded} aria-label={folded ? "Show the period notes" : "Fold the period notes away"} title={folded ? "Show" : "Fold"}>
                  <Icon name="chevronUp" size={18} />
                </button>
              )}
              {glyphNow ? <span className="nat-card-glyph"><Glyph id={glyphNow} size={30} /></span> : null}
              <div className="swap" key={selKey ?? era.id}>{panel.head}</div>
            </div>
            <div className="nat-card-body swap" key={(selKey ?? era.id) + "-b"} tabIndex={0} role="region" aria-label="Details">
              {panel.body}
            </div>
          </aside>

          <NatTimeline
            t={t} scale={scale} eras={eras} events={events} era={era}
            startLabel={fmtYear(ds.site.timeline.start)} endLabel={fmtYear(ds.site.timeline.end)}
            playing={st.playing} direction={st.direction} speed={st.speed} rate={st.rate}
            onSetT={(v) => eng?.setT(v)} onJump={(v) => eng?.glideT(v)} onPlay={(d) => eng?.play(d)} onToggle={togglePlay} onSpeed={(s, r) => eng?.setSpeed(s, r)}
          />
        </div>
      ) : null}
    </div>
  );
}

/** A compass that turns with the view (press it to face north) and a scale bar for the centre of the view. */
function MapInstruments({ heading, kmPerPx, onNorth }: { heading: number; kmPerPx: number; onNorth: () => void }) {
  const steps = [1, 2, 5, 10, 20, 25, 50, 100, 150, 200, 250];
  let km = steps[0];
  for (const s of steps) if (s / kmPerPx <= 150) km = s;
  const px = Math.max(24, Math.min(170, km / kmPerPx));
  const deg = (-heading * 180) / Math.PI;
  const off = Math.abs(((deg + 540) % 360) - 180) > 2;
  return (
    <div className="nat-instr" aria-label="Map scale and direction">
      <button className={"nat-compass" + (off ? " off" : "")} onClick={onNorth} aria-label="Face north" title={off ? "Face north" : "North is up"}>
        <svg viewBox="0 0 40 40" width="34" height="34" aria-hidden="true" style={{ transform: `rotate(${deg.toFixed(1)}deg)` }}>
          <circle cx="20" cy="20" r="15.5" fill="none" stroke="currentColor" strokeOpacity="0.35" />
          <path d="M20 5.5l4 14.5h-8z" fill="#e7b552" />
          <path d="M20 34.5l4-14.5h-8z" fill="currentColor" fillOpacity="0.55" />
          <text x="20" y="4.6" textAnchor="middle" fontSize="6.5" fill="currentColor" fontFamily="var(--sans)" fontWeight="600">N</text>
        </svg>
      </button>
      <div className="nat-scale" title="Scale at the centre of the view">
        <div className="nat-scale-bar" style={{ width: `${px.toFixed(0)}px` }}><i /><i /></div>
        <span>{km} km</span>
      </div>
    </div>
  );
}

type PanelContent = { head: React.ReactNode; body: React.ReactNode };

const inSpan = (from: number, to: number | null, t: number) => validYear(from) && t >= histToT(from) && (to == null || !validYear(to) || t < Math.max(histToT(to), histToT(from) + 1));

function placePanel({ place, t, sources, onYear, onFocus, canEnter, onEnter, win }: {
  place: Place; t: number; sources: Source[]; onYear: (y: number) => void; onFocus: () => void; canEnter: boolean; onEnter: () => void; win?: SiteWindow;
}): PanelContent {
  const alt = (place.altNames ?? []).find((a) => inSpan(a.from, a.to, t));
  const cur = place.phases.find((p) => inSpan(p.from, p.to, t));
  const kind = cur?.kind ?? place.kind;
  const land = win ? landingFor(win, t) : null;
  return {
    head: (
      <>
        <EvidenceBadges evidence={place.evidence} confidence={place.confidence} testIds tags={[{ text: place.country === "wales" ? "Wales" : "England", tone: "plain" }]} />
        <p className="kicker">{KIND_LABEL[kind] ?? "Place"}{cur ? `, ${SIZE_LABEL[cur.size] ?? ""}` : ", not yet founded, or gone, in this year"}</p>
        <h2 data-testid="selection-name">
          {alt && alt.name !== place.name ? (<>{alt.name} <span className="modern">({place.name})</span></>) : place.name}
        </h2>
        {place.site ? (
          canEnter ? (
            <button className="nat-enter" data-testid="enter-site" onClick={onEnter}>
              <span className="nat-enter-l"><Icon name="enter" size={18} />Explore this site</span>
              <small>
                {!win || !land ? `Opens the detailed model in ${formatT(t)}`
                  : land.inside ? `Opens the detailed model in ${formatT(land.t)}`
                  : `This site covers ${formatSpan(win.start, win.end)}; opens at ${formatT(land.t)}`}
              </small>
            </button>
          ) : (
            <p className="muted" data-testid="enter-site-pending">A detailed site ({place.site}) is planned here but is not built yet.</p>
          )
        ) : null}
      </>
    ),
    body: (
      <>
        <p className="lede">{place.summary}</p>
        {place.uncertainty ? <NotKnown>{place.uncertainty}</NotKnown> : null}
        {place.altNames?.length ? (
          <Section title="Names">
            <ul className="facts names">
              {place.altNames.map((a) => (<li key={a.name + a.from}><span className="nm">{a.name}</span> <span className="yrs">{fmtYear(a.from)} to {fmtYear(a.to)}</span></li>))}
            </ul>
          </Section>
        ) : null}
        <Section title="Phases">
          <ol className="phases">
            {place.phases.map((p, i) => {
              const active = inSpan(p.from, p.to, t);
              return (
                <PhaseItem
                  key={i} testId={`phase-${i}`} on={active} years={`${fmtYear(p.from)} to ${fmtYear(p.to)}`} label={p.label} note={p.note}
                  state={active ? (p.size === 0 ? "abandoned" : "now") : null} onJump={() => onYear(p.from)}
                />
              );
            })}
          </ol>
        </Section>
        <button className="tbtn subtle" onClick={onFocus}><Icon name="frame" size={16} /><span>Centre on the map</span></button>
        <Section title="Sources"><SourceList sources={sources} /></Section>
      </>
    ),
  };
}

function SpanRow({ from, to, t, label, onYear }: { from: number; to: number | null; t: number; label: string; onYear: (y: number) => void }) {
  const active = inSpan(from, to, t);
  return (
    <ol className="phases">
      <PhaseItem on={active} years={`${fmtYear(from)} to ${fmtYear(to)}`} label={label} state={active ? "now" : null} onJump={() => onYear(from)} />
    </ol>
  );
}

function linePanel(line: LineFeature, t: number, sources: Source[], onYear: (y: number) => void): PanelContent {
  const ghost = validYear(line.from) && line.to != null && validYear(line.to) && t >= histToT(line.to);
  return {
    head: (
      <>
        <EvidenceBadges evidence={line.evidence} confidence={line.confidence} testIds />
        <p className="kicker">{LINE_LABEL[line.kind] ?? "Line"}</p>
        <h2 data-testid="selection-name">{line.name}</h2>
      </>
    ),
    body: (
      <>
        <p className="lede">{line.summary}</p>
        {ghost ? <p className="muted">Shown faintly: past its recorded end date, though the line may well have stayed in use.</p> : null}
        {line.uncertainty ? <NotKnown>{line.uncertainty}</NotKnown> : null}
        <Section title="Dates"><SpanRow from={line.from} to={line.to} t={t} label="In use / maintained" onYear={onYear} /></Section>
        <Section title="Sources"><SourceList sources={sources} /></Section>
      </>
    ),
  };
}

function polityPanel(polity: Polity, t: number, sources: Source[], onYear: (y: number) => void): PanelContent {
  return {
    head: (
      <>
        <EvidenceBadges evidence={polity.evidence} confidence={polity.confidence} testIds />
        <p className="kicker">{POLITY_LABEL[polity.kind] ?? "Polity"}</p>
        <h2 data-testid="selection-name">{polity.name}</h2>
      </>
    ),
    body: (
      <>
        <p className="lede">{polity.note}</p>
        <p className="muted">{polity.polygon ? "The shaded extent is indicative: borders were rarely lines." : "No extent is drawn: it is not reasonably known. The name marks roughly where this was."}</p>
        <Section title="Dates"><SpanRow from={polity.from} to={polity.to} t={t} label={POLITY_LABEL[polity.kind] ?? "Polity"} onYear={onYear} /></Section>
        <Section title="Sources"><SourceList sources={sources} /></Section>
      </>
    ),
  };
}
