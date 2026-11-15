import * as THREE from "three";
import { FullScreenQuad } from "three/examples/jsm/postprocessing/Pass.js";
import { DenoiseMaterial, PhysicalCamera, WebGLPathTracer } from "three-gpu-pathtracer";
import { GenerateMeshBVHWorker } from "three-mesh-bvh/worker";
import type { MeshBVH } from "three-mesh-bvh";
import type { Dataset } from "@/lib/types";
import { formatHist, tToHist } from "@/lib/years";
import type { Engine } from "../engine";
import { LOOKS } from "../look/presets";
import { buildEnvironment, type PhotoEnv } from "./env";
import { bakeSnapshot, type Snapshot, type SnapshotStats } from "./snapshot";
import { drawCaption, captionText } from "./caption";

/**
 * PHOTO MODE: a path-traced still of the current view at the current year.
 *
 * enter → wait for the camera to settle → bake a static snapshot of what the live frame shows (./snapshot.ts) →
 * build the BVH in a worker → progressive path tracing (three-gpu-pathtracer) with a sample counter and a target →
 * composite: the live view's distance haze and ground mist (from a depth pass; not path traced), exposure matched to
 * the live frame, the live view's tone mapper, optional edge-aware denoise → canvas.
 *
 * Any camera move or year change ends photo mode and returns to the live view (the snapshot only covers the view it
 * was baked for). Exiting disposes the BVH, every texture and render target, and restores labels, evidence tint and
 * the engine's own pipeline; camera, year and quality are never changed by photo mode.
 */

export type PhotoPhase = "settling" | "baking" | "building" | "compiling" | "rendering" | "done" | "error" | "closed";

export interface PhotoStatus {
  phase: PhotoPhase;
  message: string;
  samples: number;
  target: number;
  elapsed: number;
  /** Seconds from the first sample to the target, once reached. */
  timeToTarget: number | null;
  bakeMs: number;
  bvhMs: number;
  stats: SnapshotStats | null;
  resolution: 1 | 2;
  size: [number, number];
  denoise: boolean;
  dof: number;
  focus: number | null;
  exposure: number;
  exposureEV: number;
  env: string;
  /** Sky diagnostics: kind, rotation used vs the live background's, intensity scale, sun energy check, exposures. */
  envInfo?: Record<string, number | string | boolean>;
  caption: string;
  error?: string;
}

export interface PhotoOptions {
  target?: number;
  triBudget?: number;
  maxDist?: number;
  terrainTiles?: number;
  resolution?: 1 | 2;
}

/**
 * Composite: the live view's aerial perspective and ground mist on the photo's depth (parameters from
 * engine.getAtmosphere(), evaluated with the integral documented there), then the live camera response: exposure,
 * white balance, saturation, tone mapping (AgX with the preset's look, Neutral or ACES), the sRGB transfer, and
 * lift/gamma/gain in display space, as in look/post.ts's final pass. Output is display-encoded.
 * Not reproduced from the live pass: bloom, sun shafts, vignetting, film grain and screen-space occlusion (the path
 * tracer computes real occlusion).
 */
