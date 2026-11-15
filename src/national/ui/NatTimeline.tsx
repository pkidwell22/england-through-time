"use client";

/**
 * The national map's timeline: the year as a set numeral (click to type one), transport, and a chronology ribbon
 * with the era names set above it in up to two rows, event ticks, the slider and a needle. Hovering the ribbon shows
 * the year under the pointer. Same hooks as the shared timeline (year-readout, year-input, era-name, era-<id>,
 * play-pause, forward, reverse, speed-select, year-slider, .ends), so tests and keyboard use carry over.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Era, TimelineEvent } from "@/lib/types";
import { type TimeScale, formatHist, formatT, histToT, parseYearInput, tToHist } from "@/lib/years";
import { Icon } from "@/components/ui/icons";
import { SPEEDS } from "@/components/ui/Timeline";

/** Nearest dated event within about five years of t, as "Label, 1066 CE". */
function nearestEvent(events: TimelineEvent[], t: number): string {
  let best = "";
  let bd = 6;
  for (const ev of events) {
    const d = Math.abs(histToT(ev.year) + 0.5 - t);
    if (d < bd) {
      bd = d;
      best = `${ev.label}, ${formatHist(ev.year)}`;
    }
  }
  return best;
}

export interface NatTimelineProps {
  t: number;
  scale: TimeScale;
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
  /** A jump chosen from the ribbon (an era or an event): may glide rather than cut. */
  onJump?: (t: number) => void;
  onPlay: (dir: 1 | -1) => void;
  onToggle: () => void;
  onSpeed: (speed: number, rate: number) => void;
}

const NAME_FONT = '500 12.5px "Gill Sans", "Gill Sans MT", Seravek, "Segoe UI", Calibri, system-ui, sans-serif';
/** Shorter forms of an era name, longest first: the whole name, before a colon, before "and", without a trailing "England" or "kingdoms". */
function nameForms(name: string): string[] {
  const out = [name];
  const add = (v: string) => { v = v.trim(); if (v && !out.includes(v)) out.push(v); };
  const head = name.split(":")[0];
  add(head);
  const andHead = head.split(/ and | & /)[0];
  add(andHead);
  add(andHead.replace(/\s+(kingdoms|England|Britain)$/i, ""));
  return out;
}

type Placed = { id: string; text: string; row: 0 | 1; x: number; w: number } | null;

