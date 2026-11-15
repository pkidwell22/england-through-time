"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "../../app/national.css";
import { LOCATION_IDS, eraAt } from "@/lib/data";
import type { Source } from "@/lib/types";
import { TimeScale, formatHist, formatT, histToT, parseYearInput } from "@/lib/years";
import { type LoadReport, loadNational, nationalLoadReport, validYear } from "@/national/data";
import type { NationalEngine, NationalSelection, NationalState, Quality } from "@/national/engine";
import type { LineFeature, LineKind, NationalDataset, Place, PlaceKind, Polity } from "@/national/types";
import { Cartouche, Credits, Fatal, Field, HiddenToast, Notice, ScopeBadge, Toggle, ToolButton, useHotkeys } from "./ui/Chrome";
import { EvidenceBadges, EvidenceKey } from "./ui/evidence";
import { Icon } from "./ui/icons";
import { InfoPanel, NotKnown, PhaseItem, Section, SourceList } from "./ui/Panel";
import { type SiteWindow, formatSpan, landingFor, loadSiteWindow } from "./ui/siteWindow";
import { Timeline } from "./ui/Timeline";

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
/** Shown in the key; the shapes are drawn by app/national.css to match the marker shader. */
const KEY_KINDS: PlaceKind[] = ["city", "town", "port", "fort", "hillfort", "castle", "monastery", "cathedral", "palace", "monument", "battle", "mine"];
const KEY_LINES: LineKind[] = ["roman-road", "road", "frontier-wall", "dyke", "border", "river-route"];

declare global {
  interface Window {
    __nat?: NationalEngine;
    __natData?: NationalDataset;
  }
}

