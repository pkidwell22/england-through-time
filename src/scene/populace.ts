/**
 * ILLUSTRATIVE LAYER, NOT EVIDENCE. Everything this module adds (the figures in the streets, in small
 * groups and seated at doorways, in six generic body types, the animals (cattle, sheep, horses, pack-horses,
 * pigs, dogs, hens) and two-wheeled carts, the house smoke, the moving boats and their wakes) is atmosphere. The figures
 * are period-neutral silhouettes (a tunic or a gown, no faces, no costume claim). Their numbers
 * follow the dated activity of the settlement zones and the dated river-traffic entries; where they
 * walk follows the generic street lattice, the dated roads, the bridge roadway, the quays, wharves
 * and the forum plaza. No individual, crowd size, route, animal, vehicle or hearth here is
 * attested, and none is drawn on a battlefield stand-in.
 */
import * as THREE from "three";
import { registerExtra, type ExtraContext } from "./extras";
import { BoatLayer } from "./pop/boats";
import {
  ANIMAL_KINDS, ANIMAL_PARAM_BY_KIND, BODY_COUNT, CART_PARAMS, MotionMesh, PERSON_PARAMS, SEATED_PARAMS, animalGeometry, cartGeometry, motionUniforms, personGeometry, seatedGeometry,
} from "./pop/motion";
import { SmokeLayer } from "./pop/smoke";
import { shared } from "./pop/shared";
import { PopWorld, type Caps } from "./pop/world";

const CAPS: Record<string, Caps & { boats: number; wakes: boolean; smokeOn: boolean; dpr: number }> = {
  low: { people: 450, animals: 60, carts: 8, smoke: 0, radius: 170, density: 0.35, tilesPerStep: 1, boats: 0.5, wakes: false, smokeOn: false, dpr: 1 },
  medium: { people: 1200, animals: 150, carts: 24, smoke: 1000, radius: 240, density: 0.75, tilesPerStep: 2, boats: 0.8, wakes: true, smokeOn: true, dpr: 1.5 },
  high: { people: 2200, animals: 260, carts: 40, smoke: 2000, radius: 300, density: 1, tilesPerStep: 2, boats: 1, wakes: true, smokeOn: true, dpr: 2 },
};

function factory(ctx: ExtraContext) {
  shared.world = null;
  // debug switch for before/after comparisons: ?pop=0 (people, animals, carts, smoke, boats all off)
  if (typeof location !== "undefined" && /[?&]pop=0/.test(location.search)) return null;
  const caps = CAPS[ctx.quality] ?? CAPS.medium;
  const group = new THREE.Group();
  group.name = "populace";
  const PSHARE = [0.3, 0.26, 0.12, 0.12, 0.1, 0.1];
  const ASHARE = [0.16, 0.26, 0.1, 0.12, 0.1, 0.16, 0.1];
  const people = Array.from({ length: BODY_COUNT }, (_, k) => new MotionMesh(personGeometry(k), Math.ceil(caps.people * PSHARE[k] * 1.4), PERSON_PARAMS, "people" + k));
  const seated = new MotionMesh(seatedGeometry(), Math.max(8, Math.ceil(caps.people * 0.04)), SEATED_PARAMS, "seated");
  const ani = ANIMAL_KINDS.map((k, i) => new MotionMesh(animalGeometry(k), Math.max(6, Math.ceil(caps.animals * ASHARE[i] * 1.3)), ANIMAL_PARAM_BY_KIND[k], "ani-" + k));
  const cart = new MotionMesh(cartGeometry(), caps.carts, CART_PARAMS, "cart");
  const smoke = caps.smokeOn ? new SmokeLayer(caps.smoke) : null;
  const all = [...people, seated, ...ani, cart];
  const meshes = { people, seated, ani, cart };
  for (const m of all) group.add(m.mesh);
  if (smoke) group.add(smoke.points);
  const density = ctx.quality === "low" ? 0.6 : 1;
  const world = new PopWorld(ctx, caps, density);
  shared.world = world;
  const boats = new BoatLayer(ctx.ds, ctx.terrain, caps.boats, caps.wakes);
  group.add(boats.group);
  const dpr = Math.min(typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1, caps.dpr);
  (group.userData as Record<string, unknown>).populace = world;
  return {
    object: group,
    update(t: number, timeSec: number, camera: THREE.Camera) {
      motionUniforms.uTime.value = timeSec;
      world.update(t, timeSec, camera, meshes, smoke);
      smoke?.update(timeSec, (typeof window !== "undefined" ? window.innerHeight : 900) * dpr);
      boats.update(t, timeSec);
    },
    dispose() {
      for (const m of all) m.dispose();
      boats.dispose();
      shared.world = null;
      smoke?.points.geometry.dispose();
    },
  };
}

/** People, animals, carts, chimney smoke and moving river craft. Registers extras (see extras.ts). Called once by the engine. */
export function registerPopulace(): void {
  registerExtra(factory);
}
