import * as THREE from "three";

/**
 * GPU-animated instanced walkers (people, animals, carts). ILLUSTRATIVE ONLY: low-poly, period-neutral
 * stand-ins (no faces, no costume claim, no individual or breed is attested).
 *
 * Every instance walks to and fro along a short straight "piece" of path, entirely in the vertex
 * shader: position and heading come from the wall-clock uniform and four per-instance vectors, the
 * legs, arms and wheels from the distance travelled. A piece of length 0 is a standing figure.
 * The CPU only rewrites the instance buffers a few times a second (see world.ts).
 */

export interface PartOpts {
  /** 0 rigid, 1 leg, 2 arm, 3 skirt, 4 head, 5 wheel */
  type?: number;
  /** swing direction for legs and arms (+1 / -1) */
  sign?: number;
  /** pivot height (for skirts: the height of the hem top) */
  py?: number;
  /** pivot z (forward) */
  pz?: number;
  /** 0 = fixed vertex colour, 1 = fully tinted by the instance colour, 2 = skin tone */
  mask?: number;
  color?: THREE.ColorRepresentation;
}

export class PartBuilder {
  pos: number[] = [];
  nor: number[] = [];
  col: number[] = [];
  joint: number[] = [];
  mask: number[] = [];

  add(geo: THREE.BufferGeometry, m: THREE.Matrix4, o: PartOpts = {}): void {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    g.applyMatrix4(m);
    const p = g.getAttribute("position"), n = g.getAttribute("normal");
    const c = new THREE.Color(o.color ?? 0xffffff);
    for (let i = 0; i < p.count; i++) {
      this.pos.push(p.getX(i), p.getY(i), p.getZ(i));
      this.nor.push(n.getX(i), n.getY(i), n.getZ(i));
      this.col.push(c.r, c.g, c.b);
      this.joint.push(o.type ?? 0, o.sign ?? 0, o.py ?? 0, o.pz ?? 0);
      this.mask.push(o.mask ?? 0);
    }
    g.dispose();
  }

  /** Box with its base centre at (x, y, z). */
  box(w: number, h: number, d: number, x: number, y: number, z: number, o: PartOpts = {}, rx = 0): void {
    const g = new THREE.BoxGeometry(w, h, d);
    const m = new THREE.Matrix4().makeRotationX(rx);
    m.setPosition(x, y + h / 2, z);
    // keep rotation about the box centre
    this.add(g, m, o);
  }

  /** Tapered prism (n sides) from y0 to y1 with elliptical section (rx0, rz0) -> (rx1, rz1). */
  prism(n: number, rx0: number, rz0: number, rx1: number, rz1: number, y0: number, y1: number, x: number, z: number, o: PartOpts = {}, open = false): void {
    const g = new THREE.CylinderGeometry(1, 1, 1, n, 1, open);
    // unit cylinder radius 1 -> squash per end by editing positions
    const p = g.getAttribute("position");
    for (let i = 0; i < p.count; i++) {
      const top = p.getY(i) > 0;
      p.setX(i, p.getX(i) * (top ? rx1 : rx0));
      p.setZ(i, p.getZ(i) * (top ? rz1 : rz0));
      p.setY(i, top ? y1 : y0);
    }
    g.computeVertexNormals();
    this.add(g, new THREE.Matrix4().setPosition(x, 0, z), o);
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute("aJoint", new THREE.Float32BufferAttribute(this.joint, 4));
    g.setAttribute("aMask", new THREE.Float32BufferAttribute(this.mask, 1));
    return g;
  }
}

const FLOATS = { aBase: 4, aMot: 4, aH: 4, aCol: 3, aVar: 4 } as const;

export interface MotionParams {
  stride: number;
  swing: number;
  bob: number;
  headYaw: number;
  wheelR: number;
  graze?: number;
  roughness?: number;
}

export const motionUniforms = { uTime: { value: 0 } };

