"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildDataset, eraAt, initialYear, loadDataset, validateDataset } from "@/lib/data";
import { phaseStatus } from "@/lib/lifecycle";
import type { Dataset, Episode, Landmark, Source, Zone } from "@/lib/types";
import { TimeScale, formatHist, histToT, parseYearInput, tToHist } from "@/lib/years";
import type { Engine, EngineState, Quality, Selection } from "@/scene/engine";
import { Cartouche, Credits, Fatal, Field, HiddenToast, ScopeBadge, Toggle, ToolButton, useHotkeys } from "./ui/Chrome";
import { EvidenceBadges, EvidenceKey } from "./ui/evidence";
import { Icon } from "./ui/icons";
import { InfoPanel, NotKnown, PhaseItem, Section, SourceList } from "./ui/Panel";
import { landingFor } from "./ui/siteWindow";
import { Timeline } from "./ui/Timeline";
// Photo mode (path-traced still): see src/scene/photo and docs/PHOTO-MODE.md
import PhotoPanel from "@/scene/photo/PhotoPanel";

declare global {
  interface Window {
    __ltt?: Engine;
    __lttData?: Dataset;
    /**
     * Preview a dataset that is not registered as a location (used by the browser tests and handy for data authors):
     * pass the parsed files, e.g. { site, landmarks, zones }. Resolves to the validator's list of problems.
     */
    __lttOpen?: (files: Record<string, unknown>) => Promise<string[]>;
  }
}

/**
 * The 3D viewer for one location.
 *  location  id of a folder under data/locations (a `?site=<id>` URL parameter overrides it).
 *  initialT  timeline value to open at (a `?year=` URL parameter still wins).
 *  onExit    when given, a "National map" control calls it with the current timeline value.
 *  onReady   called once the scene is up (or has failed), so the shell can lift its loading veil.
 */
