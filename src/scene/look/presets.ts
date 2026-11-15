import assetsJson from "@data/assets.json";

/**
 * Look presets: each is a coherent set of sky photograph, sun, exposure, atmosphere and grade.
 * The sun's height comes from the photograph (so the light agrees with the sky) unless a site fixes it.
 * Exposure is metered (see ./rig.ts) and `ev` is the photographer's compensation on top of the meter.
 */
export type LookId = "clear" | "golden" | "overcast" | "dawn";
export const LOOK_IDS: LookId[] = ["clear", "golden", "overcast", "dawn"];
export const LOOK_NAMES: Record<LookId, string> = { clear: "Clear afternoon", golden: "Golden hour", overcast: "Overcast", dawn: "Misty dawn" };

export interface LookPreset {
  id: LookId;
  /** Key into data/assets.json: "sky" (the default) or a key of "skies". */
  sky: "sky" | "golden" | "overcast" | "dawn";
  /** Sun azimuth, degrees clockwise from north (sites may override). */
  sunAzimuth: number;
  /** Exposure compensation in stops on top of the meter. */
  ev: number;
  /** Aerosol extinction at the ground, per metre, and its scale height. */
  aerosol: number;
  aerosolHeight: number;
  /** Low haze over river and valleys: density per metre at water level and scale height (m). */
  haze: number;
  hazeHeight: number;
  /** Per-channel extinction ratio (blue scattered most). */
  extinction: [number, number, number];
  /** Forward-scattering glow around the sun in the haze (multiplies the sun colour). */
  sunGlow: number;
  /** Cloud shadows: strength 0..1 (0 = off); coverage comes from the sky photograph. */
  cloudShadow: number;
  /** A whole-timeline ground mist (misty dawn), as for site mist: density, height (m). */
  mist?: { density: number; height: number; color: string };
  /** Grade: white balance (multiplies linear light), saturation, contrast pivot curve, lift/gamma/gain (display space). */
  white: [number, number, number];
  saturation: number;
  lift: [number, number, number];
  gamma: [number, number, number];
  gain: [number, number, number];
  bloom: number;
  /** AgX look: mid-tone contrast (power in log space) and saturation. */
  contrast: number;
  agxSat: number;
}

export const LOOKS: Record<LookId, LookPreset> = {
  clear: {
    id: "clear", sky: "sky", sunAzimuth: 232, ev: 0,
    aerosol: 0.00006, aerosolHeight: 1000, haze: 0.00005, hazeHeight: 140, extinction: [0.92, 0.98, 1.08], sunGlow: 0.06, cloudShadow: 0.4,
    white: [1.0, 1.0, 1.0], saturation: 0.94, lift: [0.006, 0.006, 0.01], gamma: [1.0, 1.0, 1.0], gain: [1.0, 0.995, 0.985], bloom: 0.045, contrast: 1.14, agxSat: 1.12,
  },
  golden: {
    id: "golden", sky: "golden", sunAzimuth: 252, ev: 0.15,
    aerosol: 0.00011, aerosolHeight: 900, haze: 0.0001, hazeHeight: 120, extinction: [0.85, 0.96, 1.12], sunGlow: 0.14, cloudShadow: 0.38,
    white: [1.0, 0.99, 0.97], saturation: 0.96, lift: [0.008, 0.006, 0.01], gamma: [1.0, 1.0, 1.0], gain: [1.0, 0.985, 0.95], bloom: 0.06, contrast: 1.12, agxSat: 1.1,
  },
  overcast: {
    id: "overcast", sky: "overcast", sunAzimuth: 232, ev: 0.2,
    aerosol: 0.00007, aerosolHeight: 900, haze: 0.00012, hazeHeight: 150, extinction: [1.0, 1.0, 1.02], sunGlow: 0.0, cloudShadow: 0,
    white: [0.99, 1.0, 1.02], saturation: 0.9, lift: [0.012, 0.012, 0.014], gamma: [1.0, 1.0, 1.0], gain: [0.99, 0.995, 1.0], bloom: 0.03, contrast: 1.1, agxSat: 1.05,
  },
  dawn: {
    id: "dawn", sky: "dawn", sunAzimuth: 95, ev: 0.35,
    aerosol: 0.00007, aerosolHeight: 600, haze: 0.0004, hazeHeight: 45, extinction: [0.88, 0.97, 1.1], sunGlow: 0.25, cloudShadow: 0,
    mist: { density: 0.009, height: 24, color: "#e9e4dc" },
    white: [0.98, 0.99, 1.02], saturation: 0.9, lift: [0.014, 0.014, 0.018], gamma: [1.0, 1.0, 1.0], gain: [1.0, 0.98, 0.96], bloom: 0.07, contrast: 1.06, agxSat: 1.0,
  },
};

const ASSETS = assetsJson as unknown as { sky: { asset: string }; skies?: Record<string, string> };
export function skyUrl(key: LookPreset["sky"]): string {
  const asset = key === "sky" ? ASSETS.sky.asset : ASSETS.skies?.[key] ?? ASSETS.sky.asset;
  return `/assets/sky/${asset}_2k.hdr`;
}

export function parseLook(v: string | null | undefined): LookId | null {
  return v && (LOOK_IDS as string[]).includes(v) ? (v as LookId) : null;
}