function patch(mat: THREE.MeshStandardMaterial, p: MotionParams): void {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = motionUniforms.uTime;
    sh.uniforms.uStride = { value: p.stride };
    sh.uniforms.uSwing = { value: p.swing };
    sh.uniforms.uBob = { value: p.bob };
    sh.uniforms.uHeadYaw = { value: p.headYaw };
    sh.uniforms.uWheelR = { value: p.wheelR };
    sh.uniforms.uGraze = { value: p.graze ?? 0 };
    sh.vertexShader = sh.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
attribute vec4 aBase; attribute vec4 aMot; attribute vec4 aH; attribute vec3 aCol; attribute vec4 aVar;
attribute vec4 aJoint; attribute float aMask;
uniform float uTime, uStride, uSwing, uBob, uHeadYaw, uWheelR, uGraze;
vec3 rotX(vec3 p, float a, float py, float pz) {
  float c = cos(a), s = sin(a); float dy = p.y - py, dz = p.z - pz;
  return vec3(p.x, py + dy * c - dz * s, pz + dy * s + dz * c);
}`,
      )
      .replace(
        "#include <color_vertex>",
        `#include <color_vertex>
vColor = color.rgb;
if (aMask > 1.5) vColor *= mix(vec3(0.40, 0.24, 0.17), vec3(0.16, 0.09, 0.065), aVar.w);
else vColor *= mix(vec3(1.0), aCol, aMask);`,
      )
      .replace(
        "#include <beginnormal_vertex>",
        `float mL = aMot.x;
float mMoving = step(0.5, mL);
float mU = 0.0, mTri = 0.0, mSpd = 0.0, mW = 0.0, mD = 0.0;
if (mMoving > 0.5) {
  float cyc = aMot.y + uTime * aMot.z / (2.0 * mL);
  float nn = floor(cyc); mU = cyc - nn;
  mTri = 0.5 - 0.5 * cos(6.2831853 * mU);
  mSpd = abs(sin(6.2831853 * mU));
  const float tt = 0.05;
  if (mU < 0.5) mW = (mU < tt) ? 0.5 * (1.0 - smoothstep(0.0, tt, mU)) : smoothstep(0.5 - tt, 0.5 + tt, mU);
  else mW = (mU > 1.0 - tt) ? 1.0 - 0.5 * smoothstep(1.0 - tt, 1.0, mU) : smoothstep(0.5 - tt, 0.5 + tt, mU);
  mD = 2.0 * mL * nn + mL * (mU < 0.5 ? mTri : 2.0 - mTri);
}
float mYaw = atan(aBase.z, aBase.w) + 3.14159265 * mW;
float mCy = cos(mYaw), mSy = sin(mYaw);
vec3 objectNormal = vec3(normal.x * mCy + normal.z * mSy, normal.y, -normal.x * mSy + normal.z * mCy);
#ifdef USE_TANGENT
vec3 objectTangent = vec3(tangent.xyz);
#endif`,
      )
      .replace(
        "#include <begin_vertex>",
        `vec3 mp = position;
float mPh = 6.2831853 * mD / uStride;
float mSw = uSwing * smoothstep(0.0, 0.3, mSpd) * mMoving;
float mType = aJoint.x;
if (mType > 0.5 && mType < 1.5) mp = rotX(mp, aJoint.y * mSw * sin(mPh), aJoint.z, aJoint.w);
else if (mType < 2.5 && mType > 1.5) mp = rotX(mp, -aJoint.y * mSw * 0.7 * sin(mPh), aJoint.z, aJoint.w);
else if (mType < 3.5 && mType > 2.5) {
  float hem = max(0.0, aJoint.z - mp.y);
  mp.y = aJoint.z - hem * mix(0.46, 1.0, aVar.y);
  mp.z += sin(mPh) * 0.35 * mSw * hem * 0.5;
} else if (mType < 4.5 && mType > 3.5) {
  float idle = 1.0 - mMoving;
  float ya = sin(uTime * 0.4 + aMot.y * 40.0) * 0.7 * uHeadYaw * idle;
  float cy = cos(ya), sy = sin(ya);
  mp = vec3(mp.x * cy + (mp.z - aJoint.w) * sy, mp.y, -mp.x * sy + (mp.z - aJoint.w) * cy + aJoint.w);
  mp = rotX(mp, idle * aVar.y * uGraze * 0.95, aJoint.z, aJoint.w);
} else if (mType > 4.5) mp = rotX(mp, mD / uWheelR, aJoint.z, aJoint.w);
mp.y += uBob * mSpd * abs(cos(mPh)) * mMoving;
mp *= aVar.x * aVar.z;
vec2 mDir = aBase.zw;
vec2 mPerp = vec2(mDir.y, -mDir.x);
vec2 mXZ = aBase.xy + mDir * (mTri * mL) + mPerp * aMot.w;
float mF = mTri;
float mY = mF < 0.3333 ? mix(aH.x, aH.y, mF * 3.0) : (mF < 0.6667 ? mix(aH.y, aH.z, mF * 3.0 - 1.0) : mix(aH.z, aH.w, mF * 3.0 - 2.0));
vec3 transformed = vec3(mXZ.x + mp.x * mCy + mp.z * mSy, mY + mp.y, mXZ.y - mp.x * mSy + mp.z * mCy);`,
      );
  };
}

