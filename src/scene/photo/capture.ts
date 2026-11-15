import * as THREE from "three";

/**
 * GPU vertex capture: runs a mesh's own vertex shader (with every onBeforeCompile patch it carries: the per-instance
 * life window, ground-cover draping, walking figures, camera-facing cards…) and writes the transformed world-space
 * position, normal, vertex colour and texture coordinate of every vertex of every instance into a float render target,
 * one pixel per vertex, which is then read back. This is how the photo baker sees exactly what the rasteriser draws,
 * even where the geometry on the CPU is only a template that the GPU moves, scales or hides.
 *
 * Each vertex is drawn as one point; its pixel is (instance * vertsPerInstance + vertex - offset). Large meshes are
 * captured in passes of SIDE * SIDE vertices.
 */

const SIDE = 1024;
const PER_PASS = SIDE * SIDE;

export interface CaptureWant {
  normal: boolean;
  color: boolean;
  uv: boolean;
}

export interface Captured {
  /** World positions, 4 floats per vertex (w = 1 where written). */
  pos: Float32Array;
  nrm: Float32Array | null;
  col: Float32Array | null;
  uv: Float32Array | null;
  /** Vertices per instance (the geometry's position count). */
  verts: number;
  /** Instances captured, in the order of `ids` (or 0..n-1). */
  instances: number;
  /** Source instance index of each captured instance (null: 0..instances-1). */
  ids: Uint32Array | null;
}

const capUniforms = {
  uCapInvView: { value: new THREE.Matrix4() },
  uCapVerts: { value: 0 },
  uCapOffset: { value: 0 },
  uCapW: { value: SIDE },
  uCapH: { value: SIDE },
};

const VERT_DECL = `
uniform mat4 uCapInvView;
uniform int uCapVerts;
uniform int uCapOffset;
uniform int uCapW;
uniform int uCapH;
varying vec4 vCap0;
varying vec4 vCap1;
varying vec4 vCap2;
varying vec4 vCap3;
`;

const VERT_BODY = `
  // ---- photo-mode vertex capture
  vCap0 = vec4( ( uCapInvView * mvPosition ).xyz, 1.0 );
  #ifdef CAP_NORMAL
  vCap1 = vec4( normalize( mat3( uCapInvView ) * transformedNormal ), 0.0 );
  #else
  vCap1 = vec4( 0.0 );
  #endif
  #if defined( USE_COLOR_ALPHA )
  vCap2 = vColor;
  #elif defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR ) || defined( USE_BATCHING_COLOR )
  vCap2 = vec4( vColor, 1.0 );
  #else
  vCap2 = vec4( 1.0 );
  #endif
  #if defined( USE_MAP )
  vCap3 = vec4( vMapUv, 0.0, 1.0 );
  #elif defined( USE_NORMALMAP )
  vCap3 = vec4( vNormalMapUv, 0.0, 1.0 );
  #elif defined( USE_ROUGHNESSMAP )
  vCap3 = vec4( vRoughnessMapUv, 0.0, 1.0 );
  #elif defined( USE_UV )
  vCap3 = vec4( vUv, 0.0, 1.0 );
  #else
  vCap3 = vec4( 0.0 );
  #endif
  int capId = gl_InstanceID * uCapVerts + gl_VertexID - uCapOffset;
  if ( capId < 0 || capId >= uCapW * uCapH ) {
    gl_Position = vec4( 4.0, 4.0, 4.0, 1.0 );
  } else {
    gl_Position = vec4( ( float( capId % uCapW ) + 0.5 ) / float( uCapW ) * 2.0 - 1.0, ( float( capId / uCapW ) + 0.5 ) / float( uCapH ) * 2.0 - 1.0, 0.0, 1.0 );
  }
  gl_PointSize = 1.0;
`;

const FRAG = `
varying vec4 vCap0;
varying vec4 vCap1;
varying vec4 vCap2;
varying vec4 vCap3;
layout( location = 1 ) out highp vec4 capOut1;
layout( location = 2 ) out highp vec4 capOut2;
layout( location = 3 ) out highp vec4 capOut3;
void main() {
  gl_FragColor = vCap0;
  capOut1 = vCap1;
  capOut2 = vCap2;
  capOut3 = vCap3;
}
`;

