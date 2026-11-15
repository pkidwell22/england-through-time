import * as THREE from "three";
import { LOOK_A, cloudThreshold } from "./atmosphere";
import type { LookPreset } from "./presets";
import type { SkyInfo } from "./sky";

/**
 * Light units and exposure.
 *
 * The photographed sky fixes every ratio: sun to sky, sun colour, horizon colour. One scale factor `k` takes
 * the photograph's units to scene units, chosen so the total irradiance on open, level ground is always
 * REF_EH. The camera is then metered like a photographer's reflected-light meter: an 18% grey card lying on
 * that ground maps to scene-linear 0.18 before tone mapping, plus the preset's compensation in stops.
 * So a clear afternoon and an overcast morning are both exposed "correctly" (as a camera would), and
 * hand-tuned self-lit effects (fire, smoke) stay in a consistent range whichever sky is up.
 */
export const REF_EH = 4.0;

export interface Rig {
  /** Towards the sun, world space. */
  sunDir: THREE.Vector3;
  /** Directional light colour (unit luminance) and intensity (= irradiance facing the sun, scene units). */
  sunColor: THREE.Color;
  sunIntensity: number;
  /** Scene units: sun irradiance facing the sun (rgb), sky irradiance on level ground (rgb). */
  sunIrr: THREE.Color;
  skyIrr: THREE.Color;
  /** Scale applied to the photograph (environment and background intensity). */
  k: number;
  exposure: number;
  hasSun: boolean;
  cloudCover: number;
  horizonAway: THREE.Color;
  horizonToward: THREE.Color;
}

const lum = (c: THREE.Color) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;

export function computeRig(info: SkyInfo, sunDir: THREE.Vector3, evComp: number): Rig {
  const mu = Math.max(0.02, sunDir.y);
  const eSun = info.hasSun ? lum(info.sunIrr) : 0;
  const eh = eSun * mu + lum(info.skyIrr);
  const k = REF_EH / Math.max(1e-4, eh);
  const sunColor = info.hasSun && eSun > 0 ? info.sunIrr.clone().multiplyScalar(1 / eSun) : new THREE.Color(1, 1, 1);
  // metering: a reflected-light meter (calibration K = 12.5) reads level ground of about 12.5% reflectance as
  // middle grey, i.e. maps its radiance 0.125 * E / pi to scene-linear 0.18
  const exposure = (0.18 / ((0.125 * REF_EH) / Math.PI)) * Math.pow(2, evComp);
  return {
    sunDir: sunDir.clone(), sunColor, sunIntensity: eSun * k,
    sunIrr: info.sunIrr.clone().multiplyScalar(info.hasSun ? k : 0), skyIrr: info.skyIrr.clone().multiplyScalar(k), k, exposure,
    hasSun: info.hasSun, cloudCover: info.cloudCover,
    horizonAway: info.horizonAway.clone().multiplyScalar(k), horizonToward: info.horizonToward.clone().multiplyScalar(k),
  };
}

/** A rig for the analytic (fallback) sky, before or without a photograph. */
export function analyticRig(sunDir: THREE.Vector3, fog: THREE.Color, evComp: number): Rig {
  const mu = Math.max(0.05, sunDir.y);
  const sunIntensity = 4.6;
  const sky = new THREE.Color(0.75, 0.85, 1.1).multiplyScalar(Math.max(0.3, REF_EH - sunIntensity * mu) / 0.84);
  return {
    sunDir: sunDir.clone(), sunColor: new THREE.Color(1, 0.94, 0.85), sunIntensity, sunIrr: new THREE.Color(1, 0.94, 0.85).multiplyScalar(sunIntensity),
    skyIrr: sky, k: 1, exposure: (0.18 * Math.PI) / (0.125 * REF_EH) * Math.pow(2, evComp), hasSun: true, cloudCover: 0,
    horizonAway: fog.clone().multiplyScalar(1.6), horizonToward: fog.clone().multiplyScalar(1.9),
  };
}

export interface AtmoOpts {
  preset: LookPreset;
  /** Multiplies the preset's aerosol density (a site's own `fog` relative to the default). */
  aerosolScale: number;
  /** Water level for the river haze base (river sites: 0), or the median ground height. */
  hazeBase: number;
  cloudShadows: boolean;
  timeSec: number;
}

/** Write the shared atmosphere uniforms (see ./atmosphere.ts for the layout). */
export function writeAtmosphere(r: Rig, o: AtmoOpts): void {
  const p = o.preset;
  const A = LOOK_A;
  A.set([r.sunDir.x, r.sunDir.y, r.sunDir.z, 0], 0);
  A.set([p.aerosol * o.aerosolScale, o.hazeBase, p.aerosolHeight, 1], 4);
  // looking down, haze tends to the mean sky radiance (bluer than the horizon band): kept in 2.w, 3.w, 5.w
  const down = r.skyIrr.clone().multiplyScalar(0.95 / Math.PI);
  A.set([p.haze, o.hazeBase, p.hazeHeight, down.r], 8);
  // the in-scatter tends to the horizon of the photograph; a little brighter than the raw band, which is
  // partly the darker ground-haze line in most sky photographs
  // away from the sun: the photograph's horizon band is often its darkest part (a ground-haze line, or the
  // seam of the replaced ground); the haze asymptote is taken halfway to the mean sky radiance
  const away = r.horizonAway.clone().lerp(r.skyIrr.clone().multiplyScalar(1.1 / Math.PI), 0.35);
  A.set([away.r, away.g, away.b, down.g], 12);
  A.set([r.horizonToward.r, r.horizonToward.g, r.horizonToward.b, 3.0], 16);
  A.set([p.extinction[0], p.extinction[1], p.extinction[2], down.b], 20);
  const glow = r.hasSun ? p.sunGlow : 0;
  A.set([r.sunIrr.r * glow, r.sunIrr.g * glow, r.sunIrr.b * glow, 0.72], 24);
  const cover = THREE.MathUtils.clamp(r.cloudCover * 1.4, 0.12, 0.6);
  const on = o.cloudShadows && r.hasSun && p.cloudShadow > 0 ? 1 : 0;
  A.set([1 / 4500, cloudThreshold(cover), 0.11, p.cloudShadow], 28);
  A.set([A[32], A[33], 1500, on], 32);
  // light on unlit effects (smoke, foam): a grey diffuser under this sky, relative to the old fixed level
  const lit = r.skyIrr.clone().add(r.sunIrr.clone().multiplyScalar(0.45 * Math.max(0.1, r.sunDir.y + 0.3))).multiplyScalar(1 / (REF_EH * 0.85));
  A.set([lit.r, lit.g, lit.b, A[39]], 36);
}

/** Drift the cloud shadows with the wind (from the south-west, as the smoke in ./fx.ts). */
export function driftClouds(dt: number): void {
  const speed = 7; // m/s at the cloud deck, roughly
  LOOK_A[32] = (LOOK_A[32] - 0.88 * speed * dt) % 60000;
  LOOK_A[33] = (LOOK_A[33] + 0.48 * speed * dt) % 60000;
}
