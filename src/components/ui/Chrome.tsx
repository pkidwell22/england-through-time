"use client";

/** Frame pieces shared by the national map and the sites: title cartouche, scope badge, controls, notices, veil. */
import { type ReactNode, useEffect, useRef, useState } from "react";
import { type IconName, Icon } from "./icons";

/** Space play/pause, H hide the interface, Esc clear the selection. Ignored while typing in a field. */
export function useHotkeys({ togglePlay, toggleUi, escape }: { togglePlay: () => void; toggleUi: () => void; escape?: () => void }) {
  const ref = useRef({ togglePlay, toggleUi, escape });
  ref.current = { togglePlay, toggleUi, escape };
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const tag = (ev.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
      if (ev.code === "Space") {
        // a focused button would also be pressed by Space; the shortcut wins so play/pause is predictable
        ev.preventDefault();
        ref.current.togglePlay();
      }
      if (ev.code === "KeyH") ref.current.toggleUi();
      if (ev.code === "Escape") ref.current.escape?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

/** Title block, top left. On a site it opens with the way back to the national map. */
export function Cartouche({ name, subtitle, onBack, about, aboutId }: { name: string; subtitle?: string; onBack?: () => void; about: ReactNode; aboutId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="cartouche-wrap">
      <div className="cartouche">
        {onBack ? (
          <button className="crumb" data-testid="back-to-map" onClick={onBack} aria-label="Back to the national map">
            <Icon name="back" size={16} />
            <span>National map</span>
          </button>
        ) : null}
        <h1>{name}</h1>
        {subtitle ? <p className="sub">{subtitle}</p> : null}
        <button className="about-toggle" data-testid="about-toggle" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-controls={aboutId}>
          <Icon name="info" size={15} />
          <span>{open ? "Hide the scope note" : "What am I looking at?"}</span>
        </button>
      </div>
      {open ? (
        <div className="about" id={aboutId} data-testid="about" role="region" aria-label="What am I looking at?">
          <button className="about-close" onClick={() => setOpen(false)} aria-label="Close the scope note">
            <Icon name="close" size={16} />
          </button>
          {about}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Data and credits, shown folded at the foot of every scope note. Licence conditions: the Environment Agency (OGL)
 * line and the Copernicus line must appear wherever credits are listed (see research/national-terrain.md).
 */
export function Credits() {
  return (
    <details className="credits">
      <summary>Data and credits</summary>
      <ul>
        <li>Contains Environment Agency information © Environment Agency and/or database right 2026. Licensed under the Open Government Licence v3.0.</li>
        <li>© OpenStreetMap contributors (ODbL 1.0).</li>
        <li>
          National relief produced using Copernicus WorldDEM-90 © DLR e.V. 2010–2014 and © Airbus Defence and Space GmbH 2014–2018 provided under
          COPERNICUS by the European Union and ESA; all rights reserved. Sea floor from the GEBCO_2025 Grid, GEBCO Bathymetric Compilation Group 2025.
        </li>
        <li>Roman roads from Itiner-e (CC BY 4.0).</li>
        <li>Materials, sky and models from Poly Haven (CC0).</li>
      </ul>
    </details>
  );
}

export type ScopeKind ="national" | "overview" | "district" | "site";

/** How detailed the part you are looking at is. The text is what the tests read: keep it exact. */
export function ScopeBadge({ kind, text, note }: { kind: ScopeKind; text: string; note?: string }) {
  return (
    <div className="scope-wrap">
      <div className={"scope " + kind} data-testid="scope-badge" role="status" aria-describedby={note ? "scope-note" : undefined}>
        {text}
      </div>
      {note ? <div className="scope-note" id="scope-note">{note}</div> : null}
    </div>
  );
}

export function ToolButton({ icon, label, onClick, testId, className = "", hideLabel = false }: {
  icon: IconName; label: string; onClick: () => void; testId?: string; className?: string; hideLabel?: boolean;
}) {
  return (
    <button className={"tbtn " + className} onClick={onClick} data-testid={testId} aria-label={hideLabel ? label : undefined} title={hideLabel ? label : undefined}>
      <Icon name={icon} size={17} />
      {hideLabel ? null : <span>{label}</span>}
    </button>
  );
}

/** An on/off layer switch. */
export function Toggle({ icon, label, on, onChange, testId }: { icon: IconName; label: string; on: boolean; onChange: (v: boolean) => void; testId?: string }) {
  return (
    <button className={"chip" + (on ? " on" : "")} aria-pressed={on} onClick={() => onChange(!on)} data-testid={testId}>
      <Icon name={icon} size={16} />
      <span>{label}</span>
    </button>
  );
}

export function Field({ label, children, className = "" }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={"field " + className}>
      <span className="field-l">{label}</span>
      {children}
    </label>
  );
}

/** A centred notice under the top bar (stand-in data, unknown site link). */
export function Notice({ children, tone = "info", onDismiss, testId, title }: { children: ReactNode; tone?: "info" | "warn"; onDismiss?: () => void; testId?: string; title?: string }) {
  return (
    <div className={"notice " + tone} data-testid={testId} role="status" title={title}>
      <span>{children}</span>
      {onDismiss ? (
        <button onClick={onDismiss} aria-label="Dismiss">
          <Icon name="close" size={14} />
        </button>
      ) : null}
    </div>
  );
}

/** Brief reminder after H hides the interface (not shown for ?ui=0). */
export function HiddenToast({ show }: { show: boolean }) {
  const [vis, setVis] = useState(false);
  useEffect(() => {
    if (!show) return setVis(false);
    setVis(true);
    const id = window.setTimeout(() => setVis(false), 2600);
    return () => window.clearTimeout(id);
  }, [show]);
  return vis ? <div className="toast" role="status">Interface hidden. Press H to bring it back.</div> : null;
}

/** Full-screen error, in the interface's voice: what happened and what to do. */
export function Fatal({ title, message, testId, action }: { title: string; message: string; testId?: string; action?: ReactNode }) {
  return (
    <div className="fatal" data-testid={testId} role="alert">
      <div className="fatal-card">
        <h1>{title}</h1>
        <p className="fatal-msg">{message}</p>
        <p className="muted">Reload the page to try again. If it keeps happening, the detail above says which file or step failed.</p>
        {action}
      </div>
    </div>
  );
}

/**
 * The loading veil. Stays mounted so it can fade: opaque while a view is being built, then fades and is removed
 * from layout so it never intercepts clicks or covers the scene.
 */
export function Veil({ visible, title, year, line }: { visible: boolean; title: string; year?: string; line?: string }) {
  const [gone, setGone] = useState(!visible);
  useEffect(() => {
    if (visible) return setGone(false);
    const id = window.setTimeout(() => setGone(true), 450);
    return () => window.clearTimeout(id);
  }, [visible]);
  if (gone) return null;
  return (
    <div className={"veil" + (visible ? " on loading" : "")} role="status" aria-live="polite" aria-busy={visible}>
      <div className="veil-card">
        <p className="veil-title">{title}</p>
        {year ? <p className="veil-year">{year}</p> : null}
        <div className="veil-bar" aria-hidden="true"><i /></div>
        {line ? <p className="veil-line">{line}</p> : null}
      </div>
    </div>
  );
}