/** True when a material type has the standard vertex pipeline (mvPosition, transformedNormal) the capture relies on. */
export function capturable(m: THREE.Material): boolean {
  return (
    (m as THREE.MeshStandardMaterial).isMeshStandardMaterial === true ||
    (m as THREE.MeshLambertMaterial).isMeshLambertMaterial === true ||
    (m as THREE.MeshPhongMaterial).isMeshPhongMaterial === true ||
    (m as THREE.MeshBasicMaterial).isMeshBasicMaterial === true
  );
}

/** Whether a material carries its own shader patch (which may move vertices). */
export function hasCustomShader(m: THREE.Material): boolean {
  return Object.prototype.hasOwnProperty.call(m, "onBeforeCompile");
}

export class VertexCapture {
  private rt: THREE.WebGLRenderTarget;
  private scene = new THREE.Scene();
  private mats = new Map<THREE.Material, THREE.Material>();
  /** Diagnostics. */
  passes = 0;
  vertices = 0;

  constructor(private renderer: THREE.WebGLRenderer, private camera: THREE.Camera) {
    this.rt = new THREE.WebGLRenderTarget(SIDE, SIDE, {
      count: 4, type: THREE.FloatType, format: THREE.RGBAFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
      depthBuffer: false, generateMipmaps: false,
    });
    this.scene.matrixWorldAutoUpdate = false;
  }

  private material(src: THREE.Material): THREE.Material {
    let m = this.mats.get(src);
    if (m) return m;
    m = src.clone();
    m.clippingPlanes = null;
    m.transparent = false;
    m.depthTest = false;
    m.depthWrite = false;
    m.blending = THREE.NoBlending;
    m.side = THREE.DoubleSide;
    m.alphaTest = 0;
    (m as THREE.MeshStandardMaterial).fog = false;
    const basic = (src as THREE.MeshBasicMaterial).isMeshBasicMaterial === true;
    const prev = src.onBeforeCompile;
    const prevKey = src.customProgramCacheKey.call(src);
    m.onBeforeCompile = (shader, r) => {
      prev.call(src, shader, r);
      Object.assign(shader.uniforms, capUniforms);
      let vs = shader.vertexShader;
      const end = vs.lastIndexOf("}");
      vs = VERT_DECL + (basic ? "" : "#define CAP_NORMAL\n") + vs.slice(0, end) + VERT_BODY + vs.slice(end);
      shader.vertexShader = vs;
      shader.fragmentShader = FRAG;
    };
    m.customProgramCacheKey = () => `photo-capture|${basic ? 0 : 1}|${prevKey}`;
    this.mats.set(src, m);
    return m;
  }