/** One instanced draw call of walkers sharing a geometry. */
export class MotionMesh {
  readonly mesh: THREE.Mesh;
  readonly geo: THREE.InstancedBufferGeometry;
  private arr: Record<keyof typeof FLOATS, Float32Array>;
  private attrs: Record<keyof typeof FLOATS, THREE.InstancedBufferAttribute>;
  n = 0;

  constructor(base: THREE.BufferGeometry, readonly cap: number, params: MotionParams, name: string) {
    this.geo = new THREE.InstancedBufferGeometry();
    for (const k of ["position", "normal", "color", "aJoint", "aMask"]) this.geo.setAttribute(k, base.getAttribute(k));
    this.arr = {} as never;
    this.attrs = {} as never;
    for (const k of Object.keys(FLOATS) as (keyof typeof FLOATS)[]) {
      const a = (this.arr[k] = new Float32Array(cap * FLOATS[k]));
      const at = (this.attrs[k] = new THREE.InstancedBufferAttribute(a, FLOATS[k]));
      at.setUsage(THREE.DynamicDrawUsage);
      this.geo.setAttribute(k, at);
    }
    this.geo.instanceCount = 0;
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: params.roughness ?? 0.92, metalness: 0 });
    patch(mat, params);
    mat.customProgramCacheKey = () => "pop-motion-" + name;
    this.mesh = new THREE.Mesh(this.geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.name = name;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = true;
    this.mesh.userData.noPick = true;
    this.mesh.visible = false;
  }

  reset(): void {
    this.n = 0;
  }
  get full(): boolean {
    return this.n >= this.cap;
  }
  /** Add one instance. */
  push(
    x0: number, z0: number, dx: number, dz: number,
    L: number, phase: number, speed: number, lateral: number,
    h0: number, h1: number, h2: number, h3: number,
    r: number, g: number, b: number,
    scale: number, variant: number, presence: number, skin: number,
  ): void {
    if (this.n >= this.cap) return;
    const i = this.n++;
    const A = this.arr;
    let o = i * 4;
    A.aBase[o] = x0; A.aBase[o + 1] = z0; A.aBase[o + 2] = dx; A.aBase[o + 3] = dz;
    A.aMot[o] = L; A.aMot[o + 1] = phase; A.aMot[o + 2] = speed; A.aMot[o + 3] = lateral;
    A.aH[o] = h0; A.aH[o + 1] = h1; A.aH[o + 2] = h2; A.aH[o + 3] = h3;
    A.aVar[o] = scale; A.aVar[o + 1] = variant; A.aVar[o + 2] = presence; A.aVar[o + 3] = skin;
    o = i * 3;
    A.aCol[o] = r; A.aCol[o + 1] = g; A.aCol[o + 2] = b;
  }
  commit(): void {
    for (const k of Object.keys(this.attrs) as (keyof typeof FLOATS)[]) this.attrs[k].needsUpdate = true;
    this.geo.instanceCount = this.n;
    this.mesh.visible = this.n > 0;
  }
  dispose(): void {
    this.geo.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}

// ---------------------------------------------------------------------------------------------
// Geometry. Forward is +z, height up. Deliberately period-neutral: a tunic or gown, hose, a bare
// head, no faces, no costume detail. Every figure is at most about 110 triangles and every animal
// at most 150.
// ---------------------------------------------------------------------------------------------

