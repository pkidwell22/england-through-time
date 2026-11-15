import * as THREE from "three";

/**
 * Terrain albedo for the path tracer. The live terrain colours itself in its fragment shader (scanned grass, forest
 * floor, mud, earth and dry ground blended by per-vertex weights, tinted by land cover, with draped street surfaces and
 * ground decals on top); none of that exists as a texture. Here the same shaders are run with lighting switched off
 * (the output is the surface colour, `diffuseColor`, not the lit colour) into top-down orthographic tiles.
 *
 * The tiles form a quadtree around the camera: each is TILE_RES² texels, and a tile is split while its texels are
 * coarser than a screen pixel at its nearest distance from the camera, within a fixed tile budget (the path tracer
 * packs every texture into one array of equal-sized layers, so one huge texture is not an option).
 */

export const TILE_RES = 1024;

export interface TileRect {
  x0: number;
  z0: number;
  s: number;
}
export interface TerrainTile extends TileRect {
  rt: THREE.WebGLRenderTarget;
}

/**
 * Plan the quadtree. `pixAngle` is the angle one screen pixel subtends (radians), `groundAt` gives the terrain height.
 */
export function planTiles(
  cam: THREE.PerspectiveCamera, frustum: THREE.Frustum, rootSize: number, maxTiles: number, pixAngle: number,
  groundAt: (x: number, z: number) => number, minSize = 8,
): TileRect[] {
  const cx = cam.position.x, cz = cam.position.z;
  // The root is enlarged and shifted so the camera does not sit on a tile corner at every level (with the camera at the
  // centre, each level would split all four tiles around it and spend the budget evenly instead of going deeper).
  const S = rootSize * 1.3;
  let leaves: TileRect[] = [{ x0: cx - S * 0.5 + S * 0.137, z0: cz - S * 0.5 + S * 0.0913, s: S }];
  const box = new THREE.Box3();
  const score = (t: TileRect) => {
    const nx = Math.max(t.x0, Math.min(cx, t.x0 + t.s)), nz = Math.max(t.z0, Math.min(cz, t.z0 + t.s));
    const gy = groundAt(nx, nz);
    const d = Math.max(0.5, Math.hypot(nx - cx, nz - cz, cam.position.y - gy));
    return t.s / TILE_RES / (d * pixAngle);
  };
  const visible = (t: TileRect) => {
    const gy = groundAt(t.x0 + t.s / 2, t.z0 + t.s / 2);
    box.min.set(t.x0, gy - 60, t.z0);
    box.max.set(t.x0 + t.s, gy + 120, t.z0 + t.s);
    return frustum.intersectsBox(box);
  };
  for (;;) {
    if (leaves.length + 3 > maxTiles) break;
    let best = -1, bs = 1;
    for (let i = 0; i < leaves.length; i++) {
      const t = leaves[i];
      if (t.s / 2 < minSize) continue;
      const sc = score(t);
      if (sc > bs && visible(t)) {
        bs = sc;
        best = i;
      }
    }
    if (best < 0) break;
    const t = leaves[best];
    const h = t.s / 2;
    leaves = leaves.filter((_, i) => i !== best);
    leaves.push({ x0: t.x0, z0: t.z0, s: h }, { x0: t.x0 + h, z0: t.z0, s: h }, { x0: t.x0, z0: t.z0 + h, s: h }, { x0: t.x0 + h, z0: t.z0 + h, s: h });
  }
  return leaves;
}

/** Clone of a material that outputs its unlit surface colour (and alpha) instead of the lit result. */
export function albedoMaterial(src: THREE.Material): THREE.Material {
  const m = src.clone();
  (m as THREE.MeshStandardMaterial).fog = false;
  m.clippingPlanes = null;
  m.side = THREE.DoubleSide;
  const prev = src.onBeforeCompile;
  const prevKey = src.customProgramCacheKey.call(src);
  m.onBeforeCompile = (shader, r) => {
    prev.call(src, shader, r);
    shader.fragmentShader = shader.fragmentShader.replace("#include <opaque_fragment>", "gl_FragColor = vec4( diffuseColor.rgb, diffuseColor.a );");
  };
  m.customProgramCacheKey = () => `photo-albedo|${prevKey}`;
  return m;
}

/** Render each tile from straight above with the albedo materials. */
export function bakeTiles(renderer: THREE.WebGLRenderer, sources: THREE.Mesh[], rects: TileRect[]): TerrainTile[] {
  const scene = new THREE.Scene();
  scene.matrixWorldAutoUpdate = false;
  const mats: THREE.Material[] = [];
  let top = 200;
  for (const src of sources) {
    const mat = albedoMaterial(src.material as THREE.Material);
    mats.push(mat);
    const p = new THREE.Mesh(src.geometry, mat);
    p.frustumCulled = false;
    p.matrixAutoUpdate = false;
    p.matrix.copy(src.matrixWorld);
    p.matrixWorld.copy(src.matrixWorld);
    p.renderOrder = src.renderOrder;
    scene.add(p);
    src.geometry.computeBoundingBox();
    const bb = src.geometry.boundingBox;
    if (bb) top = Math.max(top, bb.max.y + 50);
  }
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, top + 3000);
  cam.up.set(0, 0, -1);
  const prevTarget = renderer.getRenderTarget();
  const prevClear = renderer.getClearColor(new THREE.Color());
  const prevAlpha = renderer.getClearAlpha();
  const prevTM = renderer.toneMapping;
  const prevClip = renderer.localClippingEnabled;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.localClippingEnabled = false;
  // uncovered texels (outside the terrain) take a neutral earth colour
  renderer.setClearColor(new THREE.Color(0.18, 0.16, 0.12), 1);
  const out: TerrainTile[] = [];
  // Draped layers zero their own draw range when the planar-reflection camera (under the water) renders them, in
  // onBeforeRender; the proxies have no such hook, so the full range is restored for the bake and put back after.
  const ranges = sources.map((m) => ({ g: m.geometry, start: m.geometry.drawRange.start, count: m.geometry.drawRange.count }));
  for (const r of ranges) r.g.setDrawRange(0, Infinity);
  try {
    for (const t of rects) {
      const rt = new THREE.WebGLRenderTarget(TILE_RES, TILE_RES, {
        type: THREE.UnsignedByteType, colorSpace: THREE.SRGBColorSpace, depthBuffer: true, generateMipmaps: false,
        minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
      });
      const h = t.s / 2;
      cam.left = -h; cam.right = h; cam.top = h; cam.bottom = -h;
      cam.position.set(t.x0 + h, top + 1000, t.z0 + h);
      cam.lookAt(t.x0 + h, 0, t.z0 + h);
      cam.updateProjectionMatrix();
      cam.updateMatrixWorld();
      renderer.setRenderTarget(rt);
      renderer.clear(true, true, false);
      renderer.render(scene, cam);
      out.push({ ...t, rt });
    }
  } finally {
    for (const r of ranges) r.g.setDrawRange(r.start, r.count);
    renderer.setRenderTarget(prevTarget);
    renderer.setClearColor(prevClear, prevAlpha);
    renderer.toneMapping = prevTM;
    renderer.localClippingEnabled = prevClip;
    for (const m of mats) m.dispose();
  }
  return out;
}

/** Index of the tile containing (x, z), or -1. Tiles do not overlap. */
export function tileIndex(tiles: TileRect[], x: number, z: number): number {
  for (let i = 0; i < tiles.length; i++) {
    const t = tiles[i];
    if (x >= t.x0 && x < t.x0 + t.s && z >= t.z0 && z < t.z0 + t.s) return i;
  }
  return -1;
}