function compositeMaterial(): THREE.ShaderMaterial {
  const tm = THREE.ShaderChunk.tonemapping_pars_fragment.replace("uniform float toneMappingExposure;", "#define toneMappingExposure 1.0");
  return new THREE.ShaderMaterial({
    uniforms: {
      tPT: { value: null }, tDist: { value: null }, camPos: { value: new THREE.Vector3() }, invViewProj: { value: new THREE.Matrix4() },
      uAerial: { value: 0 }, uAer: { value: new THREE.Vector3() }, uHaze: { value: new THREE.Vector3() }, uExt: { value: new THREE.Vector3(1, 1, 1) },
      uInsAway: { value: new THREE.Color() }, uInsToward: { value: new THREE.Color() }, uInsDown: { value: new THREE.Color() }, uLobe: { value: 1 },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uGlow: { value: new THREE.Color() }, uG: { value: 0 },
      fogColor: { value: new THREE.Color() }, fogDensity: { value: 0 },
      mistParams: { value: new THREE.Vector4() }, mistColor: { value: new THREE.Color() },
      uExposure: { value: 1 }, uWhite: { value: new THREE.Color(1, 1, 1) }, uSat: { value: 1 }, uTone: { value: 0 }, uLook: { value: new THREE.Vector2(1, 1) },
      uLift: { value: new THREE.Vector3() }, uGamma: { value: new THREE.Vector3(1, 1, 1) }, uGain: { value: new THREE.Vector3(1, 1, 1) },
    },
    vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }",
    fragmentShader: /* glsl */ `
      #include <common>
      ${tm}
      uniform sampler2D tPT; uniform sampler2D tDist; uniform vec3 camPos; uniform mat4 invViewProj;
      uniform float uAerial; uniform vec3 uAer, uHaze, uExt, uInsAway, uInsToward, uInsDown, uSunDir, uGlow; uniform float uLobe, uG;
      uniform vec3 fogColor; uniform float fogDensity;
      uniform vec4 mistParams; uniform vec3 mistColor;
      uniform float uExposure, uSat; uniform vec3 uWhite, uLift, uGamma, uGain; uniform int uTone; uniform vec2 uLook;
      varying vec2 vUv;
      float layerTau( float L, float y0, float y1, vec3 p ) {
        float a = max( ( y0 - p.y ) / p.z, -1.5 );
        float b = max( ( y1 - p.y ) / p.z, -1.5 );
        float k = abs( b - a ) > 1e-3 ? ( exp( - a ) - exp( - b ) ) / ( b - a ) : exp( - a );
        return p.x * L * k;
      }
      vec3 aerial( vec3 col, vec3 dir, float d ) {
        float y0 = abs( camPos.y ), y1 = abs( camPos.y + dir.y * d );
        float tau = layerTau( d, y0, y1, uAer ) + layerTau( d, y0, y1, uHaze );
        vec3 T = exp( - tau * uExt );
        vec2 hz = dir.xz / max( 1e-4, length( dir.xz ) );
        vec2 sz = uSunDir.xz / max( 1e-4, length( uSunDir.xz ) );
        float lobe = pow( clamp( dot( hz, sz ) * 0.5 + 0.5, 0.0, 1.0 ), uLobe );
        vec3 ins = mix( uInsAway, uInsToward, lobe );
        ins = mix( ins, uInsDown, clamp( - dir.y * 1.4, 0.0, 0.65 ) );
        float mu = dot( dir, uSunDir );
        ins += uGlow * ( 1.0 - uG * uG ) / pow( max( 1e-4, 1.0 + uG * uG - 2.0 * uG * mu ), 1.5 ) * 0.0795775;
        return col * T + ins * ( 1.0 - T );
      }
      vec3 agxLook( vec3 color ) {
        // three.js's AgX with Blender's look stage (power, saturation in log space), as the live final pass uses it
        const mat3 AgXInsetMatrix = mat3( vec3( 0.856627153315983, 0.137318972929847, 0.11189821299995 ), vec3( 0.0951212405381588, 0.761241990602591, 0.0767994186031903 ), vec3( 0.0482516061458583, 0.101439036467562, 0.811302368396859 ) );
        const mat3 AgXOutsetMatrix = mat3( vec3( 1.1271005818144368, - 0.1413297634984383, - 0.14132976349843826 ), vec3( - 0.11060664309660323, 1.157823702216272, - 0.11060664309660294 ), vec3( - 0.016493938717834573, - 0.016493938717834257, 1.2519364065950405 ) );
        const float AgxMinEv = - 12.47393;
        const float AgxMaxEv = 4.026069;
        color = LINEAR_SRGB_TO_LINEAR_REC2020 * color;
        color = AgXInsetMatrix * color;
        color = max( color, 1e-10 );
        color = log2( color );
        color = ( color - AgxMinEv ) / ( AgxMaxEv - AgxMinEv );
        color = clamp( color, 0.0, 1.0 );
        color = agxDefaultContrastApprox( color );
        color = pow( max( color, 0.0 ), vec3( uLook.x ) );
        float luma = dot( color, vec3( 0.2126, 0.7152, 0.0722 ) );
        color = luma + uLook.y * ( color - luma );
        color = AgXOutsetMatrix * color;
        color = pow( max( vec3( 0.0 ), color ), vec3( 2.2 ) );
        color = LINEAR_REC2020_TO_LINEAR_SRGB * color;
        return clamp( color, 0.0, 1.0 );
      }
      vec3 oetf( vec3 c ) { return mix( c * 12.92, 1.055 * pow( c, vec3( 0.41666 ) ) - 0.055, step( 0.0031308, c ) ); }
      void main() {
        vec3 col = texture2D( tPT, vUv ).rgb;
        float d = texture2D( tDist, vUv ).r;
        if ( d < 1.0e8 ) {
          vec4 w = invViewProj * vec4( vUv * 2.0 - 1.0, 1.0, 1.0 );
          vec3 dir = normalize( w.xyz / w.w - camPos );
          if ( uAerial > 0.5 ) col = aerial( col, dir, d );
          else col = mix( col, fogColor, 1.0 - exp( - fogDensity * fogDensity * d * d ) );
          if ( mistParams.x > 0.0 ) {
            vec3 off = dir * d;
            float mistY0 = camPos.y - mistParams.y;
            float mistY1 = mistY0 + off.y;
            float mistLo = min( mistY0, mistY1 );
            float mistHi = max( mistY0, mistY1 );
            float mistH = mistParams.z;
            float mistBelow = mistHi - mistLo < 0.05 ? step( mistLo, 0.0 ) : clamp( - mistLo / ( mistHi - mistLo ), 0.0, 1.0 );
            float mistA = max( mistLo, 0.0 );
            float mistDa = mistHi - mistA;
            float mistAbove = mistDa > 0.05 ? mistH / mistDa * ( exp( - mistA / mistH ) - exp( - mistHi / mistH ) ) : exp( - mistA / mistH );
            float mistF = 1.0 - exp( - mistParams.x * d * ( mistBelow + ( 1.0 - mistBelow ) * mistAbove ) );
            col = mix( col, mistColor, mistF * mistParams.w );
          }
        }
        vec3 c = col * uExposure * uWhite;
        float l = dot( c, vec3( 0.2126, 0.7152, 0.0722 ) );
        c = max( mix( vec3( l ), c, uSat ), 0.0 );
        if ( uTone == 1 ) c = NeutralToneMapping( c );
        else if ( uTone == 2 ) c = ACESFilmicToneMapping( c );
        else c = agxLook( c );
        c = oetf( clamp( c, 0.0, 1.0 ) );
        c = pow( max( c * uGain + uLift * ( 1.0 - c ), 0.0 ), 1.0 / uGamma );
        gl_FragColor = vec4( c, 1.0 );
      }`,
    depthTest: false, depthWrite: false, toneMapped: false,
  });
}

