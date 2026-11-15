import { registerEarthworkBuilders } from "./earthworks";
import { registerMegalithBuilders } from "./megaliths";

/**
 * Prehistoric model kinds (first used by the Stonehenge site). Everything lives in
 * new files so the shared builders stay untouched:
 *   megaliths.ts   `megaliths` (data-driven stone settings), `sightline`
 *   earthworks.ts  `henge`, `pit-ring`, `timber-circle`, `palisade`, `banked-avenue`, `barrow`,
 *                  `barrow-group`, `long-barrow`, `rampart`, `turf`; fabric style `neolithic-house`
 * See docs/STONEHENGE.md and docs/MODEL-KINDS.md for the parameters.
 */
let done = false;
export function registerPrehistoricBuilders(): void {
  if (done) return;
  done = true;
  registerMegalithBuilders();
  registerEarthworkBuilders();
}
