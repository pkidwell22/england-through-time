/**
 * Evidence honesty, drawn the same way everywhere: three classes, each with a fixed colour (the engines'
 * tint colours) and a fixed shape, so the class reads without colour too.
 *   attested       solid square
 *   reconstruction half-filled square
 *   conjecture     dashed outline
 */
import type { Confidence, Evidence } from "@/lib/types";

export type EvClass = "a" | "r" | "c";

export const EVIDENCE_LABEL: Record<Evidence, string> = {
  "attested-standing": "Evidence: standing fabric",
  "attested-excavated": "Evidence: excavated",
  "attested-documentary": "Evidence: documents",
  "attested-pictorial": "Evidence: period views",
  reconstructed: "Reconstruction",
  conjectural: "Conjecture",
};

export const evClass = (e: Evidence): EvClass => (typeof e === "string" && e.startsWith("attested") ? "a" : e === "reconstructed" ? "r" : "c");

export const EV_CLASS_TEXT: Record<EvClass, { name: string; gloss: string }> = {
  a: { name: "Attested", gloss: "standing, excavated, documented or drawn at the time" },
  r: { name: "Reconstruction", gloss: "the thing existed; its form is rebuilt from partial evidence" },
  c: { name: "Conjecture", gloss: "a plausible stand-in or placeholder, not individually evidenced" },
};

/** The coloured, shaped marker for one evidence class. */
export function EvSwatch({ cls }: { cls: EvClass }) {
  return <i className={"sw sw-" + cls} aria-hidden="true" />;
}

/** The three-class key: used by the evidence legend, the national key and the scope notes. */
export function EvidenceKey({ compact = false }: { compact?: boolean }) {
  return (
    <ul className={"ev-key" + (compact ? " compact" : "")}>
      {(["a", "r", "c"] as EvClass[]).map((k) => (
        <li key={k}>
          <EvSwatch cls={k} />
          <span>
            <b>{EV_CLASS_TEXT[k].name}</b>
            {compact ? null : <span className="gloss"> {EV_CLASS_TEXT[k].gloss}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * The badge row at the head of every info panel. The evidence badge comes first and its text is exactly the
 * label (the swatch is drawn by CSS), the confidence badge reads "Confidence: <level>" with pips drawn by CSS.
 */
export function EvidenceBadges({ evidence, evidenceText, confidence, tags = [], testIds = false }: {
  evidence: Evidence; evidenceText?: string; confidence: Confidence | string; tags?: { text: string; tone?: "c" | "plain" | "district" }[]; testIds?: boolean;
}) {
  const cls = evClass(evidence);
  return (
    <div className="badges">
      <span className={"badge ev ev-" + cls} data-testid={testIds ? "evidence-badge" : undefined}>
        {evidenceText ?? EVIDENCE_LABEL[evidence] ?? "Evidence not classified"}
      </span>
      <span className="badge conf" data-level={confidence} data-testid={testIds ? "confidence-badge" : undefined}>
        Confidence: {confidence}
      </span>
      {tags.map((t) => (
        <span key={t.text} className={"badge tag" + (t.tone ? " tag-" + t.tone : "")}>{t.text}</span>
      ))}
    </div>
  );
}