function copyMaterial(): THREE.ShaderMaterial {
  // the composite is already display-encoded: copied as is (no colour-space conversion)
  return new THREE.ShaderMaterial({
    uniforms: { map: { value: null } },
    vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }",
    fragmentShader: "uniform sampler2D map; varying vec2 vUv; void main(){ gl_FragColor = vec4( texture2D( map, vUv ).rgb, 1.0 ); }",
    depthTest: false, depthWrite: false, toneMapped: false,
  });
}

function distanceMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: "varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }",
    fragmentShader: "varying vec3 vW; void main(){ gl_FragColor = vec4( length( vW - cameraPosition ), 0.0, 0.0, 1.0 ); }",
    side: THREE.DoubleSide,
  });
}

const lum = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const srgbToLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const median = (a: number[]) => {
  const s = a.filter((x) => Number.isFinite(x)).sort((x, y) => x - y);
  return s.length ? s[s.length >> 1] : 0;
};

/** The photo mode that currently holds the engine's render override (only it may release it). */
let owner: PhotoMode | null = null;

export class PhotoMode {
  private status: PhotoStatus;
  private listeners = new Set<(s: PhotoStatus) => void>();
  private renderer: THREE.WebGLRenderer;
  private liveScene: THREE.Scene;
  private liveCam: THREE.PerspectiveCamera;
  private camKey: number[] = [];
  private t0: number;
  private labelsWere = true;
  private evidenceWere = false;
  private snapshot: Snapshot | null = null;
  private env: PhotoEnv | null = null;
  private pt: WebGLPathTracer | null = null;
  private worker: GenerateMeshBVHWorker | null = null;
  private ptScene = new THREE.Scene();
  private cam = new PhysicalCamera();
  private distRT: THREE.WebGLRenderTarget | null = null;
  private compRT: THREE.WebGLRenderTarget | null = null;
  private comp: FullScreenQuad | null = null;
  private copy: FullScreenQuad | null = null;
  private denoiseQ: FullScreenQuad | null = null;
  private dist = distanceMaterial();
  private liveLum = 0;
  private liveExposure = 1;
  private sun: ReturnType<Engine["getSun"]> | null = null;
  private atmo: ReturnType<Engine["getAtmosphere"]> | null = null;
  private exposure = 1;
  private exposureEV = 0;
  private matched = false;
  private dirty = true;
  private spf = 1;
  private lastFrame = 0;
  private startedAt = 0;
  private closed = false;
  private settle = 0;
  private lastShownSamples = -1;
  private arrayTargets: THREE.WebGLRenderTarget[] = [];

  constructor(private engine: Engine, private ds: Dataset, private opts: PhotoOptions = {}) {
    const ctx = engine.getRenderContext();
    this.renderer = ctx.renderer;
    this.liveScene = ctx.scene;
    this.liveCam = ctx.camera;
    this.t0 = engine.getT();
    const caption = captionText(ds.site.name, formatHist(tToHist(this.t0)));
    this.status = {
      phase: "settling", message: "Holding the view…", samples: 0, target: opts.target ?? 160, elapsed: 0, timeToTarget: null, bakeMs: 0, bvhMs: 0,
      stats: null, resolution: opts.resolution ?? 1, size: [0, 0], denoise: true, dof: 0, focus: null, exposure: 1, exposureEV: 0, env: "", caption,
    };
  }

  onStatus(cb: (s: PhotoStatus) => void): () => void {
    this.listeners.add(cb);
    cb({ ...this.status });
    return () => this.listeners.delete(cb);
  }
  getStatus(): PhotoStatus {
    return { ...this.status };
  }
  private set(p: Partial<PhotoStatus>): void {
    Object.assign(this.status, p);
    const s = { ...this.status };
    for (const cb of this.listeners) cb(s);
  }

