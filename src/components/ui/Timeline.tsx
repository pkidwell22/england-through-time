"use client";

/**
 * The timeline: year readout (click to type a year), transport, and the chronology track (era bands, event
 * ticks, the slider, and a needle through all three at the current year). Shared by both viewers.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Era, TimelineEvent } from "@/lib/types";
import { type TimeScale, formatHist, formatT, histToT, parseYearInput, tToHist } from "@/lib/years";
import { Icon } from "./icons";

export const SPEEDS: { label: string; speed: number; rate: number }[] = [
  { label: "Auto ½×", speed: 0, rate: 0.5 },
  { label: "Auto 1×", speed: 0, rate: 1 },
  { label: "Auto 2×", speed: 0, rate: 2 },
  { label: "1 yr/s", speed: 1, rate: 1 },
  { label: "5 yr/s", speed: 5, rate: 1 },
  { label: "25 yr/s", speed: 25, rate: 1 },
  { label: "100 yr/s", speed: 100, rate: 1 },
];

/** Nearest dated event within about five years of t, as "1066 CE — Label". */
export function nearestEvent(events: TimelineEvent[], t: number): string {
  let best = "";
  let bd = 6;
  for (const ev of events) {
    const d = Math.abs(histToT(ev.year) + 0.5 - t);
    if (d < bd) {
      bd = d;
      best = `${formatHist(ev.year)} — ${ev.label}`;
    }
  }
  return best;
}

export interface TimelineProps {
  t: number;
  scale: TimeScale;
  /** Eras and events with valid years only. */
  eras: Era[];
  events: TimelineEvent[];
  era: Era;
  startLabel: string;
  endLabel: string;
  playing: boolean;
  direction: 1 | -1;
  speed: number;
  rate: number;
  onSetT: (t: number) => void;
  onPlay: (dir: 1 | -1) => void;
  onToggle: () => void;
  onSpeed: (speed: number, rate: number) => void;
}

const BAND_FONT = '500 12px "Gill Sans", "Gill Sans MT", Seravek, "Segoe UI", Calibri, system-ui, sans-serif';
const BAND_PAD = 14;

type Fit = { lines: string[] } | null;

/**
 * Fit an era name into a band of width w: one line, else two balanced lines, else the head of the name (the part
 * before a colon or before "and"/"&", marked with an ellipsis), else nothing. The tooltip always carries the full name.
 */
function fitLabel(ctx: CanvasRenderingContext2D, name: string, w: number): Fit {
  const full = fitWhole(ctx, name, w);
  if (full) return full;
  const head = name.split(/:| and | & /)[0].trim();
  if (head && head !== name) return fitWhole(ctx, head + "…", w);
  return null;
}

function fitWhole(ctx: CanvasRenderingContext2D, name: string, w: number): Fit {
  const room = w - BAND_PAD;
  if (room < 18) return null;
  if (ctx.measureText(name).width <= room) return { lines: [name] };
  const words = name.split(" ");
  let best: string[] | null = null;
  let bestW = Infinity;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(" "), b = words.slice(i).join(" ");
    const mw = Math.max(ctx.measureText(a).width, ctx.measureText(b).width);
    if (mw <= room && mw < bestW) {
      best = [a, b];
      bestW = mw;
    }
  }
  return best ? { lines: best } : null;
}

