import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { analyseSky, lightingSky } from "@/scene/look/sky";
import { REF_EH, computeRig } from "@/scene/look/rig";
import { LOOKS, parseLook, skyUrl } from "@/scene/look/presets";

/** A synthetic equirect sky: uniform blue-white dome, a sun disc at a given elevation, grey ground. */
function sky(w: number, h: number, sunElDeg: number, sunRad = 50000): Float32Array {
  const d = new Float32Array(w * h * 4);
  const sy = Math.round((0.5 - sunElDeg / 180) * h - 0.5), sx = Math.round(w * 0.25);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const up = y < h / 2;
      d[i] = up ? 0.3 : 0.1; d[i + 1] = up ? 0.4 : 0.1; d[i + 2] = up ? 0.7 : 0.1; d[i + 3] = 1;
      if (Math.abs(x - sx) <= 1 && Math.abs(y - sy) <= 1) { d[i] = sunRad; d[i + 1] = sunRad * 0.95; d[i + 2] = sunRad * 0.85; }
    }
  return d;
}

describe("look: sky measurement and light units", () => {
  it("finds the sun, its elevation and a sun-to-sky ratio from the photograph", () => {
    const w = 512, h = 256;
    const info = analyseSky(sky(w, h, 40), w, h);
    expect(info.hasSun).toBe(true);
    expect(Math.abs((info.sunEl * 180) / Math.PI - 40)).toBeLessThan(1.5);
    expect(info.sunIrr.r).toBeGreaterThan(info.skyIrr.r);
    // the sun disc is removed from the lighting copy and the ground is replaced by bounce light
    const light = lightingSky(sky(w, h, 40), info, new THREE.Color(0.1, 0.1, 0.1), Math.sin(info.sunEl));
    let max = 0;
    for (let i = 0; i < w * (h / 2); i++) max = Math.max(max, light[i * 4]);
    expect(max).toBeLessThan(5);
  });

  it("an overcast sky (no disc) is recognised as having no sun", () => {
    const w = 256, h = 128;
    const info = analyseSky(sky(w, h, 40, 0.5), w, h);
    expect(info.hasSun).toBe(false);
  });

  it("normalises level-ground irradiance and meters a 12.5% card to 0.18", () => {
    const w = 512, h = 256;
    const info = analyseSky(sky(w, h, 30), w, h);
    const dir = new THREE.Vector3(0, Math.sin(info.sunEl), Math.cos(info.sunEl));
    const rig = computeRig(info, dir, 0);
    const lum = (c: THREE.Color) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
    const eh = lum(rig.sunIrr) * dir.y + lum(rig.skyIrr);
    expect(eh).toBeCloseTo(REF_EH, 3);
    expect(((0.125 * eh) / Math.PI) * rig.exposure).toBeCloseTo(0.18, 3);
    expect(computeRig(info, dir, 1).exposure / rig.exposure).toBeCloseTo(2, 5);
  });

  it("presets parse from the URL and point at skies listed in data/assets.json", () => {
    expect(parseLook("golden")).toBe("golden");
    expect(parseLook("nonsense")).toBeNull();
    for (const p of Object.values(LOOKS)) expect(skyUrl(p.sky)).toMatch(/^\/assets\/sky\/[a-z0-9_]+_2k\.hdr$/);
  });
});