interface Body {
  h: number;
  w: number;
  stoop: number;
  head: number;
  skirt: number;
}
/** man, woman, tall and lean, stout, child, stooped elder */
const BODIES: Body[] = [
  { h: 1.0, w: 1.0, stoop: 0, head: 1.0, skirt: 1.0 },
  { h: 0.95, w: 0.9, stoop: 0, head: 1.0, skirt: 1.12 },
  { h: 1.08, w: 0.86, stoop: 0, head: 0.96, skirt: 0.95 },
  { h: 0.99, w: 1.28, stoop: 0.05, head: 1.05, skirt: 1.2 },
  { h: 0.62, w: 0.72, stoop: 0, head: 1.3, skirt: 0.8 },
  { h: 0.93, w: 0.95, stoop: 0.28, head: 1.0, skirt: 1.0 },
];
export const BODY_COUNT = BODIES.length;

export function personGeometry(kind = 0): THREE.BufferGeometry {
  const B = BODIES[kind % BODIES.length];
  const { h, w } = B;
  const hip = 0.82 * h, sh = 1.4 * h;
  const b = new PartBuilder();
  const hose = 0x5b4f43;
  for (const s of [-1, 1]) b.prism(5, 0.062 * w, 0.066 * w, 0.08 * w, 0.085 * w, 0, hip, s * 0.1 * w, 0, { type: 1, sign: s, py: hip, pz: 0, mask: 0.35, color: hose }, true);
  // skirt / tunic skirt: the shader shortens it for a tunic and leaves it long for a gown
  b.prism(7, 0.3 * w * B.skirt, 0.26 * w * B.skirt, 0.2 * w, 0.14 * w, 0.14 * h, 0.95 * h, 0, 0, { type: 3, py: 0.95 * h, mask: 1, color: 0xf0f0f0 }, true);
  const v0 = b.pos.length / 3;
  const pz = (sh - hip) * B.stoop;
  for (const s of [-1, 1]) {
    b.prism(4, 0.07 * w, 0.07 * w, 0.055 * w, 0.055 * w, 1.12 * h, 0.86 * h, s * 0.235 * w, 0, { type: 2, sign: -s, py: sh, pz, mask: 2, color: 0xffffff }, true);
    b.prism(4, 0.078 * w, 0.078 * w, 0.065 * w, 0.065 * w, 1.38 * h, 1.12 * h, s * 0.235 * w, 0, { type: 2, sign: -s, py: sh, pz, mask: 1, color: 0xffffff }, true);
  }
  b.prism(6, 0.2 * w, 0.135 * w, 0.17 * w, 0.115 * w, 0.88 * h, 1.43 * h, 0, 0, { mask: 1, color: 0xffffff });
  const head = new THREE.IcosahedronGeometry(0.105 * B.head, 0);
  head.scale(1, 1.15, 1.05);
  b.add(head, new THREE.Matrix4().setPosition(0, 1.56 * h + (B.head - 1) * 0.04, 0.01), { type: 4, py: 1.45 * h, pz: (1.45 * h - hip) * B.stoop, mask: 2, color: 0xffffff });
  if (B.stoop > 0) for (let i = v0; i < b.pos.length / 3; i++) if (b.pos[i * 3 + 1] > hip) b.pos[i * 3 + 2] += (b.pos[i * 3 + 1] - hip) * B.stoop;
  return b.build();
}

