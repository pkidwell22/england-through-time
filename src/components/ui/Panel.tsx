"use client";

/**
 * The info panel, set like a page: a fixed head (badges, kicker, name) and a body that scrolls on its own.
 * On wide screens it is docked on the right between the top bar and the timeline; on narrow screens it is a
 * bottom sheet that opens for a selection and folds down to its head otherwise.
 */
import { type ReactNode, useEffect, useState } from "react";
import type { Source } from "@/lib/types";
import { Icon } from "./icons";

export function InfoPanel({ head, children, onClose, selKey }: { head: ReactNode; children: ReactNode; onClose?: () => void; selKey: string | null }) {
  const [open, setOpen] = useState(false);
  // Only matters on narrow screens, where the sheet would cover the subject the camera has just centred: a selection
  // shows the head (badges, name and any way into a site) and the body unfolds when the head is tapped. Once unfolded,
  // it stays unfolded for the next selection; clearing the selection folds it.
  useEffect(() => {
    if (selKey == null) setOpen(false);
  }, [selKey]);
  return (
    <aside className="panel" data-testid="info-panel" data-open={open ? "true" : "false"} aria-label={selKey ? "Details of the selection" : "About this period"}>
      <div className="panel-head">
        <button className="sheet-toggle" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-label={open ? "Fold the details away" : "Show the details"}>
          <Icon name="chevronUp" size={18} />
        </button>
        {onClose ? (
          <button className="close" onClick={onClose} aria-label="Close details" title="Close (Esc)">
            <Icon name="close" size={18} />
          </button>
        ) : null}
        <div className="swap" key={selKey ?? "-"}>{head}</div>
      </div>
      <div className="panel-scroll swap" key={selKey ?? "-"} tabIndex={0} role="region" aria-label="Details">
        {children}
      </div>
    </aside>
  );
}

/** What is not known, given its own block rather than a footnote. */
export function NotKnown({ title = "Not known", children }: { title?: string; children: ReactNode }) {
  return (
    <div className="uncertain">
      <span className="uncertain-h">{title}</span>
      <p>{children}</p>
    </div>
  );
}

/** One row of a chronology list. Must live in an <ol className="phases">. */
export function PhaseItem({ on, years, label, state, note, onJump, testId }: {
  on: boolean; years: string; label: string; state?: string | null; note?: string; onJump: () => void; testId?: string;
}) {
  return (
    <li className={on ? "on" : ""}>
      <button onClick={onJump} title="Go to this phase" data-testid={testId}>
        <span className="yrs">{years}</span>
        <span className="pl">{label}</span>
        {state ? <span className="state">{state}</span> : null}
        {note ? <span className="note">{note}</span> : null}
      </button>
    </li>
  );
}

/** Sources as numbered citations; titles open in a new tab. */
export function SourceList({ sources }: { sources: Source[] }) {
  if (!sources.length) return <p className="muted no-source">No source recorded yet for this entry.</p>;
  return (
    <ol className="sources">
      {sources.map((s, i) => (
        <li key={s.url + i}>
          <a href={s.url} target="_blank" rel="noreferrer">
            <cite>{s.title}</cite>
            <Icon name="external" size={13} />
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
          {s.publisher ? <span className="pub">{s.publisher}</span> : null}
        </li>
      ))}
    </ol>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="psec">
      <h3>{title}</h3>
      {children}
    </section>
  );
}