export default function Viewer({ location = "london", initialT, onExit, onReady }: { location?: string; initialT?: number; onExit?: (t: number) => void; onReady?: () => void }) {
  const host = useRef<HTMLDivElement>(null);
  const engineRef = useRef<Engine | null>(null);
  const [ds, setDs] = useState<Dataset | null>(null);
  const [st, setSt] = useState<EngineState | null>(null);
  const [sel, setSel] = useState<Selection>(null);
  const [error, setError] = useState<string | null>(null);
  const [ui, setUi] = useState(true);
  const [hiddenByKey, setHiddenByKey] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [preview, setPreview] = useState<Dataset | null>(null);
  const [photo, setPhoto] = useState(false);

  useEffect(() => {
    window.__lttOpen = async (files) => {
      const data = await buildDataset(String((files.site as { id?: string } | undefined)?.id ?? "preview"), async (f) => files[f], {});
      setError(null);
      setDs(null);
      setSt(null);
      setSel(null);
      setPreview(data);
      return validateDataset(data);
    };
    return () => {
      window.__lttOpen = undefined;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let engine: Engine | null = null;
    let photoCleanup: (() => void) | null = null;
    (async () => {
      try {
        const params = new URLSearchParams(window.location.search);
        const siteParam = params.get("site");
        const data = preview ?? (await loadDataset(siteParam && /^[a-z0-9-]+$/.test(siteParam) ? siteParam : location));
        if (cancelled || !host.current) return;
        const y = params.get("year");
        const parsed = y ? parseYearInput(y) : null;
        const q = params.get("quality") as Quality | null;
        const { Engine } = await import("@/scene/engine");
        if (cancelled || !host.current) return;
        const tl = data.site.timeline;
        const asked = parsed != null ? histToT(parsed) : initialT != null && Number.isFinite(initialT) ? initialT : null;
        // a year outside this site's window opens at the site's own initial year rather than at the clamped edge
        const startT = asked != null ? landingFor({ start: tl.start, end: tl.end, initialYear: tl.initialYear }, asked).t : histToT(initialYear(data));
        engine = new Engine(host.current, data, {
          t: startT,
          quality: q && ["low", "medium", "high", "cinematic"].includes(q) ? q : "medium",
          // ?look=clear|golden|overcast|dawn and ?tonemap=agx|neutral|aces (look development and tests)
          look: (["clear", "golden", "overcast", "dawn"] as const).find((l) => l === params.get("look")),
          toneMap: (["agx", "neutral", "aces"] as const).find((m) => m === params.get("tonemap")),
          labels: params.get("labels") !== "0",
          // ?res=fixed keeps the tier's full resolution; ?res=auto forces automatic scaling (the default outside automated runs)
          resolution: (["auto", "fixed"] as const).find((m) => m === params.get("res")),
        });
        const view = params.get("view");
        if (view) engine.setView(view);
        if (params.get("ui") === "0") setUi(false);
        if (params.get("evidence") === "1") engine.setEvidence(true);
        const epi = params.get("event");
        engineRef.current = engine;
        window.__ltt = engine;
        window.__lttData = data;
        engine.onChange(setSt);
        engine.onSelect(setSel);
        if (epi) engine.goToEpisode(epi);
        // photo mode can also be opened by a "ltt:photo" window event (used by tests/photo-shots.mjs)
        const openPhoto = () => setPhoto(true);
        window.addEventListener("ltt:photo", openPhoto);
        photoCleanup = () => window.removeEventListener("ltt:photo", openPhoto);
        // ?photo=1 opens photo mode once the scene (and its sky) has had time to load; ?photoDelay=<ms> overrides the wait
        if (params.get("photo") === "1") {
          const wait = parseInt(params.get("photoDelay") ?? "3000", 10);
          window.setTimeout(() => { if (!cancelled) setPhoto(true); }, Number.isFinite(wait) ? wait : 3000);
        }
        // keep the address bar on the year actually shown, so a reload or a shared link agrees with the screen
        if (y != null && !preview) {
          const shown = String(tToHist(engine.getT()));
          if (params.get("year") !== shown) {
            params.set("year", shown);
            window.history.replaceState(window.history.state, "", `?${params.toString()}`);
          }
        }
        setDs(data);
      } catch (e) {
        console.error(e);
        if (!cancelled) setError((e as Error).message || String(e));
      }
    })();
    return () => {
      cancelled = true;
      photoCleanup?.();
      setPhoto(false);
      engine?.dispose();
      engineRef.current = null;
      if (window.__ltt === engine) window.__ltt = undefined;
    };
    // initialT only applies when a location is opened; later changes must not rebuild the scene
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location, preview]);

  const scale = useMemo(() => (ds ? new TimeScale(ds.site.timeline.scale) : null), [ds]);
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
    escape: () => setSel(null),
  });

  if (error)
    return (
      <Fatal
        testId="viewer-error" title="This site could not be opened" message={error}
        action={onExit ? <button className="tbtn" data-testid="back-to-map" onClick={() => onExit(initialT ?? 0)}><Icon name="back" size={16} /><span>Back to the national map</span></button> : null}
      />
    );

  const t = st?.t ?? 0;
  const era = ds ? eraAt(ds.eras, t) : null;
  const sources = (ids: string[] = []) => (ds ? ids.map((id) => ds.sources[id]).filter((s): s is Source => !!s) : []);
  const district = ds?.site.district;
  const scopeText = !district ? "Schematic site" : st?.inDistrict ? `Detailed benchmark district: ${district.name}` : "Schematic overview";
  const scopeNote = !district ? "No part of this site is modelled in closer detail" : st?.inDistrict ? "Modelled in more detail than the rest of the scene" : `Only the ${district.name} is modelled in detail`;

  const selKey = sel ? sel.type + ":" + (sel.type === "landmark" ? sel.landmark.id : sel.type === "zone" ? sel.zone.id : sel.episode.id) : null;
  const panel = !ds || !era ? null : sel?.type === "landmark" ? (
    landmarkPanel(sel.landmark, t, ds, sources(sel.landmark.sources), () => eng?.focusLandmark(sel.landmark.id), (y) => eng?.setT(histToT(y)))
  ) : sel?.type === "episode" ? (
    episodePanel(sel.episode, sources(sel.episode.sources))
  ) : sel?.type === "zone" ? (
    zonePanel(sel.zone, ds, sources(sel.zone.sources))
  ) : {
    head: (
      <>
        <p className="kicker">{formatHist(era.from)} – {formatHist(era.to)}</p>
        <h2>{era.name}</h2>
      </>
    ),
    body: (
      <>
        <p className="lede">{era.blurb}</p>
        <p className="hint-line">Select a building or a label for its dates, evidence and sources.</p>
      </>
    ),
  };

  return (
    <div className={"app site" + (ui ? "" : " bare")}>
      <div ref={host} className="stage" data-testid="stage" />
      {!ui ? <HiddenToast show={hiddenByKey} /> : null}
      {!onReady && (!ds || !st) ? <div className="veil on loading"><div className="veil-card"><p className="veil-title">{location === "london" ? "Building 5,600 years of riverbank…" : "Building the landscape…"}</p></div></div> : null}
      {photo && eng && ds ? <PhotoPanel engine={eng} ds={ds} onClose={() => setPhoto(false)} /> : null}
      {ds && st && scale && era && panel && ui && !photo ? (
        <div className="chrome" data-tools={toolsOpen ? "open" : "closed"}>
          <Cartouche
            name={ds.site.name} subtitle={ds.site.subtitle} aboutId="site-about"
            onBack={onExit ? () => onExit(engineRef.current?.getT() ?? t) : undefined}
            about={
              <>
                <p>{ds.site.scopeNote}</p>
                <p>
                  Named landmarks follow dated phases from the sources listed with each one. The ordinary houses, trees and field
                  patterns are generated from dated zones: their extent and timing are based on evidence, but no individual house is a
                  real building.
                </p>
                {district ? <p>{district.note}</p> : <p>The whole of this site is a schematic model; no part of it is modelled in closer detail.</p>}
                <h3>How sure each thing is</h3>
                <EvidenceKey />
                <Credits />
              </>
            }
          />

          <ScopeBadge kind={!district ? "site" : st.inDistrict ? "district" : "overview"} text={scopeText} note={scopeNote} />

          <button className="tools-toggle tbtn" onClick={() => setToolsOpen((v) => !v)} aria-expanded={toolsOpen} aria-controls="site-tools">
            <Icon name="sliders" size={17} />
            <span>Controls</span>
          </button>
          <div className="tools" id="site-tools">
            <div className="tool-row">
              <Field label="View">
                <select data-testid="view-select" value="" onChange={(e) => e.target.value && eng?.setView(e.target.value)}>
                  <option value="">Go to a viewpoint…</option>
                  {ds.site.views.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                      {v.scope === "district" ? " (district)" : ""}
                    </option>
                  ))}
                </select>
              </Field>
              {ds.episodes.length ? (
                <Field label="Events">
                  <select data-testid="event-select" value="" onChange={(e) => e.target.value && eng?.goToEpisode(e.target.value)}>
                    <option value="">Go to an event…</option>
                    {ds.episodes.map((ep) => (
                      <option key={ep.id} value={ep.id}>
                        {ep.name} ({formatHist(ep.year)}){ep.inMap ? "" : " — off map"}
                      </option>
                    ))}
                  </select>
                </Field>
              ) : null}
            </div>
            <div className="tool-row">
              <ToolButton icon="reset" label="Reset view" testId="reset-view" onClick={() => eng?.resetView()} />
              <div className="seg" role="group" aria-label="Navigation mode">
                <button data-testid="mode-orbit" className={st.mode === "orbit" ? "on" : ""} aria-pressed={st.mode === "orbit"} onClick={() => eng?.setMode("orbit")}>
                  <Icon name="orbit" size={16} /><span>Orbit</span>
                </button>
                <button data-testid="mode-walk" className={st.mode === "walk" ? "on" : ""} aria-pressed={st.mode === "walk"} onClick={() => eng?.setMode("walk")}>
                  <Icon name="walk" size={16} /><span>Walk</span>
                </button>
              </div>
            </div>
            <div className="tool-row quiet">
              <Field label="Quality" className="compact">
                <select data-testid="quality-select" value={st.quality} onChange={(e) => eng?.setQuality(e.target.value as Quality)}>
                  <option value="low">Low (fast)</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="cinematic">Cinematic (slow)</option>
                </select>
              </Field>
              <Field label="Light" className="compact">
                <select data-testid="look-select" value={st.look} onChange={(e) => eng?.setLook(e.target.value as EngineState["look"])}>
                  <option value="clear">Clear afternoon</option>
                  <option value="golden">Golden hour</option>
                  <option value="overcast">Overcast</option>
                  <option value="dawn">Misty dawn</option>
                </select>
              </Field>
              <span className="fps" data-testid="fps" title="Frames per second">{st.fps} fps</span>
            </div>
          </div>

          {st.mode === "walk" ? <div className="hint">Drag to look. W A S D to move, Q and E to go lower or higher, Shift to run.</div> : null}

          <div className="corner">
            {st.evidence ? (
              <div className="legend" aria-label="Evidence tint key">
                <p className="legend-h">Evidence tint</p>
                <EvidenceKey />
              </div>
            ) : null}
            <div className="layers" role="group" aria-label="Map layers">
              <Toggle icon="labels" label="Labels" on={st.labels} onChange={(v) => eng?.setLabels(v)} />
              <Toggle icon="evidence" label="Evidence tint" on={st.evidence} onChange={(v) => eng?.setEvidence(v)} testId="evidence-toggle" />
              <ToolButton icon="frame" label="Photo" testId="photo-mode" onClick={() => setPhoto(true)} />
            </div>
          </div>

          <InfoPanel head={panel.head} onClose={sel ? () => setSel(null) : undefined} selKey={selKey}>
            {panel.body}
          </InfoPanel>

          <Timeline
            t={t} scale={scale} eras={ds.eras} events={ds.events} era={era}
            startLabel={formatHist(ds.site.timeline.start)} endLabel={formatHist(ds.site.timeline.end)}
            playing={st.playing} direction={st.direction} speed={st.speed} rate={st.rate}
            onSetT={(v) => eng?.setT(v)} onPlay={(d) => eng?.play(d)} onToggle={togglePlay} onSpeed={(s, r) => eng?.setSpeed(s, r)}
          />
        </div>
      ) : null}
    </div>
  );
}

