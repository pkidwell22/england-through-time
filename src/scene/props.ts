import { registerExtra } from "./extras";
import { buildClutter } from "./props/clutter";

/**
 * Scanned street furniture and yard clutter near the camera (see props/clutter.ts), drawn from the CC0
 * model library. ILLUSTRATIVE: sparse, generated positions, only items plausible for the year. Switch off
 * with ?props=0. Registers an extra (see extras.ts). Called once by the engine.
 */
export function registerProps(): void {
  registerExtra((ctx) => buildClutter(ctx));
}
