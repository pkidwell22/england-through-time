import { describe, expect, it } from "vitest";
import { TimeScale, assertHistYear, formatHist, formatT, histToT, parseYearInput, tToHist, yearsBetween } from "@/lib/years";
import site from "@data/locations/london/site.json";

describe("no year zero", () => {
  it("rejects 0 and non-integers", () => {
    expect(() => assertHistYear(0)).toThrow();
    expect(() => histToT(0)).toThrow();
    expect(() => formatHist(0)).toThrow();
    expect(() => histToT(1.5)).toThrow();
    expect(() => histToT(NaN)).toThrow();
  });
  it("1 BCE -> 1 CE is continuous", () => {
    expect(histToT(-1)).toBe(0);
    expect(histToT(1)).toBe(1);
    expect(histToT(-2)).toBe(-1);
    expect(yearsBetween(-1, 1)).toBe(1);
    expect(yearsBetween(-4000, 1625)).toBe(5624);
  });
  it("tToHist round-trips every integer year -4000..1625 and never yields 0", () => {
    let prevT = -Infinity;
    for (let y = -4000; y <= 1625; y++) {
      if (y === 0) continue;
      const t = histToT(y);
      expect(t).toBeGreaterThan(prevT);
      if (prevT !== -Infinity) expect(t - prevT).toBe(1);
      prevT = t;
      expect(tToHist(t)).toBe(y);
      expect(tToHist(t + 0.5)).toBe(y);
      expect(tToHist(t + 0.999)).toBe(y);
    }
    for (let t = -4000; t <= 1626; t += 0.25) expect(tToHist(t)).not.toBe(0);
  });
  it("formats", () => {
    expect(formatHist(-1)).toBe("1 BCE");
    expect(formatHist(1)).toBe("1 CE");
    expect(formatHist(-4000)).toBe("4000 BCE");
    expect(formatT(0)).toBe("1 BCE");
    expect(formatT(0.999)).toBe("1 BCE");
    expect(formatT(1)).toBe("1 CE");
    expect(formatT(-0.001)).toBe("2 BCE");
    expect(formatT(1625)).toBe("1625 CE");
  });
});

describe("TimeScale", () => {
  const sc = new TimeScale(site.timeline.scale);
  it("covers the timeline", () => {
    expect(sc.tMin).toBe(histToT(site.timeline.start));
    expect(sc.tMax).toBe(histToT(site.timeline.end));
    expect(sc.tToU(sc.tMin)).toBe(0);
    expect(sc.tToU(sc.tMax)).toBe(1);
    expect(sc.uToT(0)).toBe(sc.tMin);
    expect(sc.uToT(1)).toBe(sc.tMax);
  });
  it("is strictly monotonic and invertible", () => {
    let prev = -1;
    for (let t = sc.tMin; t <= sc.tMax; t += 1) {
      const u = sc.tToU(t);
      expect(u).toBeGreaterThan(prev);
      prev = u;
      expect(Math.abs(sc.uToT(u) - t)).toBeLessThan(1e-6);
    }
    let prevT = -Infinity;
    for (let i = 0; i <= 10000; i++) {
      const t = sc.uToT(i / 10000);
      expect(t).toBeGreaterThan(prevT);
      prevT = t;
      expect(Math.abs(sc.tToU(t) - i / 10000)).toBeLessThan(1e-9);
    }
  });
  it("clamps at endpoints", () => {
    expect(sc.clamp(-99999)).toBe(sc.tMin);
    expect(sc.clamp(99999)).toBe(sc.tMax);
    expect(sc.tToU(-99999)).toBe(0);
    expect(sc.tToU(99999)).toBe(1);
    expect(sc.uToT(-1)).toBe(sc.tMin);
    expect(sc.uToT(2)).toBe(sc.tMax);
  });
  it("every year is reachable with the UI slider step (0.0001)", () => {
    // informational resolution check: largest year jump per slider step
    let worst = 0;
    for (let i = 1; i <= 10000; i++) worst = Math.max(worst, sc.uToT(i / 10000) - sc.uToT((i - 1) / 10000));
    expect(worst).toBeLessThan(10);
  });
  it("rejects bad anchors", () => {
    expect(() => new TimeScale([{ year: 1, u: 0 }])).toThrow();
    expect(() => new TimeScale([{ year: 5, u: 0 }, { year: 1, u: 1 }])).toThrow();
    expect(() => new TimeScale([{ year: 1, u: 0.5 }, { year: 5, u: 0.5 }])).toThrow();
  });
});

describe("parseYearInput", () => {
  it.each([
    ["55 BCE", -55], ["55bc", -55], ["55 B.C.", -55], ["-55", -55], ["1066", 1066], ["1066 CE", 1066], ["AD 43", 43], ["ad43", 43],
    ["43 AD", 43], ["  1 bce ", -1], ["1 CE", 1], ["4000 BCE", -4000], ["-55 BCE", -55],
  ])("%s -> %i", (s, y) => expect(parseYearInput(s)).toBe(y));
  it.each(["0", "0 CE", "0 BCE", "-0", "", "abc", "12.5.3x", "1e3", "BCE", "10 xx"])("%s -> null", (s) => expect(parseYearInput(s)).toBeNull());
});