type PanelContent = { head: React.ReactNode; body: React.ReactNode };

function landmarkPanel(lm: Landmark, t: number, ds: Dataset, srcs: Source[], onFocus: () => void, onYear: (y: number) => void): PanelContent {
  const standIn = lm.phases.some((p) => p.model.kind === "troops" || p.model.kind === "zone-marker");
  return {
    head: (
      <>
        <EvidenceBadges
          evidence={lm.evidence} confidence={lm.confidence} testIds
          tags={[
            ...(standIn ? [{ text: "Stand-in, not a record", tone: "c" as const }] : []),
            lm.tier === "district" ? { text: "Benchmark district", tone: "district" as const } : { text: "Schematic model", tone: "plain" as const },
          ]}
        />
        <h2 data-testid="selection-name">{lm.name}</h2>
      </>
    ),
    body: (
      <>
        <p className="lede">{lm.summary}</p>
        {lm.uncertainty ? <NotKnown>{lm.uncertainty}</NotKnown> : null}
        <Section title="Phases">
          <ol className="phases">
            {lm.phases.map((p, i) => {
              const s = phaseStatus(p, t);
              const active = s.height > 0.001;
              const years = `${formatHist(p.from)}${p.built && p.built !== p.from ? `–${formatHist(p.built)}` : ""} → ${p.to == null ? `after ${Math.abs(ds.site.timeline.end)}` : formatHist(p.to)}`;
              return (
                <PhaseItem
                  key={i} on={active} years={years} label={p.label} note={p.dateNote}
                  state={active ? (s.state === "intact" ? "standing" : s.state) : null} onJump={() => onYear(p.built ?? p.from)}
                />
              );
            })}
          </ol>
        </Section>
        <button className="tbtn subtle" onClick={onFocus}><Icon name="frame" size={16} /><span>Frame in view</span></button>
        <Section title="Sources"><SourceList sources={srcs} /></Section>
      </>
    ),
  };
}