const fmtYear = (y: number | null | undefined, open = "after 1625") => (y == null ? open : validYear(y) ? formatHist(y) : "date not recorded");

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
  const enterRef = useRef(onEnterSite);
  enterRef.current = onEnterSite;
  const [ds, setDs] = useState<NationalDataset | null>(null);
  const [report, setReport] = useState<LoadReport>({ stubbed: [], problems: [] });
  const [st, setSt] = useState<NationalState | null>(null);
  const [sel, setSel] = useState<NationalSelection>(null);
  const [error, setError] = useState<string | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [ui, setUi] = useState(true);
  const [hiddenByKey, setHiddenByKey] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [exag, setExag] = useState(12);
  const [procedural, setProcedural] = useState(false);
  const [windows, setWindows] = useState<Record<string, SiteWindow>>({});
  const [noticeOpen, setNoticeOpen] = useState(!!unknownSite);

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
        engine.onEnter((siteId) => {
          if (LOCATION_IDS.includes(siteId)) enterRef.current?.(siteId, engine!.getT(), data.places.find((p) => p.site === siteId)?.name);
        });
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
    escape: () => engineRef.current?.select(null),
  });

  if (error) return <Fatal title="The national map could not be opened" message={error} />;

  const t = st?.t ?? 0;
  const era = ds && ds.eras.length ? eraAt(ds.eras, t) : null;
  const enterable = ds ? ds.places.filter((p) => p.site && LOCATION_IDS.includes(p.site)) : [];
  const sources = (ids: string[] = []) => (ds ? (ids ?? []).map((id) => ds.sources[id]).filter((s): s is Source => !!s) : []);

  const enter = (siteId: string, name?: string) => {
    if (eng && LOCATION_IDS.includes(siteId)) onEnterSite?.(siteId, eng.getT(), name);
  };
  const jump = (y: number) => {
    if (validYear(y)) eng?.setT(histToT(y));
  };
  const close = () => eng?.select(null);
  const stubbedData = report.stubbed.filter((f) => !f.startsWith("sources-"));

  const selKey = sel ? sel.type + ":" + (sel.type === "place" ? sel.place.id : sel.type === "line" ? sel.line.id : sel.polity.id) : null;
  const panel = !ds || !era ? null : sel?.type === "place" ? (
    placePanel({
      place: sel.place, t, sources: sources(sel.place.sources), onYear: jump, onFocus: () => eng?.focusPlace(sel.place.id),
      canEnter: !!sel.place.site && LOCATION_IDS.includes(sel.place.site) && !!onEnterSite, onEnter: () => sel.place.site && enter(sel.place.site, sel.place.name),
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
        <p className="hint-line">Select a marker, a road or a shaded territory for its dates, evidence and sources. Drag to pan, scroll or pinch to zoom, right-drag to tilt.</p>
        {enterable.length ? (
          <Section title="Detailed sites">
            <ul className="nat-sites">
              {enterable.map((p) => (
                <li key={p.id}>
                  <button className="site-link" data-testid={`site-link-${p.site}`} onClick={() => { eng?.selectPlace(p.id); eng?.focusPlace(p.id); }}>
                    <i className="ring" aria-hidden="true" />
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

  return (
    <div className={"app nat" + (ui ? "" : " bare")}>
      <div ref={host} className="stage" data-testid="stage" />
      {!ui ? <HiddenToast show={hiddenByKey} /> : null}
      {!onReady && (!ds || !st) ? <div className="veil on loading"><div className="veil-card"><p className="veil-title">Unrolling the map of England and Wales…</p></div></div> : null}
      {ds && st && scale && era && panel && ui ? (
        <div className="chrome" data-tools={toolsOpen ? "open" : "closed"}>
          <Cartouche
            name={ds.site.name} subtitle={ds.site.subtitle} aboutId="nat-about"
            about={
              <>
                <p>{ds.site.scopeNote}</p>
                <p>
                  The relief is today&rsquo;s land surface and sea floor, drawn {exag}&times; taller than true scale so that hills read at this
                  distance. The coastline is where the sea of the chosen year, lowered or raised on that present-day surface, is joined to open
                  water. It cannot show land since built up, silted, drained or washed away: fens, levels and estuaries are indicative, tinted as
                  marsh rather than mapped. The sea-level curve is for southern Britain and should not be trusted north of about 53.5&deg; N.
                </p>
                <p>
                  Land colour follows a single national estimate of woodland cover ({Math.round((eng?.stats().woodland ?? 0) * 100)}% in this year): darker
                  green when more wooded, paler when more open. It is a trend, not a map of where the trees stood. {ds.site.woodland.note}
                </p>
                <p>
                  Markers are sized by how large a place was at the time and shaped by what it was; a faint ring marks a site that is abandoned but
                  known. Shaded extents of kingdoms and peoples are indicative only: borders were rarely lines. Roads and walls linger as a ghost
                  after they pass out of formal use.
                </p>
                <h3>How sure each thing is</h3>
                <EvidenceKey />
                <Credits />
              </>
            }
          />

          <ScopeBadge kind="national" text="National map" note={enterable.length ? "Places with a gold ring open as detailed sites" : undefined} />

          <button className="tools-toggle tbtn" onClick={() => setToolsOpen((v) => !v)} aria-expanded={toolsOpen} aria-controls="nat-tools">
            <Icon name="sliders" size={17} />
            <span>Controls</span>
          </button>
          <div className="tools" id="nat-tools">
            <div className="tool-row">
              <ToolButton icon="reset" label="Reset view" testId="reset-view" onClick={() => eng?.resetView()} />
            </div>
            <div className="tool-row quiet">
              <Field label="Quality" className="compact">
                <select data-testid="quality-select" value={st.quality} onChange={(e) => eng?.setQuality(e.target.value as Quality)}>
                  <option value="low">Low (fast)</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
              </Field>
              <span className="fps" data-testid="fps" title="Frames per second">{st.fps} fps</span>
            </div>
          </div>

          {stubbedData.length || procedural || (unknownSite && noticeOpen) ? (
            <div className="notices">
              {unknownSite && noticeOpen ? (
                <Notice tone="info" onDismiss={() => setNoticeOpen(false)}>
                  There is no detailed site called &ldquo;{unknownSite}&rdquo;. This is the national map; ringed places open the sites that exist.
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

          <div className="corner">
            {st.evidence || showKey ? (
              <div className="legend nat-key" data-testid="key" aria-label="Map key">
                {st.evidence ? (
                  <>
                    <p className="legend-h">Evidence tint</p>
                    <EvidenceKey />
                  </>
                ) : null}
                {showKey ? (
                  <>
                    <p className="legend-h">Places</p>
                    <div className="nat-key-grid">
                      {KEY_KINDS.map((k) => (
                        <span key={k}><b className={"glyph g-" + k} /> {KIND_LABEL[k]}</span>
                      ))}
                      <span><b className="glyph g-gone" /> Abandoned site</span>
                      <span><b className="glyph g-site" /> Site you can enter</span>
                    </div>
                    <p className="legend-h">Lines</p>
                    <div className="nat-key-grid lines">
                      {KEY_LINES.map((k) => (
                        <span key={k}><b className={"stroke l-" + k} /> {LINE_LABEL[k]}</span>
                      ))}
                    </div>
                    <p className="legend-foot">A bigger marker means a bigger place at the time. Relief is drawn {exag}× taller than true scale.</p>
                  </>
                ) : null}
              </div>
            ) : null}
            <div className="layers" role="group" aria-label="Map layers">
              <Toggle icon="labels" label="Labels" on={st.labels} onChange={(v) => eng?.setLabels(v)} testId="labels-toggle" />
              <Toggle icon="kingdoms" label="Kingdoms & peoples" on={st.polities} onChange={(v) => eng?.setPolities(v)} testId="polities-toggle" />
              <Toggle icon="evidence" label="Evidence tint" on={st.evidence} onChange={(v) => eng?.setEvidence(v)} testId="evidence-toggle" />
              <button data-testid="key-toggle" className={"chip" + (showKey ? " on" : "")} onClick={() => setShowKey((v) => !v)} aria-expanded={showKey} aria-pressed={showKey}>
                <Icon name="key" size={16} />
                <span>Key</span>
              </button>
            </div>
          </div>

          <InfoPanel head={panel.head} onClose={sel ? close : undefined} selKey={selKey}>
            {panel.body}
          </InfoPanel>

          <Timeline
            t={t} scale={scale} eras={eras} events={events} era={era}
            startLabel={fmtYear(ds.site.timeline.start)} endLabel={fmtYear(ds.site.timeline.end)}
            playing={st.playing} direction={st.direction} speed={st.speed} rate={st.rate}
            onSetT={(v) => eng?.setT(v)} onPlay={(d) => eng?.play(d)} onToggle={togglePlay} onSpeed={(s, r) => eng?.setSpeed(s, r)}
          />
        </div>
      ) : null}
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
              {place.altNames.map((a) => (<li key={a.name + a.from}><span className="nm">{a.name}</span> <span className="yrs">{fmtYear(a.from)} → {fmtYear(a.to)}</span></li>))}
            </ul>
          </Section>
        ) : null}
        <Section title="Phases">
          <ol className="phases">
            {place.phases.map((p, i) => {
              const active = inSpan(p.from, p.to, t);
              return (
                <PhaseItem
                  key={i} testId={`phase-${i}`} on={active} years={`${fmtYear(p.from)} → ${fmtYear(p.to)}`} label={p.label} note={p.note}
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
      <PhaseItem on={active} years={`${fmtYear(from)} → ${fmtYear(to)}`} label={label} state={active ? "now" : null} onJump={() => onYear(from)} />
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