/** A figure seated on a low stool, facing +z. Used at doorways. */
export function seatedGeometry(): THREE.BufferGeometry {
  const b = new PartBuilder();
  const rotX = (a: number, x: number, y: number, z: number): THREE.Matrix4 => new THREE.Matrix4().makeRotationX(a).setPosition(x, y, z);
  const wood = 0x6a5238;
  b.prism(4, 0.19, 0.19, 0.17, 0.17, 0.0, 0.4, 0, -0.02, { color: wood }, true);
  b.prism(4, 0.21, 0.21, 0.21, 0.21, 0.4, 0.43, 0, -0.02, { color: wood });
  for (const s of [-1, 1]) {
    const th = new THREE.CylinderGeometry(0.075, 0.062, 0.46, 4, 1, true);
    b.add(th, rotX(Math.PI / 2, s * 0.1, 0.52, 0.2), { mask: 0.35, color: 0x5b4f43 });
    const sn = new THREE.CylinderGeometry(0.058, 0.05, 0.42, 4, 1, true);
    b.add(sn, new THREE.Matrix4().setPosition(s * 0.1, 0.27, 0.43), { mask: 0.35, color: 0x5b4f43 });
    const arm = new THREE.CylinderGeometry(0.06, 0.05, 0.4, 4, 1, true);
    b.add(arm, rotX(0.9, s * 0.23, 0.82, 0.12), { mask: 1, color: 0xffffff });
  }
  b.prism(6, 0.2, 0.135, 0.17, 0.115, 0.5, 1.05, 0, -0.02, { mask: 1, color: 0xffffff });
  const head = new THREE.IcosahedronGeometry(0.105, 0);
  head.scale(1, 1.15, 1.05);
  b.add(head, new THREE.Matrix4().setPosition(0, 1.17, 0.0), { type: 4, py: 1.08, pz: 0, mask: 2, color: 0xffffff });
  return b.build();
}

export type AnimalKind = "cattle" | "sheep" | "horse" | "pig" | "dog" | "hen" | "packhorse";
export const ANIMAL_KINDS: AnimalKind[] = ["cattle", "sheep", "horse", "pig", "dog", "hen", "packhorse"];

interface Quad {
  len: number; rx: number; ry: number; legH: number; legR: number;
  rear: number; mid: number; front: number;
  neckLen: number; neckUp: number; neckR: number;
  headLen: number; headR0: number; headR1: number; drop: number;
  mask: number; z0?: number; horns?: boolean; ears?: boolean; mane?: boolean; tail?: "hang" | "up" | "none"; darkLegs?: boolean; headMask?: number;
}

function barrel(b: PartBuilder, len: number, rx: number, ry: number, y: number, z: number, rear: number, mid: number, front: number, n: number, o: PartOpts): void {
  const g = new THREE.CylinderGeometry(1, 1, 1, n, 2, false);
  g.rotateX(Math.PI / 2);
  const p = g.getAttribute("position");
  for (let i = 0; i < p.count; i++) {
    const zz = p.getZ(i);
    const k = zz < -0.25 ? rear : zz > 0.25 ? front : mid;
    p.setXYZ(i, p.getX(i) * rx * k, p.getY(i) * ry * k, zz * len);
  }
  g.computeVertexNormals();
  b.add(g, new THREE.Matrix4().setPosition(0, y, z), o);
}

/** Tube from (y, z) base along a direction `ang` above (+) or below (-) horizontal, forward. */
function tube(b: PartBuilder, n: number, r0: number, r1: number, len: number, y: number, z: number, ang: number, open: boolean, o: PartOpts): { y: number; z: number } {
  const g = new THREE.CylinderGeometry(r1, r0, len, n, 1, open);
  const a = Math.PI / 2 - ang;
  g.rotateX(a);
  const dy = Math.sin(ang), dz = Math.cos(ang);
  b.add(g, new THREE.Matrix4().setPosition(0, y + (dy * len) / 2, z + (dz * len) / 2), o);
  return { y: y + dy * len, z: z + dz * len };
}