function episodePanel(ep: Episode, srcs: Source[]): PanelContent {
  const list = (title: string, items: string[] = [], cls = "") =>
    items.length ? (
      <Section title={title}>
        <ul className={"facts " + cls}>{items.map((x) => (<li key={x}>{x}</li>))}</ul>
      </Section>
    ) : null;
  return {
    head: (
      <>
        <EvidenceBadges evidence={ep.evidence} confidence={ep.confidence} testIds />
        <h2 data-testid="selection-name">{ep.name}</h2>
      </>
    ),
    body: (
      <>
        <p className="eyebrow date-note"><Icon name="clock" size={15} /><span>{ep.dateNote}</span></p>
        {!ep.inMap ? (
          <NotKnown title="Not on this map">{ep.offMap} The view looks towards it; the place itself is not part of this scene.</NotKnown>
        ) : null}
        <p className="lede">{ep.summary}</p>
        {list("Well evidenced", ep.attested, "att")}
        {list("Tradition or late sources", ep.tradition, "trad")}
        {list("Not known (invented in any staging)", ep.unknown, "unk")}
        <Section title="Sources"><SourceList sources={srcs} /></Section>
      </>
    ),
  };
}

function zonePanel(zone: Zone, ds: Dataset, srcs: Source[]): PanelContent {
  return {
    head: (
      <>
        <EvidenceBadges evidence={zone.evidence} evidenceText={zone.evidence === "conjectural" ? "Conjecture" : "Generic fill"} confidence={zone.confidence} testIds />
        <h2 data-testid="selection-name">{zone.label}</h2>
      </>
    ),
    body: (
      <>
        <p className="lede">
          This is one of many generated buildings, not a specific recorded one. Appears {formatHist(zone.grow[0])}–{formatHist(zone.grow[1])}
          {zone.decline ? `; gone ${formatHist(zone.decline[0])}–${formatHist(zone.decline[1])}` : `; still standing in ${Math.abs(ds.site.timeline.end)}`}.
        </p>
        <p>{zone.note}</p>
        <Section title="Sources"><SourceList sources={srcs} /></Section>
      </>
    ),
  };
}

export { tToHist };
