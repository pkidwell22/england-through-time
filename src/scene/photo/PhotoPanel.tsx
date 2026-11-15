"use client";

import { useEffect, useRef, useState } from "react";
import type { Dataset } from "@/lib/types";
import type { Engine } from "../engine";
import type { PhotoMode, PhotoStatus } from "./photoMode";

/**
 * The photo-mode overlay: progress (samples, elapsed), the honest caption, save and exit. While it is open a
 * transparent layer covers the scene so a stray drag cannot move the camera; a click on it picks the focus distance.
 */
export default function PhotoPanel({ engine, ds, onClose }: { engine: Engine; ds: Dataset; onClose: (reason?: string) => void }) {
  const [st, setSt] = useState<PhotoStatus | null>(null);
  const [burn, setBurn] = useState(true);
  const [saving, setSaving] = useState(false);
  const pm = useRef<PhotoMode | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    let mode: PhotoMode | null = null;
    let cancelled = false;
    (async () => {
      const { PhotoMode } = await import("./photoMode");
      if (cancelled) return;
      const params = new URLSearchParams(window.location.search);
      const target = parseInt(params.get("photoSamples") ?? "", 10);
      mode = new PhotoMode(engine, ds, { target: Number.isFinite(target) && target > 0 ? target : undefined });
      pm.current = mode;
      mode.onStatus((s) => {
        setSt(s);
        if (s.phase === "closed") closeRef.current(s.message);
      });
      await mode.start();
    })();
    return () => {
      cancelled = true;
      mode?.exit();
      pm.current = null;
    };
  }, [engine, ds]);

  const save = async () => {
    const m = pm.current;
    if (!m) return;
    setSaving(true);
    try {
      const blob = await m.toBlob(burn);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = burn ? m.fileName() : m.fileName().replace(".png", "-uncaptioned.png");
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 4000);
    } finally {
      setSaving(false);
    }
  };

  const busy = !st || ["settling", "baking", "building", "compiling"].includes(st.phase);
  const pct = st && st.target ? Math.min(100, (st.samples / st.target) * 100) : 0;
  const ready = !!st && (st.phase === "rendering" || st.phase === "done");
  return (
    <>
      <div
        className="photo-shield" data-testid="photo-shield" aria-hidden="true"
        style={{ position: "absolute", inset: 0, zIndex: 5, cursor: st?.dof ? "crosshair" : "default" }}
        onClick={(e) => pm.current?.focusAt(e.clientX, e.clientY)}
      />
      <div className="photo-caption" data-testid="photo-caption" role="note"
        style={{ position: "absolute", left: 14, bottom: 14, zIndex: 6, padding: "6px 10px", background: "rgba(12,12,10,0.62)", color: "rgba(255,250,238,0.95)", font: "600 12px system-ui, sans-serif", borderRadius: 3, pointerEvents: "none", maxWidth: "calc(100% - 28px)" }}>
        {st?.caption}
      </div>
      <div className="card photo-panel" data-testid="photo-panel" role="dialog" aria-label="Photo mode"
        style={{ position: "absolute", right: 14, top: 14, zIndex: 7, width: 300, padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
        <div>
          <p className="kicker" style={{ margin: 0 }}>Photo mode · path traced</p>
          <p data-testid="photo-progress" aria-live="polite" style={{ margin: "4px 0 0" }}>
            {st?.phase === "error" ? `Failed: ${st.error}` : busy ? st?.message ?? "Starting…" : `${st!.samples} / ${st!.target} samples · ${st!.elapsed.toFixed(1)} s${st!.phase === "done" ? " · converged" : ""}`}
          </p>
          <div aria-hidden="true" style={{ height: 4, marginTop: 6, background: "rgba(127,127,127,0.25)", borderRadius: 2 }}>
            <i style={{ display: "block", height: 4, width: `${busy ? 0 : pct}%`, background: "currentColor", borderRadius: 2, opacity: 0.7 }} />
          </div>
          {st?.stats ? (
            <p className="muted" style={{ margin: "6px 0 0", fontSize: 12 }}>
              {(st.stats.triangles / 1e6).toFixed(2)} M triangles · {st.size[0]}×{st.size[1]} · bake {(st.bakeMs / 1000).toFixed(1)} s, BVH {(st.bvhMs / 1000).toFixed(1)} s
            </p>
          ) : null}
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          <label className="field compact" style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span className="field-l">Samples</span>
            <select data-testid="photo-target" value={st?.target ?? 160} onChange={(e) => pm.current?.setTarget(parseInt(e.target.value, 10))}>
              {[64, 160, 400, 1000].map((n) => (<option key={n} value={n}>{n}</option>))}
            </select>
          </label>
          <label className="field compact" style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span className="field-l">Size</span>
            <select data-testid="photo-resolution" value={st?.resolution ?? 1} disabled={!ready} onChange={(e) => pm.current?.setResolution(e.target.value === "2" ? 2 : 1)}>
              <option value="1">1× screen</option>
              <option value="2">2× (slower)</option>
            </select>
          </label>
          <label className="field compact" style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span className="field-l">Depth of field</span>
            <select data-testid="photo-dof" value={st?.dof ?? 0} disabled={!ready} onChange={(e) => pm.current?.setDof(parseFloat(e.target.value))}>
              <option value="0">Off</option>
              <option value="8">f/8</option>
              <option value="2.8">f/2.8</option>
            </select>
          </label>
          <label className="field compact" style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span className="field-l">Exposure</span>
            <input data-testid="photo-ev" type="range" min={-2} max={2} step={0.25} value={st?.exposureEV ?? 0} disabled={!ready} onChange={(e) => pm.current?.setExposureEV(parseFloat(e.target.value))} style={{ width: 90 }} />
          </label>
        </div>
        {st?.dof ? <p className="muted" style={{ margin: 0, fontSize: 12 }}>Click the image to focus{st.focus ? ` (now ${st.focus.toFixed(1)} m)` : ""}.</p> : null}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
            <input type="checkbox" data-testid="photo-denoise" checked={st?.denoise ?? true} onChange={(e) => pm.current?.setDenoise(e.target.checked)} /> Denoise
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
            <input type="checkbox" data-testid="photo-caption-burn" checked={burn} onChange={(e) => setBurn(e.target.checked)} /> Caption on saved image
          </label>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="tbtn" data-testid="photo-save" disabled={!ready || saving} onClick={save}>
            <span>{saving ? "Saving…" : "Save image"}</span>
          </button>
          <button className="tbtn" data-testid="photo-exit" onClick={() => { pm.current?.exit("Back to the live view."); }}>
            <span>Back to live view</span>
          </button>
        </div>
        <p className="muted" style={{ margin: 0, fontSize: 11 }}>Moving the camera or changing the year returns to the live view.</p>
      </div>
    </>
  );
}