function quad(b: PartBuilder, o: Quad): void {
  const z0 = o.z0 ?? 0;
  const by = o.legH + o.ry * 0.55;
  barrel(b, o.len, o.rx, o.ry, by, z0, o.rear, o.mid, o.front, 8, { mask: o.mask, color: 0xffffff });
  const legs: [number, number, number][] = [[-1, 1, 1], [1, 1, -1], [-1, -1, -1], [1, -1, 1]];
  for (const [sx, sz, sg] of legs) {
    const zz = z0 + sz * (o.len / 2 - o.ry * 0.75);
    b.prism(4, o.legR * 0.62, o.legR * 0.62, o.legR * 1.35, o.legR * 1.35, 0, o.legH + o.ry * 0.35, sx * o.rx * 0.62, zz,
      { type: 1, sign: sg, py: o.legH + o.ry * 0.35, pz: zz, mask: o.darkLegs ? 0.15 : 0.9, color: o.darkLegs ? 0x3b3028 : 0xbfb8ac }, true);
  }
  const sy = by + o.ry * 0.3, sz = z0 + o.len / 2 - o.ry * 0.2;
  const nk = o.neckLen > 0.02 ? tube(b, 5, o.neckR, o.neckR * 0.78, o.neckLen, sy, sz, o.neckUp, true, { mask: o.mask, color: 0xffffff }) : { y: sy, z: sz };
  const hd: PartOpts = { type: 4, py: nk.y, pz: nk.z, mask: o.headMask ?? o.mask, color: o.headMask === 0 ? 0x30261e : 0xffffff };
  const hh = tube(b, 4, o.headR0, o.headR1, o.headLen, nk.y, nk.z - 0.02, -o.drop, false, hd);
  if (o.horns) for (const s of [-1, 1]) {
    const cone = new THREE.ConeGeometry(o.headR0 * 0.22, o.headR0 * 1.7, 3);
    cone.rotateZ(-s * 1.15);
    b.add(cone, new THREE.Matrix4().setPosition(s * o.headR0 * 1.15, nk.y + o.headR0 * 0.5, nk.z + 0.03), { ...hd, mask: 0, color: 0xe6dfce });
  }
  if (o.ears) for (const s of [-1, 1]) {
    const cone = new THREE.ConeGeometry(o.headR0 * 0.3, o.headR0 * 1.0, 3);
    cone.rotateZ(-s * (o.horns ? 1.5 : 0.35));
    b.add(cone, new THREE.Matrix4().setPosition(s * o.headR0 * 0.95, nk.y + o.headR0 * 0.55, nk.z + 0.01), { ...hd, mask: o.mask * 0.8, color: 0xffffff });
  }
  void hh;
  if (o.mane) b.prism(4, 0.018, o.neckR * 0.5, 0.018, o.neckR * 0.5, sy + 0.02, sy + o.neckLen * Math.sin(o.neckUp) + 0.06, 0, sz + o.neckLen * Math.cos(o.neckUp) * 0.5 - 0.04, { mask: 0.3, color: 0x2b231d }, true);
  const tz = z0 - o.len / 2 - o.ry * 0.05;
  if (o.tail === "up") b.prism(4, 0.02, 0.02, 0.012, 0.012, by + o.ry * 0.5, by + o.ry * 1.6, 0, tz - 0.02, { mask: 0.3, color: 0x2b231d }, true);
  else if (o.tail !== "none") b.prism(4, o.ry * 0.14, o.ry * 0.14, o.ry * 0.08, o.ry * 0.08, o.legH * 0.4, by + o.ry * 0.3, 0, tz - 0.03, { mask: 0.35, color: 0x2b231d }, true);
}

function hen(b: PartBuilder): void {
  const body = new THREE.IcosahedronGeometry(1, 0);
  body.scale(0.085, 0.1, 0.14);
  b.add(body, new THREE.Matrix4().setPosition(0, 0.24, 0), { mask: 1, color: 0xffffff });
  const tail = new THREE.ConeGeometry(0.06, 0.18, 3);
  tail.rotateX(-Math.PI / 2 - 0.5);
  b.add(tail, new THREE.Matrix4().setPosition(0, 0.31, -0.17), { mask: 0.6, color: 0xffffff });
  for (const [s, sg] of [[-1, 1], [1, -1]] as [number, number][]) b.prism(3, 0.007, 0.007, 0.011, 0.011, 0, 0.18, s * 0.04, 0.0, { type: 1, sign: sg, py: 0.18, pz: 0, mask: 0, color: 0xc0a050 }, true);
  const nk = tube(b, 3, 0.03, 0.022, 0.13, 0.28, 0.1, 1.2, true, { mask: 1, color: 0xffffff });
  const head = new THREE.IcosahedronGeometry(0.036, 0);
  b.add(head, new THREE.Matrix4().setPosition(0, nk.y + 0.02, nk.z + 0.01), { type: 4, py: nk.y, pz: nk.z, mask: 0.6, color: 0xffffff });
  const beak = new THREE.ConeGeometry(0.014, 0.05, 3);
  beak.rotateX(Math.PI / 2);
  b.add(beak, new THREE.Matrix4().setPosition(0, nk.y + 0.015, nk.z + 0.06), { type: 4, py: nk.y, pz: nk.z, mask: 0, color: 0xd0a040 });
}

