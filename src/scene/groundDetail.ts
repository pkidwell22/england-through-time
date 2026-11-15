import * as THREE from "three";
import { registerExtra, type ExtraContext, type Extra } from "./extras";
import { CoverField } from "./ground/cover";
import { GroundDecal } from "./ground/decal";
import { makeTuftTexture, pebbleGeometry, plankGeometry, tuftGeometry } from "./ground/tufts";
import { WrapLayer, type WrapLayerOpts } from "./ground/wrapLayer";

/**
 * Near-camera ground detail: grass and meadow tufts, reeds on the marsh, stones and driftwood on the
 * foreshore, and a decal for the wet shore line, field furrows, ruts, puddles and straw. Everything is
 * driven by a small ground-cover window (ground/cover.ts) that follows the camera and reproduces the
 * terrain's own land-cover logic at the current year. Called once by the engine.
 */
function quadGeometry(quads: number): THREE.BufferGeometry {
  const t = tuftGeometry(quads);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(t.pos, 3));
  g.setAttribute("uv", new THREE.BufferAttribute(t.uv, 2));
  const n = new Float32Array(t.pos.length);
  for (let i = 1; i < n.length; i += 3) n[i] = 1;
  g.setAttribute("normal", new THREE.BufferAttribute(n, 3));
  g.setIndex(new THREE.BufferAttribute(t.idx, 1));
  return g;
}

function build(ctx: ExtraContext): Extra | null {
  if (ctx.quality === "low") return null;
  // debug switch for before/after comparisons: ?ground=0
  if (typeof location !== "undefined" && /[?&]ground=0/.test(location.search)) return null;
  const high = ctx.quality === "high";
  const k = high ? 1 : 0.5;
  const river = ctx.terrain.hasRiver;
  const cover = new CoverField(ctx);
  const root = new THREE.Group();
  root.name = "ground-detail";
  const grassTex = makeTuftTexture("grass");
  const reedTex = makeTuftTexture("reed");
  const grassGeo = quadGeometry(2);
  const reedGeo = quadGeometry(2);
  const stoneGeo = pebbleGeometry(7);
  const plankGeo = plankGeometry();
  const grassBase: Omit<WrapLayerOpts, "name" | "count" | "tile" | "fade" | "camFade" | "sizeW" | "sizeH" | "seed"> = {
    geometry: grassGeo, chan: [1, 0, 0], stat: "grass", wind: 0.12, windSpeed: 1.5, sink: -0.02, up: true, map: grassTex,
    colA: 0x7a9a3a, colB: 0xb8c25e, field: { color: 0xc9bb82, shrink: 0.5 }, wetColor: 0x9a9a52, big: 0.6,
  };
  const layers: WrapLayer[] = [];
  const add = (o: WrapLayerOpts) => {
    const l = new WrapLayer(o, cover);
    layers.push(l);
    root.add(l.mesh);
  };
  // grass: three nested wrapping tiles, finer and denser close to the camera
  add({ ...grassBase, name: "grass0", count: Math.round(14000 * k), tile: 22, fade: [6.5, 10.5], camFade: [9, 20], sizeW: [0.2, 0.38], sizeH: [0.2, 0.4], seed: 11 });
  add({ ...grassBase, name: "grass1", count: Math.round(10000 * k), tile: 60, fade: [19, 29], camFade: [25, 55], sizeW: [0.4, 0.7], sizeH: [0.3, 0.55], seed: 12 });
  add({ ...grassBase, name: "grass2", count: Math.round(8000 * k), tile: 200, fade: [60, 95], camFade: [55, 110], sizeW: [0.9, 1.6], sizeH: [0.45, 0.8], seed: 13, ahead: 1 });
  if (river) {
    const reedBase = {
      geometry: reedGeo, chan: [0, 1, 0] as [number, number, number], stat: "reed" as const, wind: 0.2, windSpeed: 1.2, sink: -0.05, up: true, map: reedTex,
      colA: 0x8d9249, colB: 0xbdb56b, big: 0.5, inMirror: true,
    };
    add({ ...reedBase, name: "reed1", count: Math.round(3500 * k), tile: 64, fade: [18, 30], camFade: [25, 60], sizeW: [0.7, 1.3], sizeH: [1.2, 2.1], seed: 21 });
    add({ ...reedBase, name: "reed2", count: Math.round(3000 * k), tile: 200, fade: [60, 96], camFade: [55, 110], sizeW: [1.2, 2.0], sizeH: [1.4, 2.3], seed: 22, ahead: 1 });
    const stoneBase = { geometry: stoneGeo, chan: [0, 0, 1] as [number, number, number], stat: "shore" as const, sink: -0.03, colA: 0x6e675b, colB: 0xb0a68e };
    add({ ...stoneBase, name: "stone0", count: Math.round(4000 * k), tile: 40, fade: [12, 19], camFade: [14, 30], sizeW: [0.05, 0.22], sizeH: [0.04, 0.12], big: 1.2, seed: 31 });
    add({ ...stoneBase, name: "stone1", count: Math.round(2500 * k), tile: 120, fade: [36, 54], camFade: [30, 70], sizeW: [0.1, 0.42], sizeH: [0.07, 0.22], big: 1.5, seed: 32 });
    if (high) add({ geometry: plankGeo, name: "timber", chan: [0, 0, 1], stat: "shore", count: 380, tile: 90, fade: [26, 42], camFade: [25, 55], sizeW: [0.7, 2.2], sizeH: [0.7, 2.2], sink: -0.03, colA: 0x5a4a34, colB: 0x8a7658, seed: 41 });
  }
  const decal = new GroundDecal(cover, river);
  root.add(decal.mesh);

  const foot = new THREE.Vector2();
  const ahead = new THREE.Vector2();
  const dir = new THREE.Vector3();
  let first = true;
  const extra: Extra = {
    object: root,
    update(t, timeSec, camera) {
      const cp = camera.position;
      foot.set(cp.x, cp.z);
      camera.getWorldDirection(dir);
      const gy = ctx.terrain.floor(ctx.terrain.height(cp.x, cp.z, t));
      const camH = cp.y - gy;
      const hl = Math.hypot(dir.x, dir.z);
      let reach = 45;
      if (dir.y < -0.02) reach = Math.min(reach, (camH / -dir.y) * hl);
      if (hl > 1e-3) ahead.set(cp.x + (dir.x / hl) * reach, cp.z + (dir.z / hl) * reach);
      else ahead.copy(foot);
      cover.uniforms.uTime.value = timeSec;
      // the window follows the point the layers are centred on; the first build is done at once
      const budget = first || !cover.covers(ahead.x, ahead.y, 70) ? 120 : 2.5;
      if (camH < 120) cover.update(t, ahead.x, ahead.y, budget);
      first = false;
      for (const l of layers) l.update(foot, ahead, camH);
      decal.update(foot, camH);
    },
    dispose() {
      for (const l of layers) l.dispose();
      decal.dispose();
      cover.dispose();
      grassTex.dispose();
      reedTex.dispose();
    },
  };
  return extra;
}

export function registerGroundDetail(): void {
  registerExtra(build);
}
