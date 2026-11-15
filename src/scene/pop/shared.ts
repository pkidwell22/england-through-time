import type { PopWorld } from "./world";

/** The populace world, shared with the street-clutter layer so that both read the same street and house placement. */
export const shared: { world: PopWorld | null } = { world: null };