  /** The live camera's pose and lens, for change detection (compared with a tolerance, see sameCamera). */
  private cameraKey(): number[] {
    const c = this.liveCam;
    c.updateMatrixWorld();
    const e = c.matrixWorld.elements;
    return [e[0], e[1], e[2], e[4], e[5], e[6], e[8], e[9], e[10], e[12], e[13], e[14], c.fov, c.aspect];
  }
  private static sameCamera(a: number[], b: number[]): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > (i >= 9 && i < 12 ? 2e-3 : 2e-5)) return false;
    return true;
  }

  /** Enter photo mode. Resolves once the image has started to accumulate (or failed). */
  async start(): Promise<void> {
    const e = this.engine;
    e.pause();
    if (owner && owner !== this) owner.exit("Another photo started.");
    const st = e.getState();
    this.labelsWere = st.labels;
    this.evidenceWere = st.evidence;
    if (st.labels) e.setLabels(false);
    if (st.evidence) e.setEvidence(false);
    owner = this;
    (window as unknown as { __lttPhoto?: PhotoMode }).__lttPhoto = this;
    e.setRenderOverride(this.override);
    // wait for orbit damping to come to rest: the snapshot is only valid for one exact camera
    let key = this.cameraKey();
    for (let i = 0; i < 120 && this.settle < 8; i++) {
      await new Promise((r) => requestAnimationFrame(r));
      if (this.closed) return;
      const k = this.cameraKey();
      this.settle = PhotoMode.sameCamera(k, key) ? this.settle + 1 : 0;
      key = k;
    }
    this.camKey = key;
    try {
      // the live frame (labels hidden) for exposure matching
      this.liveLum = this.measureLive();
      // the live light and atmosphere, through the engine's accessors (copies)
      this.sun = this.engine.getSun();
      this.atmo = this.engine.getAtmosphere();
      this.liveExposure = this.atmo.exposure > 0 ? this.atmo.exposure : this.renderer.toneMappingExposure;
      this.set({ phase: "baking", message: "Baking a static copy of the view…" });
      const terrain = e.terrain;
      const yp = terrain.yearParams(this.t0);
      const size = this.renderer.getSize(new THREE.Vector2());
      const res = this.status.resolution;
      this.snapshot = await bakeSnapshot(
        { renderer: this.renderer, scene: this.liveScene, camera: this.liveCam },
        {
          triBudget: this.opts.triBudget ?? 4_000_000, maxDist: this.opts.maxDist ?? 7000, nearAll: 70, minPx: 0.6, terrainTiles: this.opts.terrainTiles ?? 40,
          heightPx: size.y * res, hasRiver: terrain.hasRiver, // diffuse albedo of the water body: the live water's silty Thames default, or the site's colour as it uses it
          waterColor: this.ds.site.water?.color ? new THREE.Color(this.ds.site.water.color).multiplyScalar(0.55) : new THREE.Color(0.072, 0.07, 0.042),
          groundAt: (x, z) => terrain.heightFrom(terrain.staticSample(x, z), yp),
          onProgress: (m) => this.set({ message: m }),
        },
      );
      if (this.closed) return this.disposeAll();
      if (!PhotoMode.sameCamera(this.cameraKey(), this.camKey) || this.engine.getT() !== this.t0) return this.exit("The view changed while baking.");
      this.set({ bakeMs: this.snapshot.stats.bakeMs, stats: this.snapshot.stats, phase: "building", message: `Building the ray-tracing structure for ${(this.snapshot.stats.triangles / 1e6).toFixed(2)} M triangles…` });

      // path-tracing scene: snapshot + sky (+ sun light where the sky has no usable sun)
      this.env = buildEnvironment(this.renderer, this.liveScene, this.sun);
      const s = this.ptScene;
      s.add(...this.snapshot.scene.children);
      s.environment = this.env.texture;
      s.background = this.env.texture;
      s.environmentIntensity = this.env.intensity;
      s.backgroundIntensity = this.env.backgroundIntensity;
      s.environmentRotation.set(0, this.env.rotationY, 0);
      s.backgroundRotation.set(0, this.env.rotationY, 0);
      if (this.env.sun) s.add(this.env.sun, this.env.sun.target);
      this.syncCamera();

      const pt = new WebGLPathTracer(this.renderer);
      this.pt = pt;
      pt.renderToCanvas = false;
      pt.rasterizeScene = false;
      pt.renderDelay = 0;
      pt.minSamples = 1;
      pt.fadeDuration = 0;
      pt.dynamicLowRes = false;
      pt.bounces = 5;
      pt.transmissiveBounces = 3;
      pt.filterGlossyFactor = 0.5;
      pt.multipleImportanceSampling = true;
      pt.tiles.set(2, 2);
      // every texture is packed into one array of equal layers: keep the layer size modest when there are many
      const texCount = new Set<string>();
      for (const c of s.children) {
        const m = (c as THREE.Mesh).material as THREE.MeshPhysicalMaterial | undefined;
        if (!m) continue;
        for (const t of [m.map, m.normalMap, m.roughnessMap, m.metalnessMap]) if (t) texCount.add(t.source.uuid);
      }
      const layer = texCount.size > 110 ? 512 : 1024;
      pt.textureSize.set(layer, layer);
      this.applyScale();
      this.worker = new GenerateMeshBVHWorker();
      pt.setBVHWorker(this.worker);
      const tb = performance.now();
      // The path tracer's texture arrays are render targets whose texture does not point back at its target (three's
      // array render target replaces its texture), so the target can only be released through the target itself:
      // note it when the path tracer first renders into it.
      const ptMat = (pt as unknown as { _pathTracer: { material: Record<string, unknown> } })._pathTracer.material;
      const watched = [ptMat.textures, ptMat.iesProfiles];
      const origSetRT = this.renderer.setRenderTarget;
      const setRT = origSetRT.bind(this.renderer);
      this.renderer.setRenderTarget = (rt, ...rest) => {
        if (rt && watched.includes((rt as THREE.WebGLRenderTarget).texture) && !this.arrayTargets.includes(rt as THREE.WebGLRenderTarget)) this.arrayTargets.push(rt as THREE.WebGLRenderTarget);
        return setRT(rt, ...rest);
      };
      try {
        await pt.setSceneAsync(s, this.cam, {
          onProgress: (v: number) => this.set({ message: `Building the ray-tracing structure… ${Math.round(v * 100)}%` }),
        });
      } finally {
        this.renderer.setRenderTarget = origSetRT;
      }
      if (this.closed) return this.disposeAll();
      this.set({ bvhMs: Math.round(performance.now() - tb), env: this.env.kind, envInfo: { ...this.env.info, meteredExposure: +this.liveExposure.toFixed(4) } });
      (this.worker as unknown as { dispose(): void }).dispose();
      this.worker = null;
      if (!PhotoMode.sameCamera(this.cameraKey(), this.camKey) || this.engine.getT() !== this.t0) return this.exit("The view changed while building.");

      // display chain
      this.comp = new FullScreenQuad(compositeMaterial());
      this.copy = new FullScreenQuad(copyMaterial());
      const dn = new DenoiseMaterial({ sigma: 2.5, threshold: 0.05, kSigma: 1 });
      dn.toneMapped = false;
      // the composite is display-encoded already: no second colour-space conversion
      dn.fragmentShader = dn.fragmentShader.replace("#include <colorspace_fragment>", "");
      this.denoiseQ = new FullScreenQuad(dn);
      this.exposure = this.liveExposure;
      this.allocTargets();
      this.set({ phase: "compiling", message: "Compiling the path tracer…", size: this.ptSize() });
      this.startedAt = 0;
      (window as unknown as { __lttPhoto?: PhotoMode }).__lttPhoto = this;
    } catch (err) {
      console.error(err);
      this.set({ phase: "error", message: "Photo mode could not start.", error: (err as Error).message || String(err) });
      this.disposeAll(true);
    }
  }

  private ptSize(): [number, number] {
    const v = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const k = this.pt ? this.pt.renderScale : 1;
    return [Math.floor(v.x * k), Math.floor(v.y * k)];
  }

  private applyScale(): void {
    if (!this.pt) return;
    // resolution 1 = the canvas size in CSS pixels, 2 = twice that (the drawing buffer may already be larger)
    this.pt.renderScale = this.status.resolution / this.renderer.getPixelRatio();
  }

  private syncCamera(): void {
    const c = this.liveCam;
    c.updateMatrixWorld();
    const p = this.cam;
    p.fov = c.fov;
    p.aspect = c.aspect;
    p.near = Math.min(c.near, 0.5);
    p.far = 40000;
    p.filmGauge = c.filmGauge;
    p.position.copy(c.position);
    p.quaternion.copy(c.quaternion);
    p.updateProjectionMatrix();
    p.updateMatrixWorld();
    p.fStop = this.status.dof > 0 ? this.status.dof : 1e6;
    p.apertureBlades = 6;
    if (this.status.focus) p.focusDistance = this.status.focus;
  }

  private allocTargets(): void {
    const [w, h] = this.ptSize();
    this.distRT?.dispose();
    this.compRT?.dispose();
    this.distRT = new THREE.WebGLRenderTarget(w, h, { type: THREE.FloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: true });
    this.compRT = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false });
    // distance pass for haze and mist (pinhole, no alpha cut-outs: haze is invisible at the range where that matters)
    const r = this.renderer;
    const prev = r.getRenderTarget();
    const pc = r.getClearColor(new THREE.Color());
    const pa = r.getClearAlpha();
    const s = this.ptScene;
    const bg = s.background;
    s.background = null;
    s.overrideMaterial = this.dist;
    r.setClearColor(new THREE.Color(1e9, 0, 0), 1);
    r.setRenderTarget(this.distRT);
    r.clear(true, true, false);
    r.render(s, this.cam);
    s.overrideMaterial = null;
    s.background = bg;
    r.setRenderTarget(prev);
    r.setClearColor(pc, pa);
    this.dirty = true;
  }

  /** Median display luminance (linear) of the live frame, read from the canvas. */
  private measureLive(): number {
    try {
      const src = this.renderer.domElement;
      const cv = document.createElement("canvas");
      cv.width = 192;
      cv.height = 108;
      const ctx = cv.getContext("2d", { willReadFrequently: true })!;
      ctx.drawImage(src, 0, 0, cv.width, cv.height);
      const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
      const l: number[] = [];
      for (let i = 0; i < d.length; i += 4) l.push(lum(srgbToLinear(d[i] / 255), srgbToLinear(d[i + 1] / 255), srgbToLinear(d[i + 2] / 255)));
      return median(l);
    } catch {
      return 0;
    }
  }

  private uniformsFor(exposure: number): void {
    const u = (this.comp!.material as THREE.ShaderMaterial).uniforms;
    u.tPT.value = this.pt!.target.texture;
    u.tDist.value = this.distRT!.texture;
    (u.camPos.value as THREE.Vector3).copy(this.cam.position);
    (u.invViewProj.value as THREE.Matrix4).multiplyMatrices(this.cam.matrixWorld, this.cam.projectionMatrixInverse);
    // atmosphere and sun from the engine's accessors (copies; the photo's units are the live scene units)
    const a = this.atmo;
    u.uAerial.value = a && a.enabled ? 1 : 0;
    if (a) {
      (u.uAer.value as THREE.Vector3).set(a.aerosol.density, a.aerosol.base, Math.max(1e-3, a.aerosol.scaleHeight));
      (u.uHaze.value as THREE.Vector3).set(a.haze.density, a.haze.base, Math.max(1e-3, a.haze.scaleHeight));
      (u.uExt.value as THREE.Vector3).set(...a.extinction);
      (u.uInsAway.value as THREE.Color).copy(a.inscatterAway);
      (u.uInsToward.value as THREE.Color).copy(a.inscatterToward);
      (u.uInsDown.value as THREE.Color).copy(a.inscatterDown);
      u.uLobe.value = a.lobePower;
      (u.uGlow.value as THREE.Color).copy(a.sunGlow.color);
      u.uG.value = a.sunGlow.g;
      if (a.mist) {
        (u.mistParams.value as THREE.Vector4).set(a.mist.density, a.mist.base, a.mist.scaleHeight, a.mist.strength);
        (u.mistColor.value as THREE.Color).copy(a.mist.color);
      } else (u.mistParams.value as THREE.Vector4).set(0, 0, 1, 0);
    }
    if (this.sun) (u.uSunDir.value as THREE.Vector3).copy(this.sun.direction);
    const fog = this.liveScene.fog as THREE.FogExp2 | null;
    (u.fogColor.value as THREE.Color).copy(fog ? fog.color : new THREE.Color(0, 0, 0));
    u.fogDensity.value = fog && fog.isFogExp2 ? fog.density : 0;
    // the live camera response: the preset's grade, the live tone mapper
    u.uExposure.value = exposure;
    const g = LOOKS[this.engine.getLook()] ?? LOOKS.clear;
    (u.uWhite.value as THREE.Color).setRGB(...g.white);
    u.uSat.value = g.saturation;
    (u.uLift.value as THREE.Vector3).set(...g.lift);
    (u.uGamma.value as THREE.Vector3).set(...g.gamma);
    (u.uGain.value as THREE.Vector3).set(...g.gain);
    (u.uLook.value as THREE.Vector2).set(g.contrast, g.agxSat);
    const tone = a?.toneMap ?? "agx";
    u.uTone.value = tone === "neutral" ? 1 : tone === "aces" ? 2 : 0;
  }

  /** Composite into compRT, then copy/denoise into `target` (null = canvas). */
  private present(target: THREE.WebGLRenderTarget | null, exposure = this.exposure): void {
    const r = this.renderer;
    const prev = r.getRenderTarget();
    const prevTM = r.toneMapping;
    const prevAuto = r.autoClear;
    r.autoClear = true;
    this.uniformsFor(exposure);
    r.setRenderTarget(this.compRT);
    this.comp!.render(r);
    const n = this.pt!.samples;
    let q = this.copy!;
    if (this.status.denoise) {
      const dm = this.denoiseQ!.material as DenoiseMaterial & { sigma: number; threshold: number; map: THREE.Texture | null };
      // stronger while the image is still grainy, light once it has converged
      dm.sigma = n < 16 ? 4 : n < 64 ? 2.6 : 1.6;
      dm.threshold = n < 16 ? 0.09 : n < 64 ? 0.06 : 0.035;
      dm.map = this.compRT!.texture;
      q = this.denoiseQ!;
    } else (this.copy!.material as THREE.ShaderMaterial).uniforms.map.value = this.compRT!.texture;
    r.toneMapping = THREE.NoToneMapping;
    r.setRenderTarget(target);
    q.render(r);
    r.toneMapping = prevTM;
    r.setRenderTarget(prev);
    r.autoClear = prevAuto;
  }

  /** Match the photo's mid-tones to the live frame's (bisection on exposure, through the real display chain). */
  private matchExposure(): void {
    if (!(this.liveLum > 0)) return;
    const w = 192, h = 108;
    const rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.FloatType, depthBuffer: false });
    const r = this.renderer;
    const buf = new Float32Array(w * h * 4);
    const prev = r.getRenderTarget();
    const measure = (e: number) => {
      this.uniformsFor(e);
      r.setRenderTarget(rt);
      this.comp!.render(r);
      r.readRenderTargetPixels(rt, 0, 0, w, h, buf);
      const l: number[] = [];
      for (let i = 0; i < buf.length; i += 4) l.push(lum(srgbToLinear(buf[i]), srgbToLinear(buf[i + 1]), srgbToLinear(buf[i + 2])));
      return median(l);
    };
    let lo = Math.log2(this.liveExposure) - 5, hi = Math.log2(this.liveExposure) + 5;
    for (let i = 0; i < 12; i++) {
      const mid = (lo + hi) / 2;
      if (measure(2 ** mid) < this.liveLum) lo = mid;
      else hi = mid;
    }
    r.setRenderTarget(prev);
    rt.dispose();
    this.exposure = 2 ** ((lo + hi) / 2);
    this.matched = true;
    this.set({ envInfo: { ...(this.status.envInfo ?? {}), matchedExposure: +this.exposure.toFixed(4), matchedOverMetered: +(this.exposure / this.liveExposure).toFixed(3) } });
  }

  private override = (): boolean => {
    if (this.closed) return false;
    // leaving the view or the year ends photo mode
    if (this.camKey.length && (!PhotoMode.sameCamera(this.cameraKey(), this.camKey) || this.engine.getT() !== this.t0)) {
      queueMicrotask(() => this.exit("The view or the year changed."));
      return false;
    }
    const pt = this.pt;
    if (!pt || !this.comp || this.status.phase === "error") return false;
    const now = performance.now();
    const dt = now - (this.lastFrame || now);
    this.lastFrame = now;
    const target = this.status.target;
    if (pt.samples < target) {
      if (dt < 40) this.spf = Math.min(this.spf + 1, 24);
      else if (dt > 80) this.spf = Math.max(1, this.spf - 1);
      for (let i = 0; i < this.spf && pt.samples < target; i++) pt.renderSample();
      if ((pt as unknown as { isCompiling: boolean }).isCompiling) {
        if (this.status.phase !== "compiling") this.set({ phase: "compiling", message: "Compiling the path tracer…" });
        return false;
      }
      if (!this.startedAt && pt.samples > 0) this.startedAt = now;
      if (!this.matched && pt.samples >= 6) this.matchExposure();
      this.dirty = true;
    }
    if (pt.samples === 0) return false;
    const samples = Math.floor(pt.samples);
    if (this.dirty) {
      this.present(null, this.exposure * 2 ** this.exposureEV);
      this.dirty = false;
    }
    if (samples !== this.lastShownSamples || this.status.phase === "compiling") {
      this.lastShownSamples = samples;
      const elapsed = this.startedAt ? (now - this.startedAt) / 1000 : 0;
      const done = samples >= target;
      this.set({
        phase: done ? "done" : "rendering", samples, elapsed: +elapsed.toFixed(1), exposure: +(this.exposure * 2 ** this.exposureEV).toFixed(3),
        timeToTarget: done ? this.status.timeToTarget ?? +elapsed.toFixed(1) : null,
        message: done ? "Converged." : "Path tracing…",
      });
    }
    return true;
  };

  private restart(): void {
    if (!this.pt) return;
    this.syncCamera();
    this.pt.updateCamera();
    this.startedAt = 0;
    this.lastShownSamples = -1;
    this.dirty = true;
    this.set({ samples: 0, timeToTarget: null, phase: "rendering", message: "Path tracing…" });
  }

  setTarget(n: number): void {
    this.set({ target: Math.max(1, Math.round(n)), timeToTarget: null });
    this.lastShownSamples = -1;
  }
  setDenoise(on: boolean): void {
    this.set({ denoise: on });
    this.dirty = true;
  }
  setExposureEV(ev: number): void {
    this.exposureEV = ev;
    this.set({ exposureEV: ev });
    this.dirty = true;
  }
  /** f-number for depth of field, 0 = off (pinhole). */
  setDof(fStop: number): void {
    this.set({ dof: fStop });
    if (fStop > 0 && !this.status.focus) this.focusAtNdc(0, 0);
    this.restart();
  }
  setResolution(res: 1 | 2): void {
    if (res === this.status.resolution || !this.pt) return;
    this.set({ resolution: res });
    this.applyScale();
    // the next renderSample resizes the targets; the distance pass must follow
    this.pt.renderSample();
    this.allocTargets();
    this.set({ size: this.ptSize() });
    this.restart();
  }

  /** Pick the focus distance at a point of the image (client coordinates). */
  focusAt(clientX: number, clientY: number): number | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    return this.focusAtNdc(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
  }
  private focusAtNdc(x: number, y: number): number | null {
    const bvh = (this.pt as unknown as { _generator?: { bvh?: MeshBVH } })?._generator?.bvh;
    if (!bvh || typeof (bvh as MeshBVH).raycastFirst !== "function") return null;
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(x, y), this.cam);
    const hit = (bvh as MeshBVH).raycastFirst(ray.ray, THREE.DoubleSide);
    if (!hit) return null;
    const d = hit.distance;
    this.set({ focus: +d.toFixed(2) });
    if (this.status.dof > 0) this.restart();
    return d;
  }

  /** The finished image as a PNG, at the path tracer's resolution, with the caption burned in unless asked not to. */
  async toBlob(caption = true): Promise<Blob> {
    if (!this.pt || !this.compRT) throw new Error("Photo mode is not ready.");
    const [w, h] = this.ptSize();
    const rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.UnsignedByteType, depthBuffer: false });
    this.present(rt, this.exposure * 2 ** this.exposureEV);
    const px = new Uint8Array(w * h * 4);
    this.renderer.readRenderTargetPixels(rt, 0, 0, w, h, px);
    rt.dispose();
    const cv = document.createElement("canvas");
    cv.width = w;
    cv.height = h;
    const ctx = cv.getContext("2d")!;
    const img = ctx.createImageData(w, h);
    for (let y = 0; y < h; y++) img.data.set(px.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);
    ctx.putImageData(img, 0, 0);
    if (caption) drawCaption(ctx, w, h, this.status.caption);
    this.dirty = true;
    return await new Promise<Blob>((res, rej) => cv.toBlob((b) => (b ? res(b) : rej(new Error("PNG encoding failed"))), "image/png"));
  }

  fileName(): string {
    const y = tToHist(this.t0);
    return `${this.ds.site.id}-${y < 0 ? `${-y}bce` : `${y}ce`}-reconstruction.png`;
  }

  /** Diagnostics: the terrain albedo tiles as small PNG data URLs (nearest the camera first). */
  debugTiles(max = 6, px = 256): { x0: number; z0: number; s: number; url: string }[] {
    const tiles = [...(this.snapshot?.tiles ?? [])].sort((a, b) => a.s - b.s).slice(0, max);
    const r = this.renderer;
    const rt = new THREE.WebGLRenderTarget(px, px, { colorSpace: THREE.SRGBColorSpace });
    const q = new FullScreenQuad(new THREE.MeshBasicMaterial());
    const buf = new Uint8Array(px * px * 4);
    const prev = r.getRenderTarget();
    const out = tiles.map((t) => {
      (q.material as THREE.MeshBasicMaterial).map = t.rt.texture;
      (q.material as THREE.MeshBasicMaterial).needsUpdate = true;
      r.setRenderTarget(rt);
      q.render(r);
      r.readRenderTargetPixels(rt, 0, 0, px, px, buf);
      const cv = document.createElement("canvas");
      cv.width = cv.height = px;
      const ctx = cv.getContext("2d")!;
      const img = ctx.createImageData(px, px);
      for (let y = 0; y < px; y++) img.data.set(buf.subarray((px - 1 - y) * px * 4, (px - y) * px * 4), y * px * 4);
      ctx.putImageData(img, 0, 0);
      return { x0: t.x0, z0: t.z0, s: t.s, url: cv.toDataURL() };
    });
    r.setRenderTarget(prev);
    rt.dispose();
    (q.material as THREE.Material).dispose();
    q.dispose();
    this.dirty = true;
    return out;
  }

  /** Diagnostics for tests: memory counters of the renderer. */
  memory(): { geometries: number; textures: number; programs: number } {
    const m = this.renderer.info.memory;
    return { geometries: m.geometries, textures: m.textures, programs: this.renderer.info.programs?.length ?? 0 };
  }

  /** Leave photo mode: release everything and give the frame back to the engine. */
  exit(reason?: string): void {
    if (this.closed) return;
    this.closed = true;
    this.disposeAll();
    this.set({ phase: "closed", message: reason ?? "Back to the live view." });
    this.listeners.clear();
  }

  private disposeAll(keepStatus = false): void {
    void keepStatus;
    if (owner === this) {
      owner = null;
      this.engine.setRenderOverride(null);
      if (this.labelsWere && !this.engine.getState().labels) this.engine.setLabels(true);
      if (this.evidenceWere && !this.engine.getState().evidence) this.engine.setEvidence(true);
    }
    if (this.worker) {
      (this.worker as unknown as { dispose(): void }).dispose();
      this.worker = null;
    }
    const pt = this.pt as unknown as {
      dispose(): void;
      _lowResPathTracer?: { dispose(): void; material: unknown };
      _pathTracer?: { material: THREE.ShaderMaterial & Record<string, unknown> };
      _generator?: { geometry?: THREE.BufferGeometry; bvh?: unknown; staticGeometryGenerator?: { _intermediateGeometry?: Map<unknown, THREE.BufferGeometry> } };
      _colorBackground?: THREE.Texture;
      _internalBackground?: THREE.Texture;
    } | null;
    if (pt) {
      const mat = pt._pathTracer?.material;
      if (mat) {
        // the path-tracing material owns data textures (BVH, attributes, materials, texture array, env CDFs, lights)
        // (some of these helpers have no dispose of their own, e.g. the lights struct's data texture: sweep one level down)
        // A texture that belongs to a render target (the texture arrays, the Sobol map) is released through its
        // target: three.js frees a render target's GPU texture only when the target itself is disposed.
        const release = (t: THREE.Texture) => {
          const rt = (t as THREE.Texture & { renderTarget?: { dispose(): void } | null }).renderTarget;
          if (rt) rt.dispose();
          else t.dispose();
        };
        for (const u of Object.values(mat.uniforms ?? {})) {
          const v = (u as THREE.IUniform).value as Record<string, unknown> | null;
          if (!v || typeof v !== "object") continue;
          if ((v as unknown as THREE.Texture).isTexture) release(v as unknown as THREE.Texture);
          else if (typeof (v as { dispose?: unknown }).dispose === "function") (v as unknown as { dispose(): void }).dispose();
          for (const x of Object.values(v)) if (x && (x as THREE.Texture).isTexture) release(x as THREE.Texture);
        }
        mat.dispose();
      }
      for (const rt of this.arrayTargets) rt.dispose();
      this.arrayTargets = [];
      try {
        pt._lowResPathTracer?.dispose();
      } catch {
        /* shares the material, already disposed */
      }
      pt._colorBackground?.dispose();
      pt._internalBackground?.dispose();
      pt.dispose();
      const gen = pt._generator;
      if (gen) {
        gen.geometry?.dispose();
        gen.bvh = null;
        const inter = gen.staticGeometryGenerator?._intermediateGeometry;
        if (inter) {
          for (const g of inter.values()) g.dispose();
          inter.clear();
        }
      }
      this.pt = null;
    }
    // the snapshot's meshes (now children of ptScene), their geometry, materials, texture clones and terrain tiles
    this.snapshot?.dispose();
    this.ptScene.clear();
    this.ptScene.environment = null;
    this.ptScene.background = null;
    this.snapshot = null;
    this.env?.dispose();
    this.env = null;
    this.distRT?.dispose();
    this.compRT?.dispose();
    this.distRT = this.compRT = null;
    for (const q of [this.comp, this.copy, this.denoiseQ]) {
      if (!q) continue;
      (q as unknown as { material: THREE.Material }).material.dispose();
      q.dispose();
    }
    this.comp = this.copy = this.denoiseQ = null;
    this.dist.dispose();
    const w = window as unknown as { __lttPhoto?: PhotoMode };
    if (w.__lttPhoto === this) w.__lttPhoto = undefined;
  }
}