export function Timeline(p: TimelineProps) {
  const { t, scale, eras, events, era } = p;
  const [editing, setEditing] = useState(false);
  const [yearText, setYearText] = useState("");
  const [tip, setTip] = useState<{ x: number; title: string; sub: string } | null>(null);
  const [width, setWidth] = useState(0);
  const [fits, setFits] = useState<Record<string, Fit>>({});
  const bandsRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = bandsRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!width) return;
    const ctx = document.createElement("canvas").getContext("2d");
    if (!ctx) return;
    ctx.font = BAND_FONT;
    const out: Record<string, Fit> = {};
    for (const e of eras) {
      const a = scale.tToU(histToT(e.from)), b = scale.tToU(histToT(e.to) + 1);
      out[e.id] = fitLabel(ctx, e.name, (b - a) * width);
    }
    setFits(out);
    // eras/scale are stable per dataset; width drives the refit
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, eras, scale]);

  const u = scale.tToU(t);
  const speedIdx = Math.max(0, SPEEDS.findIndex((s) => s.speed === p.speed && s.rate === p.rate));
  const commitYear = () => {
    setEditing(false);
    const y = parseYearInput(yearText);
    if (y != null) p.onSetT(histToT(y));
  };
  const showTip = (el: HTMLElement, title: string, sub: string) => {
    const tr = trackRef.current?.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    if (!tr) return;
    setTip({ x: r.left + r.width / 2 - tr.left, title, sub });
  };
  const hideTip = () => setTip(null);
  const yr = tToHist(t);
  const nowEvent = nearestEvent(events, t);

  return (
    <footer className="timeline" aria-label="Timeline">
      <div className="readout">
        {editing ? (
          <input
            autoFocus className="year-input" data-testid="year-input" value={yearText} inputMode="text" enterKeyHint="go"
            onChange={(e) => setYearText(e.target.value)} onBlur={commitYear}
            onKeyDown={(e) => { if (e.key === "Enter") commitYear(); if (e.key === "Escape") setEditing(false); }}
            aria-label="Year, for example 55 BCE or 1066"
          />
        ) : (
          <button
            className="year" data-testid="year-readout" title="Type a year (for example 55 BCE)"
            aria-label={`${formatT(t)}. Type a year`}
            onClick={() => { setYearText(formatT(t)); setEditing(true); }}
          >
            <span className="y-num">{Math.abs(yr)}</span> <span className="y-era">{yr < 0 ? "BCE" : "CE"}</span>
          </button>
        )}
        <div className="era-name" data-testid="era-name" aria-live="polite">{era.name}</div>
      </div>

      <div className="transport" role="group" aria-label="Playback">
        <button
          data-testid="reverse" className={"t-btn" + (p.playing && p.direction < 0 ? " on" : "")} onClick={() => p.onPlay(-1)}
          title="Play backwards" aria-label="Play backwards" aria-pressed={p.playing && p.direction < 0}
        >
          <Icon name="backward" />
        </button>
        <button
          data-testid="play-pause" className={"t-btn primary" + (p.playing ? " playing" : "")} onClick={p.onToggle}
          title={p.playing ? "Pause (Space)" : "Play (Space)"} aria-label={p.playing ? "Pause" : "Play"}
        >
          <Icon name={p.playing ? "pause" : "play"} size={22} />
        </button>
        <button
          data-testid="forward" className={"t-btn" + (p.playing && p.direction > 0 ? " on" : "")} onClick={() => p.onPlay(1)}
          title="Play forwards" aria-label="Play forwards" aria-pressed={p.playing && p.direction > 0}
        >
          <Icon name="forward" />
        </button>
        <select className="speed" data-testid="speed-select" aria-label="Playback speed" value={speedIdx} onChange={(e) => { const s = SPEEDS[+e.target.value]; p.onSpeed(s.speed, s.rate); }}>
          {SPEEDS.map((s, i) => (<option key={s.label} value={i}>{s.label}</option>))}
        </select>
      </div>

      <div className="track" ref={trackRef}>
        <div className="eras" ref={bandsRef}>
          {eras.map((e) => {
            const a = scale.tToU(histToT(e.from)), b = scale.tToU(histToT(e.to) + 1);
            const fit = fits[e.id];
            const span = `${formatHist(e.from)} – ${formatHist(e.to)}`;
            return (
              <button
                key={e.id} data-testid={`era-${e.id}`} className={"era" + (e.id === era.id ? " on" : "") + (fit ? "" : " bare")}
                style={{ left: `${a * 100}%`, width: `${(b - a) * 100}%` }}
                aria-label={`${e.name}, ${span}. Go to ${formatHist(e.presetYear)}`}
                onClick={() => p.onSetT(histToT(e.presetYear))}
                onMouseEnter={(ev) => showTip(ev.currentTarget, e.name, span)}
                onFocus={(ev) => showTip(ev.currentTarget, e.name, span)}
                onMouseLeave={hideTip} onBlur={hideTip}
              >
                {fit ? (
                  <span className={fit.lines.length > 1 ? "two" : ""}>
                    {fit.lines[0]}
                    {fit.lines[1] ? <><br />{fit.lines[1]}</> : null}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
        <div className="ticks" aria-hidden="true">
          {events.map((ev) => (
            <button
              key={ev.year + ev.label} tabIndex={-1} className="tick" style={{ left: `${scale.tToU(histToT(ev.year)) * 100}%` }}
              onClick={() => p.onSetT(histToT(ev.year) + 0.5)}
              onMouseEnter={(e) => showTip(e.currentTarget, ev.label, formatHist(ev.year))} onMouseLeave={hideTip}
            />
          ))}
        </div>
        <div className="rail">
          <div className="fill" style={{ width: `${u * 100}%` }} />
          <input
            data-testid="year-slider" type="range" min={0} max={1} step={0.0001} value={u} aria-label="Year"
            aria-valuetext={formatT(t)} onChange={(e) => p.onSetT(scale.uToT(+e.target.value))}
          />
        </div>
        <div className={"needle" + (p.playing ? " playing" : "")} style={{ left: `${u * 100}%` }} aria-hidden="true" />
        {tip ? (
          <div className="tip" role="presentation" style={{ left: `clamp(90px, ${tip.x}px, calc(100% - 90px))` }}>
            <b>{tip.title}</b>
            <span>{tip.sub}</span>
          </div>
        ) : null}
        <div className="ends">
          <span>{p.startLabel}</span>
          <span className="now-event" data-testid="now-event">{nowEvent}</span>
          <span>{p.endLabel}</span>
        </div>
      </div>
    </footer>
  );
}
