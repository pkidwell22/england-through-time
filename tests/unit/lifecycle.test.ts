import { describe, expect, it } from "vitest";
import { END_SPAN, RUIN_HEIGHT, phaseStatus, sampleKeyframes } from "@/lib/lifecycle";
import type { Phase } from "@/lib/types";

const model = { kind: "hall" };
const ph = (p: Partial<Phase>): Phase => ({ label: "x", from: 100, to: null, model, ...p });

describe("phaseStatus", () => {
  it("absent before from", () => {
    const p = ph({ from: 100, built: 110, to: 200 });
    expect(phaseStatus(p, 99.999).state).toBe("absent");
    expect(phaseStatus(p, 99.999).height).toBe(0);
    expect(phaseStatus(p, -4000).state).toBe("absent");
  });
  it("construction between from and built, rising monotonically", () => {
    const p = ph({ from: 100, built: 110, to: 200 });
    let prev = 0;
    for (let t = 100; t < 111; t += 0.5) {
      const s = phaseStatus(p, t);
      expect(s.state).toBe("construction");
      expect(s.height).toBeGreaterThan(prev);
      expect(s.height).toBeLessThan(1);
      prev = s.height;
    }
    expect(phaseStatus(p, 111).state).toBe("intact");
    expect(phaseStatus(p, 111).height).toBe(1);
  });
  it("built defaults to from (one construction year)", () => {
    const p = ph({ from: 100 });
    expect(phaseStatus(p, 100.5).state).toBe("construction");
    expect(phaseStatus(p, 101).state).toBe("intact");
  });
  it("intact until to", () => {
    const p = ph({ from: 100, built: 110, to: 200, end: "demolished" });
    expect(phaseStatus(p, 150).state).toBe("intact");
    expect(phaseStatus(p, 199.999).state).toBe("intact");
    expect(phaseStatus(p, 200).state).not.toBe("intact");
  });
  it("handover is instant", () => {
    const p = ph({ to: 200, end: "handover" });
    expect(phaseStatus(p, 199.999).state).toBe("intact");
    expect(phaseStatus(p, 200)).toMatchObject({ state: "gone", height: 0 });
  });
  it.each([["replaced", END_SPAN.replaced], ["demolished", END_SPAN.demolished]] as const)("%s shrinks then gone", (end, span) => {
    const p = ph({ to: 200, end });
    const a = phaseStatus(p, 200 + span * 0.25), b = phaseStatus(p, 200 + span * 0.75);
    expect(a.state).toBe("teardown");
    expect(b.state).toBe("teardown");
    expect(a.height).toBeGreaterThan(b.height);
    expect(b.height).toBeGreaterThan(0);
    expect(phaseStatus(p, 200 + span)).toMatchObject({ state: "gone", height: 0 });
  });
  it("default end is replaced", () => {
    const p = ph({ to: 200 });
    expect(phaseStatus(p, 200 + END_SPAN.replaced / 2).state).toBe("teardown");
    expect(phaseStatus(p, 200 + END_SPAN.replaced).state).toBe("gone");
  });
  it("burned: burning with fire, then short-lived ruin, then gone", () => {
    const p = ph({ to: 200, end: "burned" });
    const s = phaseStatus(p, 200.5);
    expect(s.state).toBe("burning");
    expect(s.fire).toBeGreaterThan(0);
    expect(s.height).toBeLessThan(1);
    const r = phaseStatus(p, 200 + END_SPAN.burned + 1);
    expect(r.state).toBe("ruin");
    expect(r.fire).toBe(0);
    expect(r.height).toBeLessThanOrEqual(0.25);
    expect(phaseStatus(p, 200 + END_SPAN.burned + 8).state).toBe("gone");
  });
  it("ruin lingers until goneBy", () => {
    const p = ph({ to: 200, end: "ruin", goneBy: 500 });
    const s = phaseStatus(p, 300);
    expect(s.state).toBe("ruin");
    expect(s.height).toBeCloseTo(RUIN_HEIGHT, 5);
    expect(phaseStatus(p, 499).state).toBe("ruin");
    expect(phaseStatus(p, 499).height).toBeGreaterThan(0);
    expect(phaseStatus(p, 500)).toMatchObject({ state: "gone", height: 0 });
  });
  it("ruin without goneBy persists", () => {
    const p = ph({ to: 200, end: "ruin" });
    expect(phaseStatus(p, 1625)).toMatchObject({ state: "ruin" });
    expect(phaseStatus(p, 1625).height).toBeCloseTo(RUIN_HEIGHT, 5);
  });
  it("decay declines over the whole span", () => {
    const p = ph({ to: 200, end: "decay", goneBy: 400 });
    let prev = 1.0001;
    for (let t = 200; t < 400; t += 10) {
      const s = phaseStatus(p, t);
      expect(s.state).toBe("ruin");
      expect(s.height).toBeLessThan(prev);
      expect(s.height).toBeGreaterThan(0);
      prev = s.height;
    }
    expect(phaseStatus(p, 400).state).toBe("gone");
  });
  it("continues skips construction", () => {
    // Corrections 2026-11-14 (docs/CORRECTIONS.md, "Extension phases"): a continuing phase with a later
    // `built` is now an extension that rises until `built`; a plain continuing phase (no `built`) still
    // skips construction, which is what this test now checks.
    const p = ph({ from: 100, continues: true, to: 300 });
    expect(phaseStatus(p, 99.9).state).toBe("absent");
    expect(phaseStatus(p, 100)).toMatchObject({ state: "intact", height: 1 });
  });
  it("open-ended phases stay intact at 1625", () => {
    expect(phaseStatus(ph({ from: 100, built: 120, to: null }), 1625)).toMatchObject({ state: "intact", height: 1 });
    expect(phaseStatus(ph({ from: 100, to: null }), 1625.999).state).toBe("intact");
  });
  it("BCE phases use the no-year-zero mapping", () => {
    const p = ph({ from: -1, built: 1, to: 5 });
    expect(phaseStatus(p, -0.5).state).toBe("absent");
    expect(phaseStatus(p, 0).state).toBe("construction");
    expect(phaseStatus(p, 2).state).toBe("intact");
  });
  it("height and decay always in 0..1", () => {
    for (const end of ["handover", "replaced", "demolished", "burned", "ruin", "decay"] as const)
      for (const goneBy of [undefined, 260, 600])
        for (let t = 90; t < 700; t += 0.37) {
          const s = phaseStatus(ph({ from: 100, built: 105, to: 200, end, goneBy }), t);
          expect(s.height).toBeGreaterThanOrEqual(0);
          expect(s.height).toBeLessThanOrEqual(1);
          expect(s.decay).toBeGreaterThanOrEqual(0);
          expect(s.decay).toBeLessThanOrEqual(1);
          expect(s.fire).toBeGreaterThanOrEqual(0);
          expect(s.fire).toBeLessThanOrEqual(1);
        }
  });
});

describe("sampleKeyframes", () => {
  it("interpolates and clamps", () => {
    const kf = [{ year: -1, value: 0 }, { year: 2, value: 2 }];
    expect(sampleKeyframes(kf, -100)).toBe(0);
    expect(sampleKeyframes(kf, 1)).toBe(1);
    expect(sampleKeyframes(kf, 100)).toBe(2);
    expect(sampleKeyframes([], 5)).toBe(0);
  });
});
