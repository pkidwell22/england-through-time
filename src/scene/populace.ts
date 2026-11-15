/**
 * ILLUSTRATIVE LAYER, NOT EVIDENCE. Everything this module adds (the figures in the streets, in small
 * groups and seated at doorways, in six generic body types, the animals (cattle, sheep, horses, pack-horses,
 * pigs, dogs, hens) and two-wheeled carts, the house smoke, the moving boats and their wakes) is atmosphere. The people
 * are MakeHuman-based figures in generic period dress (pop/figures.ts, docs/FIGURES.md; the earlier period-neutral
 * block figures remain behind ?figures=blocks and whenever the figure files fail to load). Their numbers
 * follow the dated activity of the settlement zones and the dated river-traffic entries; where they
 * walk follows the generic street lattice, the dated roads, the bridge roadway, the quays, wharves
 * and the forum plaza. No individual, crowd size, route, animal, vehicle or hearth here is
 * attested, and none is drawn on a battlefield stand-in.
 */
import * as THREE from "three";
import { registerExtra, type ExtraContext } from "./extras";
import { BoatLayer } from "./pop/boats";
import {
  ANIMAL_KINDS, ANIMAL_PARAM_BY_KIND, BODY_COUNT, CART_PARAMS, MotionMesh, PERSON_PARAMS, SEATED_PARAMS, animalGeometry, cartGeometry, motionUniforms, personGeometry, seatedGeometry, stoolGeometry,
} from "./pop/motion";
import { CLOTH_LIN, FigureLayer } from "./pop/figures";
import { SmokeLayer } from "./pop/smoke";
import { shared } from "./pop/shared";
import { CLOTH, PopWorld, type Caps, type Meshes } from "./pop/world";

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
  const peopleCaps = Array.from({ length: BODY_COUNT }, (_, k) => Math.ceil(caps.people * PSHARE[k] * 1.4));
  const seatedCap = Math.max(8, Math.ceil(caps.people * 0.04));
  const people = Array.from({ length: BODY_COUNT }, (_, k) => new MotionMesh(personGeometry(k), peopleCaps[k], PERSON_PARAMS, "people" + k));
  const seated = new MotionMesh(seatedGeometry(), seatedCap, SEATED_PARAMS, "seated");
  const ani = ANIMAL_KINDS.map((k, i) => new MotionMesh(animalGeometry(k), Math.max(6, Math.ceil(caps.animals * ASHARE[i] * 1.3)), ANIMAL_PARAM_BY_KIND[k], "ani-" + k));
  const cart = new MotionMesh(cartGeometry(), caps.carts, CART_PARAMS, "cart");
  const smoke = caps.smokeOn ? new SmokeLayer(caps.smoke) : null;
  const all = [...people, seated, ...ani, cart];
  const meshes = { people, seated, ani, cart };
  for (const m of all) group.add(m.mesh);
  // Period-dressed MakeHuman figures (pop/figures.ts) replace the block people once their assets have loaded;
  // ?figures=blocks keeps the blocks (A/B), and so does any loading failure.
  const blocksOnly = typeof location !== "undefined" && /[?&]figures=blocks/.test(location.search);
  if (!CLOTH_LIN.length) for (const c of CLOTH) CLOTH_LIN.push([c.r, c.g, c.b]);
  const stool = blocksOnly ? null : new MotionMesh(stoolGeometry(), seatedCap, SEATED_PARAMS, "stools");
  if (stool) group.add(stool.mesh);
  const figures = blocksOnly ? null : new FigureLayer({ people: peopleCaps, seated: seatedCap, quality: ctx.quality }, ctx.landmarks, stool);
  if (figures) group.add(figures.object);
  const figMeshes: Meshes | null = figures ? { people: figures.pools, seated: figures.seatedPool, ani, cart } : null;
  let usingFigures = false;
  if (smoke) group.add(smoke.points);
  const density = ctx.quality === "low" ? 0.6 : 1;
  const world = new PopWorld(ctx, caps, density);
  shared.world = world;
  const boats = new BoatLayer(ctx.ds, ctx.terrain, caps.boats, caps.wakes);
  group.add(boats.group);
  const dpr = Math.min(typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1, caps.dpr);
  (group.userData as Record<string, unknown>).populace = world;
  (group.userData as Record<string, unknown>).figures = figures;
  return {
    object: group,
    update(t: number, timeSec: number, camera: THREE.Camera) {
      motionUniforms.uTime.value = timeSec;
      const fig = !!figures && !figures.unavailable && figures.ready(t);
      if (fig !== usingFigures) {
        usingFigures = fig;
        world.invalidate();
        if (figures) figures.dirty = true;
        // clear whichever set of people is no longer drawn
        for (const m of fig ? [...people, seated] : []) { m.reset(); m.commit(); }
        if (!fig && stool) { stool.reset(); stool.commit(); }
      }
      if (figures?.unavailable) figures.restoreBlocks();
      world.update(t, timeSec, camera, fig && figMeshes ? figMeshes : meshes, smoke);
      if (figures) figures.update(camera, timeSec, fig);
      smoke?.update(timeSec, (typeof window !== "undefined" ? window.innerHeight : 900) * dpr);
      boats.update(t, timeSec);
    },
    dispose() {
      for (const m of all) m.dispose();
      stool?.dispose();
      figures?.dispose();
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
