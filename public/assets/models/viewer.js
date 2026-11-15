// Minimal loader for the optimised model format, shared by preview.html and bake.html (static pages
// that cannot import the app bundle). The app itself uses src/scene/assets/models.ts, which reads the
// same files; keep the two in step.
import * as THREE from "./vendor/three.module.min.js";

export { THREE };
export const BASE = new URL(".", import.meta.url).href;

export async function loadModelData(id) {
  const meta = await (await fetch(`${BASE}${id}/model.json`, { cache: "no-store" })).json();
  const bin = await (await fetch(`${BASE}${id}/${meta.bin}`, { cache: "no-store" })).arrayBuffer();
  return { meta, bin };
}

export function partGeometry(bin, p) {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(bin, p.position, p.vertices * 3), 3));
  g.setAttribute("normal", new THREE.BufferAttribute(new Int8Array(bin, p.normal, p.vertices * 3), 3, true));
  g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(bin, p.uv, p.vertices * 2), 2));
  const I = p.indexType === "u32" ? new Uint32Array(bin, p.index, p.triangles * 3) : new Uint16Array(bin, p.index, p.triangles * 3);
  g.setIndex(new THREE.BufferAttribute(I, 1));
  g.computeBoundingSphere();
  return g;
}

const loader = new THREE.TextureLoader();
const cache = new Map();
export function texture(id, name, srgb, raw = false) {
  const key = `${id}/${name}|${srgb}|${raw}`;
  if (!cache.has(key)) {
    cache.set(key, new Promise((res) => {
      loader.load(`${BASE}${id}/${name}?v=${Date.now()}`, (t) => {
        t.colorSpace = raw ? THREE.NoColorSpace : srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.anisotropy = 4;
        res(t);
      }, undefined, () => res(null));
    }));
  }
  return cache.get(key);
}

export async function material(id, m) {
  const mat = new THREE.MeshStandardMaterial({
    roughness: m.roughness ?? 1,
    metalness: m.metalness ?? 0,
    side: m.doubleSided ? THREE.DoubleSide : THREE.FrontSide,
  });
  if (m.color) mat.color.setRGB(m.color[0], m.color[1], m.color[2]);
  if (m.map) mat.map = await texture(id, m.map, true);
  if (m.normalMap) mat.normalMap = await texture(id, m.normalMap, false);
  if (m.armMap) {
    const arm = await texture(id, m.armMap, false);
    mat.roughnessMap = arm;
    if (m.arm) mat.aoMap = arm;
  }
  if (m.crownNormals) crownNormals(mat);
  if (m.alphaTest) {
    mat.alphaTest = m.alphaTest;
    if (mat.map) { mat.map.wrapS = mat.map.wrapT = THREE.ClampToEdgeWrapping; }
    if (mat.normalMap) { mat.normalMap.wrapS = mat.normalMap.wrapT = THREE.ClampToEdgeWrapping; }
  }
  return mat;
}

/** Leaf cards: keep the soft crown normals on both faces (three flips normals of back faces). */
export function crownNormals(mat) {
  mat.defines = { ...(mat.defines || {}), CROWN_NORMALS: "" };
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, r) => {
    prev?.call(mat, shader, r);
    shader.fragmentShader = shader.fragmentShader.replace("#include <normal_fragment_begin>",
      THREE.ShaderChunk.normal_fragment_begin.replace("float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;",
        "#ifdef CROWN_NORMALS\nfloat faceDirection = 1.0;\n#else\nfloat faceDirection = gl_FrontFacing ? 1.0 : - 1.0;\n#endif"));
  };
  return mat;
}

export async function buildLod(id, data, variant, lod) {
  const group = new THREE.Group();
  const L = data.meta.variants[variant].lods[lod];
  for (const p of L.parts) {
    const mesh = new THREE.Mesh(partGeometry(data.bin, p), await material(id, p.material));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    if (p.material.alphaTest) {
      mesh.customDepthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: mesh.material.map, alphaTest: p.material.alphaTest });
    }
    group.add(mesh);
  }
  group.userData.triangles = L.triangles;
  return group;
}