  /**
   * Capture one mesh. `select` restricts an InstancedMesh to the given instance indices (compacted copies of every
   * per-instance attribute are made); null captures all drawn instances.
   */
  capture(src: THREE.Mesh, select: Uint32Array | null, want: CaptureWant): Captured {
    const geo = src.geometry;
    const V = geo.attributes.position.count;
    const inst = src as THREE.InstancedMesh;
    const isIM = inst.isInstancedMesh === true;
    const isIBG = (geo as THREE.InstancedBufferGeometry).isInstancedBufferGeometry === true;
    let instances = 1;
    if (isIM) instances = select ? select.length : inst.count;
    else if (isIBG) {
      // draped layers set instanceCount to 0 in onBeforeRender for the (under-water) reflection camera: when the last
      // render left it at 0, every instance the buffers hold is taken (their shader fades the unused ones)
      const ic = (geo as THREE.InstancedBufferGeometry).instanceCount;
      instances = Math.min(ic > 0 && Number.isFinite(ic) ? ic : Infinity, maxInstances(geo));
    }
    const total = V * instances;
    const out: Captured = {
      pos: new Float32Array(total * 4),
      nrm: want.normal ? new Float32Array(total * 4) : null,
      col: want.color ? new Float32Array(total * 4) : null,
      uv: want.uv ? new Float32Array(total * 4) : null,
      verts: V, instances, ids: isIM && select ? select : null,
    };
    if (total === 0) return out;

    // capture geometry: the source attributes (shared, so nothing is uploaded again), no index, one point per vertex
    const cg = isIBG ? new THREE.InstancedBufferGeometry() : new THREE.BufferGeometry();
    const own: string[] = [];
    for (const [name, attr] of Object.entries(geo.attributes)) {
      if (isIM && select && (attr as THREE.InstancedBufferAttribute).isInstancedBufferAttribute) {
        cg.setAttribute(name, compact(attr as THREE.InstancedBufferAttribute, select));
        own.push(name);
      } else cg.setAttribute(name, attr);
    }
    if (isIBG) (cg as THREE.InstancedBufferGeometry).instanceCount = instances;
    cg.setDrawRange(0, V);
    const pts = new THREE.Points(cg, this.material(src.material as THREE.Material));
    pts.frustumCulled = false;
    pts.matrixAutoUpdate = false;
    pts.matrix.copy(src.matrixWorld);
    pts.matrixWorld.copy(src.matrixWorld);
    if (isIM) {
      const fake = pts as unknown as THREE.InstancedMesh & { morphTexture: null };
      Object.assign(fake, {
        isInstancedMesh: true,
        instanceMatrix: select ? compact(inst.instanceMatrix, select) : inst.instanceMatrix,
        instanceColor: inst.instanceColor ? (select ? compact(inst.instanceColor, select) : inst.instanceColor) : null,
        morphTexture: null,
        count: instances,
      });
    }
    this.scene.add(pts);

    const r = this.renderer;
    const prevTarget = r.getRenderTarget();
    const prevClear = r.getClearColor(new THREE.Color());
    const prevAlpha = r.getClearAlpha();
    const prevAuto = r.autoClear;
    const prevClip = r.localClippingEnabled;
    r.autoClear = false;
    r.localClippingEnabled = false;
    r.setClearColor(0x000000, 0);
    this.camera.updateMatrixWorld();
    capUniforms.uCapInvView.value.copy(this.camera.matrixWorld);
    capUniforms.uCapVerts.value = V;
    const bufs: (Float32Array | null)[] = [out.pos, out.nrm, out.col, out.uv];
    const tmp = new Float32Array(PER_PASS * 4);
    try {
      for (let off = 0; off < total; off += PER_PASS) {
        const n = Math.min(PER_PASS, total - off);
        capUniforms.uCapOffset.value = off;
        r.setRenderTarget(this.rt);
        r.clear(true, false, false);
        r.render(this.scene, this.camera);
        const rows = Math.ceil(n / SIDE);
        for (let k = 0; k < 4; k++) {
          const dst = bufs[k];
          if (!dst) continue;
          const view = rows * SIDE * 4 <= tmp.length ? tmp.subarray(0, rows * SIDE * 4) : tmp;
          r.readRenderTargetPixels(this.rt, 0, 0, SIDE, rows, view, undefined, k);
          dst.set(view.subarray(0, n * 4), off * 4);
        }
        this.passes++;
      }
      this.vertices += total;
    } finally {
      r.setRenderTarget(prevTarget);
      r.setClearColor(prevClear, prevAlpha);
      r.autoClear = prevAuto;
      r.localClippingEnabled = prevClip;
      this.scene.remove(pts);
      // release only what this capture created: the shared source attributes must keep their GPU buffers
      for (const name of Object.keys(cg.attributes)) if (!own.includes(name)) cg.deleteAttribute(name);
      cg.dispose();
      if (isIM) pts.dispatchEvent({ type: "dispose" } as never);
    }
    return out;
  }

  dispose(): void {
    this.rt.dispose();
    for (const m of this.mats.values()) m.dispose();
    this.mats.clear();
  }
}

function maxInstances(geo: THREE.BufferGeometry): number {
  let n = Infinity;
  for (const a of Object.values(geo.attributes)) {
    const ia = a as THREE.InstancedBufferAttribute;
    if (ia.isInstancedBufferAttribute) n = Math.min(n, Math.floor(ia.count * ia.meshPerAttribute));
  }
  return Number.isFinite(n) ? n : 1;
}

function compact(attr: THREE.InstancedBufferAttribute | THREE.BufferAttribute, select: Uint32Array): THREE.InstancedBufferAttribute {
  const s = attr.itemSize;
  const src = attr.array as ArrayLike<number>;
  const Ctor = (attr.array as Float32Array).constructor as Float32ArrayConstructor;
  const dst = new Ctor(select.length * s);
  for (let i = 0; i < select.length; i++) {
    const o = select[i] * s;
    for (let k = 0; k < s; k++) dst[i * s + k] = src[o + k];
  }
  return new THREE.InstancedBufferAttribute(dst, s, attr.normalized, (attr as THREE.InstancedBufferAttribute).meshPerAttribute ?? 1);
}