export function NatTimeline(p: NatTimelineProps) {
  const { t, scale, eras, events, era } = p;
  const [editing, setEditing] = useState(false);
  const [yearText, setYearText] = useState("");
  const [width, setWidth] = useState(0);
  const [ghost, setGhost] = useState<{ x: number; label: string } | null>(null);
  const [tip, setTip] = useState<{ x: number; title: string; sub: string } | null>(null);
  const trackRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  // era names: centred over their band when there is room, else on a second row, else shortened, else left to the tooltip
  const placed = useMemo<Record<string, Placed>>(() => {
    const out: Record<string, Placed> = {};
    if (!width) return out;
    const ctx = document.createElement("canvas").getContext("2d");
    if (!ctx) return out;
    ctx.font = NAME_FONT;
    const rows: { x0: number; x1: number }[][] = [[], []];
    const GAP = 14;
    for (const e of eras) {
      const a = scale.tToU(histToT(e.from)) * width, b = scale.tToU(histToT(e.to) + 1) * width;
      const c = (a + b) / 2;
      let done: Placed = null;
      for (const text of nameForms(e.name)) {
        const w = ctx.measureText(text).width;
        const x = Math.max(0, Math.min(width - w, c - w / 2));
        // a name may overhang its band a little, never far
        if (w > (b - a) + 120) continue;
        for (const row of [0, 1] as const) {
          if (rows[row].every((r) => x + w + GAP <= r.x0 || x >= r.x1 + GAP)) {
            done = { id: e.id, text, row, x, w };
            rows[row].push({ x0: x, x1: x + w });
            break;
          }
        }
        if (done) break;
      }
      out[e.id] = done;
    }
    return out;
  }, [width, eras, scale]);

  const u = scale.tToU(t);
  const speedIdx = Math.max(0, SPEEDS.findIndex((s) => s.speed === p.speed && s.rate === p.rate));
  const commitYear = () => {
    setEditing(false);
    const y = parseYearInput(yearText);
    if (y != null) p.onSetT(histToT(y));
  };
  const yr = tToHist(t);
  const nowEvent = nearestEvent(events, t);
  const twoRows = Object.values(placed).some((x) => x?.row === 1);

  const onTrackMove = (e: React.PointerEvent) => {
    const el = trackRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const x = Math.max(0, Math.min(r.width, e.clientX - r.left));
    setGhost({ x, label: formatT(scale.uToT(x / r.width)) });
  };
  const showTip = (el: HTMLElement, title: string, sub: string) => {
    const tr = trackRef.current?.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    if (tr) setTip({ x: r.left + r.width / 2 - tr.left, title, sub });
  };

  // keep the ghost from lingering after a drag ends outside the track
  useEffect(() => {
    const off = () => setGhost(null);
    window.addEventListener("blur", off);
    return () => window.removeEventListener("blur", off);
  }, []);

  return (
    <footer className={"nt" + (p.playing ? " is-playing" : "")} aria-label="Timeline">
      <div className="nt-readout">
        {editing ? (
          <input
            autoFocus className="nt-year-input" data-testid="year-input" value={yearText} inputMode="text" enterKeyHint="go"
            onChange={(e) => setYearText(e.target.value)} onBlur={commitYear}
            onKeyDown={(e) => { if (e.key === "Enter") commitYear(); if (e.key === "Escape") setEditing(false); }}
            aria-label="Year, for example 55 BCE or 1066"
          />
        ) : (
          <button
            className="nt-year" data-testid="year-readout" title="Type a year (for example 55 BCE)" aria-label={`${formatT(t)}. Type a year`}
            onClick={() => { setYearText(formatT(t)); setEditing(true); }}
          >
            <span className="y-num">{Math.abs(yr)}</span> <span className="y-era">{yr < 0 ? "BCE" : "CE"}</span>
          </button>
        )}
        <div className="nt-era" data-testid="era-name" aria-live="polite">{era.name}</div>
      </div>

      <div className="nt-transport" role="group" aria-label="Playback">
        <button data-testid="reverse" className={"nt-btn" + (p.playing && p.direction < 0 ? " on" : "")} onClick={() => p.onPlay(-1)} title="Play backwards" aria-label="Play backwards" aria-pressed={p.playing && p.direction < 0}>
          <Icon name="backward" size={18} />
        </button>
        <button data-testid="play-pause" className={"nt-btn nt-play" + (p.playing ? " playing" : "")} onClick={p.onToggle} title={p.playing ? "Pause (Space)" : "Play (Space)"} aria-label={p.playing ? "Pause" : "Play"}>
          <Icon name={p.playing ? "pause" : "play"} size={22} />
        </button>
        <button data-testid="forward" className={"nt-btn" + (p.playing && p.direction > 0 ? " on" : "")} onClick={() => p.onPlay(1)} title="Play forwards" aria-label="Play forwards" aria-pressed={p.playing && p.direction > 0}>
          <Icon name="forward" size={18} />
        </button>
        <label className="nt-speed">
          <span className="sr-only">Playback speed</span>
          <select data-testid="speed-select" aria-label="Playback speed" value={speedIdx} onChange={(e) => { const s = SPEEDS[+e.target.value]; p.onSpeed(s.speed, s.rate); }}>
            {SPEEDS.map((s, i) => (<option key={s.label} value={i}>{s.label}</option>))}
          </select>
        </label>
      </div>

      <div className={"nt-track" + (twoRows ? " two-rows" : "")} ref={trackRef} onPointerMove={onTrackMove} onPointerLeave={() => setGhost(null)}>
        <div className="eras">
          {eras.map((e, i) => {
            const a = scale.tToU(histToT(e.from)), b = scale.tToU(histToT(e.to) + 1);
            const pl = placed[e.id];
            const span = `${formatHist(e.from)} – ${formatHist(e.to)}`;
            return (
              <button
                key={e.id} data-testid={`era-${e.id}`} className={"era" + (e.id === era.id ? " on" : "")} data-i={i % 10}
                style={{ left: `${a * 100}%`, width: `${(b - a) * 100}%` }}
                aria-label={`${e.name}, ${span}. Go to ${formatHist(e.presetYear)}`}
                onClick={() => (p.onJump ?? p.onSetT)(histToT(e.presetYear))}
                onMouseEnter={(ev) => showTip(ev.currentTarget, e.name, span)} onFocus={(ev) => showTip(ev.currentTarget, e.name, span)}
                onMouseLeave={() => setTip(null)} onBlur={() => setTip(null)}
              >
                <i className="band" aria-hidden="true" />
                {pl ? (
                  <span className={"era-l r" + pl.row} aria-hidden="true" style={{ left: `${pl.x - a * width}px` }}>{pl.text}</span>
                ) : null}
              </button>
            );
          })}
        </div>
        <div className="ticks" aria-hidden="true">
          {events.map((ev) => {
            const et = histToT(ev.year) + 0.5;
            return (
              <button
                key={ev.year + ev.label} tabIndex={-1} className={"tick" + (et <= t ? " past" : "")} style={{ left: `${scale.tToU(histToT(ev.year)) * 100}%` }}
                onClick={() => (p.onJump ?? p.onSetT)(et)}
                onMouseEnter={(e) => showTip(e.currentTarget, ev.label, formatHist(ev.year))} onMouseLeave={() => setTip(null)}
              />
            );
          })}
        </div>
        <div className="rail">
          <div className="fill" style={{ width: `${u * 100}%` }} />
          <input
            data-testid="year-slider" type="range" min={0} max={1} step={0.0001} value={u} aria-label="Year"
            aria-valuetext={formatT(t)} onChange={(e) => p.onSetT(scale.uToT(+e.target.value))}
          />
        </div>
        <div className="needle" style={{ left: `${u * 100}%` }} aria-hidden="true" />
        {ghost && !tip ? (
          <div className="ghost" style={{ left: `${ghost.x}px` }} aria-hidden="true"><span>{ghost.label}</span></div>
        ) : null}
        {tip ? (
          <div className="nt-tip" role="presentation" style={{ left: `clamp(100px, ${tip.x}px, calc(100% - 100px))` }}>
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