export function animalGeometry(kind: AnimalKind): THREE.BufferGeometry {
  const b = new PartBuilder();
  if (kind === "cattle")
    quad(b, { len: 1.5, rx: 0.34, ry: 0.36, legH: 0.55, legR: 0.07, rear: 0.9, mid: 1.0, front: 0.86, neckLen: 0.38, neckUp: 0.1, neckR: 0.19, headLen: 0.42, headR0: 0.15, headR1: 0.09, drop: 0.55, mask: 1, horns: true, ears: true, tail: "hang", headMask: 1 });
  else if (kind === "sheep") {
    const body = new THREE.IcosahedronGeometry(1, 1);
    body.scale(0.23, 0.22, 0.37);
    b.add(body, new THREE.Matrix4().setPosition(0, 0.46, 0), { mask: 1, color: 0xffffff });
    for (const [sx, sz, sg] of [[-1, 1, 1], [1, 1, -1], [-1, -1, -1], [1, -1, 1]] as [number, number, number][])
      b.prism(4, 0.022, 0.022, 0.034, 0.034, 0, 0.36, sx * 0.1, sz * 0.22, { type: 1, sign: sg, py: 0.36, pz: sz * 0.22, mask: 0.1, color: 0x3b3028 }, true);
    const hd: PartOpts = { type: 4, py: 0.52, pz: 0.36, mask: 0.1, color: 0x3b3028 };
    tube(b, 4, 0.07, 0.04, 0.22, 0.54, 0.34, -0.45, false, hd);
    for (const s of [-1, 1]) {
      const e = new THREE.ConeGeometry(0.03, 0.1, 3);
      e.rotateZ(-s * 1.4);
      b.add(e, new THREE.Matrix4().setPosition(s * 0.08, 0.56, 0.37), hd);
    }
  } else if (kind === "horse")
    quad(b, { len: 1.5, rx: 0.27, ry: 0.32, legH: 0.8, legR: 0.055, rear: 1.0, mid: 0.95, front: 0.9, neckLen: 0.6, neckUp: 0.95, neckR: 0.13, headLen: 0.5, headR0: 0.09, headR1: 0.05, drop: 0.85, mask: 1, ears: true, mane: true, tail: "hang" });
  else if (kind === "packhorse") {
    quad(b, { len: 1.5, rx: 0.27, ry: 0.32, legH: 0.8, legR: 0.055, rear: 1.0, mid: 0.95, front: 0.9, neckLen: 0.6, neckUp: 0.95, neckR: 0.13, headLen: 0.5, headR0: 0.09, headR1: 0.05, drop: 0.85, mask: 1, tail: "hang" });
    for (const s of [-1, 1]) b.box(0.26, 0.42, 0.55, s * 0.4, 0.62, -0.05, { mask: 0.6, color: 0xb59a6a });
    b.box(0.5, 0.2, 0.7, 0, 1.2, -0.05, { mask: 0.6, color: 0x8a7a5a });
  } else if (kind === "pig")
    quad(b, { len: 0.95, rx: 0.2, ry: 0.22, legH: 0.2, legR: 0.04, rear: 0.95, mid: 1.0, front: 0.85, neckLen: 0.04, neckUp: 0, neckR: 0.13, headLen: 0.3, headR0: 0.12, headR1: 0.07, drop: 0.25, mask: 1, ears: true, tail: "up" });
  else if (kind === "dog")
    quad(b, { len: 0.62, rx: 0.08, ry: 0.1, legH: 0.24, legR: 0.025, rear: 0.85, mid: 1.0, front: 0.9, neckLen: 0.1, neckUp: 0.7, neckR: 0.055, headLen: 0.18, headR0: 0.05, headR1: 0.03, drop: 0.2, mask: 1, ears: true, tail: "up", darkLegs: false });
  else hen(b);
  return b.build();
}

