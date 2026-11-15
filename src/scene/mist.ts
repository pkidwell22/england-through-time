/**
 * Height-dependent ground mist, applied after the aerial perspective for every fogged material.
 *
 * The mist is a layer of constant density below a base height that thins exponentially above it,
 * integrated exactly along each view ray. Seen from inside it, shapes fade within a few hundred
 * metres; seen steeply from high above, the short path through the layer leaves the ground readable,
 * while long, grazing paths (the far distance, low valleys) fill in.
 *
 * The parameters live in two shared arrays referenced (not copied) by every material's uniforms,
 * so one write updates the whole scene. With density 0 the term is skipped. The shader code itself is
 * installed with the rest of the atmosphere by ./look/atmosphere.ts (`installLookShaders`).
 */

/** [density at and below the base (per metre), base height (world y), scale height (m), strength 0..1]. */
export const MIST_PARAMS = new Float32Array(4);
/** Linear RGB of the mist (scene units: the light it scatters towards the camera). */
export const MIST_COLOR = new Float32Array([0.8, 0.8, 0.8]);