/** A horse in the shafts of a two-wheeled cart with spoked wheels. Wheels turn with the distance travelled. */
export function cartGeometry(): THREE.BufferGeometry {
  const b = new PartBuilder();
  quad(b, { len: 1.5, rx: 0.27, ry: 0.32, legH: 0.8, legR: 0.055, rear: 1.0, mid: 0.95, front: 0.9, neckLen: 0.6, neckUp: 0.95, neckR: 0.13, headLen: 0.5, headR0: 0.09, headR1: 0.05, drop: 0.85, mask: 1, tail: "hang", z0: 2.1 });
  const wood = 0x6a5238;
  b.box(1.5, 0.1, 2.2, 0, 0.78, -0.4, { color: wood });
  for (const s of [-1, 1]) {
    b.box(0.07, 0.4, 2.2, s * 0.72, 0.88, -0.4, { color: wood });
    b.box(0.07, 0.07, 2.4, s * 0.45, 0.78, 1.35, { color: wood });
  }
  b.box(0.07, 0.4, 1.5, 0, 0.88, -1.48, { color: wood });
  b.box(1.1, 0.55, 1.2, 0, 0.9, -0.5, { mask: 0.5, color: 0xb59a6a });
  const wheelOpts: PartOpts = { type: 5, py: 0.52, pz: -0.2 };
  for (const s of [-1, 1]) {
    const x = s * 0.84;
    const rim = new THREE.TorusGeometry(0.5, 0.035, 4, 12);
    rim.rotateY(Math.PI / 2);
    b.add(rim, new THREE.Matrix4().setPosition(x, 0.52, -0.2), { ...wheelOpts, color: 0x4a3a28 });
    for (let k = 0; k < 3; k++) {
      const sp = new THREE.BoxGeometry(0.03, 1.0, 0.035);
      sp.rotateX((k * Math.PI) / 3);
      b.add(sp, new THREE.Matrix4().setPosition(x, 0.52, -0.2), { ...wheelOpts, color: 0x5a4630 });
    }
    const hub = new THREE.CylinderGeometry(0.07, 0.07, 0.14, 6, 1);
    hub.rotateZ(Math.PI / 2);
    b.add(hub, new THREE.Matrix4().setPosition(x, 0.52, -0.2), { ...wheelOpts, color: 0x2e2418 });
  }
  return b.build();
}

export const PERSON_PARAMS: MotionParams = { stride: 1.5, swing: 0.5, bob: 0.03, headYaw: 1, wheelR: 0.5 };
export const SEATED_PARAMS: MotionParams = { stride: 1.5, swing: 0, bob: 0, headYaw: 1.4, wheelR: 0.5 };
export const ANIMAL_PARAMS: MotionParams = { stride: 1.7, swing: 0.45, bob: 0.015, headYaw: 0, wheelR: 0.5, graze: 1 };
export const HORSE_PARAMS: MotionParams = { stride: 2.0, swing: 0.4, bob: 0.015, headYaw: 0, wheelR: 0.5, graze: 0.8 };
export const SHEEP_PARAMS: MotionParams = { stride: 0.9, swing: 0.5, bob: 0.01, headYaw: 0, wheelR: 0.5, graze: 1 };
export const PIG_PARAMS: MotionParams = { stride: 0.8, swing: 0.5, bob: 0.01, headYaw: 0, wheelR: 0.5, graze: 1 };
export const DOG_PARAMS: MotionParams = { stride: 0.9, swing: 0.6, bob: 0.015, headYaw: 0, wheelR: 0.5, graze: 0.8 };
export const HEN_PARAMS: MotionParams = { stride: 0.32, swing: 0.8, bob: 0.01, headYaw: 0, wheelR: 0.5, graze: 1.1 };
export const CART_PARAMS: MotionParams = { stride: 1.9, swing: 0.4, bob: 0.01, headYaw: 0, wheelR: 0.52 };
export const ANIMAL_PARAM_BY_KIND: Record<AnimalKind, MotionParams> = {
  cattle: ANIMAL_PARAMS, sheep: SHEEP_PARAMS, horse: HORSE_PARAMS, pig: PIG_PARAMS, dog: DOG_PARAMS, hen: HEN_PARAMS, packhorse: HORSE_PARAMS,
};
