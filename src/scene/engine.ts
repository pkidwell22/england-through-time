import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { Sky } from "three/examples/jsm/objects/Sky.js";
import { HDRLoader } from "three/examples/jsm/loaders/HDRLoader.js";
import type { CameraView, Dataset, Episode, Landmark, SiteAtmosphere, Zone } from "@/lib/types";
import { initialYear } from "@/lib/data";
import { TerrainModel } from "@/lib/terrain";
import { TimeScale, histToT } from "@/lib/years";
import { registerDistrictBuilders } from "./district";
import { registerPrehistoricBuilders } from "./prehistoric";
import { FabricLayer } from "./fabric";
import { FireFx } from "./fx";
import { LandmarkLayer } from "./landmarks";
import { lifeUniforms } from "./life";
import { TERRAIN_ASSETS, scanTexture, setAnisotropy } from "./materials";
import { MIST_COLOR, MIST_PARAMS } from "./mist";
import { TerrainMesh } from "./terrainMesh";
import { buildTrees } from "./vegetation";
import { EXTRA_FACTORIES, type Extra } from "./extras";
import { registerLandmarkDetail } from "./landmarkDetail";
import { registerPopulace } from "./populace";
import { registerGroundDetail } from "./groundDetail";
import { registerProps } from "./props";
import { registerVessels } from "./vessels";
import { LOOK_A, LOOK_HEMI, installLookShaders } from "./look/atmosphere";
import { LookPost, type Grade, type PostTier, type ToneMap } from "./look/post";
import { LOOKS, type LookId, type LookPreset, skyUrl } from "./look/presets";
import { analyticRig, computeRig, driftClouds, writeAtmosphere, type Rig } from "./look/rig";
import { SunCascades } from "./look/shadows";
import { analyseSky, lightingSky, meanLinearColor, type SkyInfo } from "./look/sky";
import { RiverWater } from "./look/water";

export type Quality = "low" | "medium" | "high" | "cinematic";
export const QUALITIES: Quality[] = ["low", "medium", "high", "cinematic"];
export type NavMode = "orbit" | "walk";
/** 0 = "auto": constant slider speed (whole timeline in AUTO_SECONDS). Otherwise years per second. */
export type Speed = number;
export const AUTO_SECONDS = 150;
export type { LookId } from "./look/presets";

export interface EngineState {
  t: number;
  playing: boolean;
  direction: 1 | -1;
  speed: Speed;
  rate: number;
  mode: NavMode;
  quality: Quality;
  fps: number;
  inDistrict: boolean;
  labels: boolean;
  evidence: boolean;
  ready: boolean;
  /** Time-of-day / weather look (sites with their own dated atmosphere keep theirs whatever this says). */
  look: LookId;
}

export type Selection = { type: "landmark"; landmark: Landmark } | { type: "zone"; zone: Zone } | { type: "episode"; episode: Episode } | null;

/** Sign convention between three.js background rotation and equirect longitude (verified visually). */
const SKY_SIGN = -1;

interface Tier {
  dpr: number;
  density: number;
  trees: number;
  terrain: number;
  /** Shadow cascades (map sizes); empty = no sun shadows. */
  cascades: number[];
  /** Distance covered by the cascades as a multiple of the camera's distance to its target (clamped). */
  post: PostTier | null;
  /** Water mirror: resolution as a fraction of the screen (0 = sky only), refresh interval in frames, fine ripples. */
  reflection: [number, number, number];
  grain: number;
  vignette: number;
}

const QUALITY: Record<Quality, Tier> = {
  low: { dpr: 1, density: 0.6, trees: 0.35, terrain: 0, cascades: [], post: null, reflection: [0, 1, 0], grain: 0, vignette: 0 },
  medium: {
    dpr: 1.5, density: 1, trees: 0.7, terrain: 1, cascades: [2048],
    post: { msaa: 4, taa: false, ao: 0.5, aoSamples: 6, bloomMips: 4, shafts: false, dof: false },
    reflection: [0.4, 3, 0.6], grain: 0.008, vignette: 0.07,
  },
  high: {
    dpr: 2, density: 1, trees: 1, terrain: 2, cascades: [2048, 2048],
    post: { msaa: 4, taa: true, ao: 0.5, aoSamples: 8, bloomMips: 5, shafts: true, dof: false },
    reflection: [0.5, 2, 1], grain: 0.009, vignette: 0.08,
  },
  cinematic: {
    dpr: 2, density: 1, trees: 1, terrain: 2, cascades: [4096, 2048, 2048],
    post: { msaa: 4, taa: true, ao: 1, aoSamples: 12, bloomMips: 6, shafts: true, dof: true },
    reflection: [0.75, 1, 1], grain: 0.01, vignette: 0.08,
  },
};

interface LoadedSky {
  tex: THREE.DataTexture;
  light: THREE.DataTexture;
  info: SkyInfo;
}

export class Engine {
  readonly scale: TimeScale;
  readonly terrain: TerrainModel;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private sun = new THREE.DirectionalLight(0xfff0d8, 4.6);
  private sunDir = new THREE.Vector3();
  private cascades: SunCascades;
  private water!: RiverWater;
  private clouds!: THREE.Mesh;
  private sky!: Sky;
  private post: LookPost;
  private skyReady = false;
  private skies = new Map<string, Promise<LoadedSky | null>>();
  private skyKey = "";
  private rig!: Rig;
  private preset: LookPreset = LOOKS.clear;
  private toneMap: ToneMap = "agx";
  private terrainMesh!: TerrainMesh;
  private landmarks!: LandmarkLayer;
  private fabric!: FabricLayer;
  private trees!: THREE.Group;
  private fire!: FireFx;
  private extras: Extra[] = [];
  private content = new THREE.Group();
  private districtFrame: THREE.LineSegments | null = null;
  private atmo: SiteAtmosphere;
  private fogBase = 0.00014;
  private fogColor = new THREE.Color(0xa9bccb);
  private mist: { t0: number; t1: number; density: number; base: number; scale: number; color: THREE.Color; always?: boolean } | null = null;
  private siteMist: Engine["mist"] = null;
  private mistNow = -1;
  private hazeBase = 0;
  private hemi = new THREE.HemisphereLight(0xcfe2f5, 0x6a6048, 0.5);
  private labelLayer: HTMLDivElement;
  private labelPool: HTMLDivElement[] = [];
  private raf = 0;
  private last = 0;
  private lastEmit = 0;
  private lastTerrain = 0;
  private bedDirty = true;
  private dirty = true;
  private frameTimes: number[] = [];
  private listeners = new Set<(s: EngineState) => void>();
  private selectListeners = new Set<(s: Selection) => void>();
  private keys = new Set<string>();
  private yaw = 0;
  private pitch = -0.1;
  private eye = 1.7;
  private drag: { x: number; y: number; moved: number } | null = null;
  private disposed = false;
  private state: EngineState;
  private views: CameraView[];
  private timeSec = 0;
  private grade: Grade = {
    exposure: 1, white: new THREE.Color(1, 1, 1), saturation: 1, lift: new THREE.Vector3(), gamma: new THREE.Vector3(1, 1, 1), gain: new THREE.Vector3(1, 1, 1),
    bloom: 0.04, vignette: 0.1, grain: 0.01, aoStrength: 0.85, tonemap: "agx", look: [1.12, 1.1], autoExposure: 0.3,
  };

  constructor(private container: HTMLElement, private ds: Dataset, init: Partial<EngineState> & { toneMap?: ToneMap; resolution?: "auto" | "fixed" } = {}) {
    this.resAuto = init.resolution ? init.resolution === "auto" : !navigator.webdriver;
    registerDistrictBuilders();
    registerPrehistoricBuilders();
    registerLandmarkDetail();
    registerPopulace();
    registerGroundDetail();
    registerProps();
    registerVessels();
    installLookShaders();
    MIST_PARAMS.fill(0);
    LOOK_A.fill(0);
    LOOK_HEMI.fill(0);
    this.scale = new TimeScale(ds.site.timeline.scale);
    this.terrain = new TerrainModel(ds.site);
    this.views = ds.site.views;
    this.atmo = ds.site.atmosphere ?? {};
    if (init.toneMap) this.toneMap = init.toneMap;
    const look = init.look && LOOKS[init.look] ? init.look : "clear";
    this.preset = this.presetFor(look);
    this.state = {
      t: this.scale.clamp(init.t ?? histToT(initialYear(ds))),
      playing: false, direction: 1, speed: 0, rate: 1, mode: "orbit", quality: init.quality && QUALITY[init.quality] ? init.quality : "medium",
      fps: 0, inDistrict: false, labels: init.labels ?? true, evidence: false, ready: false, look,
    };

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance", preserveDrawingBuffer: true });
    this.renderer.localClippingEnabled = true;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    // Low quality draws straight to the screen and tone-maps in every material; the other tiers tone-map
    // in the final post pass (./look/post.ts) and ignore these two settings, which are kept in step so
    // anything reading them (the photo mode) gets the live camera response.
    this.renderer.toneMapping = THREE.AgXToneMapping;
    this.renderer.toneMappingExposure = 1;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.style.display = "block";
    setAnisotropy(Math.min(8, this.renderer.capabilities.getMaxAnisotropy()));
    this.renderer.info.autoReset = false;
    this.post = new LookPost(this.renderer);
    this.cascades = new SunCascades(this.scene, this.sun);

    this.camera = new THREE.PerspectiveCamera(42, 1, 2, 30000);
    // layer 3: drawn by the main camera, left out of the water's mirror (small detail)
    this.camera.layers.enable(3);
    // layer 4: as layer 3, but also drawn into the sun's shadow maps (the crowd figures, pop/figures.ts)
    this.camera.layers.enable(4);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI * 0.492;
    this.controls.minDistance = 12;
    this.controls.maxDistance = 9000;
    this.controls.zoomToCursor = true;
    this.controls.screenSpacePanning = false;

    this.labelLayer = document.createElement("div");
    this.labelLayer.className = "ltt-labels";
    container.appendChild(this.labelLayer);

    this.buildEnvironment();
    this.scene.add(this.content);
    this.buildContent();
    this.applyView(this.views[0], true);
    this.resize();

    const el = this.renderer.domElement;
    el.addEventListener("pointerdown", this.onPointerDown);
    window.addEventListener("pointermove", this.onPointerMove);
    window.addEventListener("pointerup", this.onPointerUp);
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("resize", this.resize);
    this.state.ready = true;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  // ---------- scene construction ----------

  /**
   * A site that fixes the sun's height and direction (Barnet's dawn) has its own dated light: the look presets
   * do not apply there. Otherwise the requested preset is used.
   */
  private presetFor(id: LookId): LookPreset {
    if (this.atmo.sunElevation != null) {
      const low = this.atmo.sunElevation < 12;
      const base = low ? LOOKS.dawn : LOOKS.clear;
      // the site's own dated mist does the work; the preset's haze is kept light under it
      return { ...base, sunAzimuth: this.atmo.sunAzimuth ?? base.sunAzimuth, mist: undefined, haze: low ? 0.00015 : base.haze, aerosol: low ? 0.00012 : base.aerosol };
    }
    const p = LOOKS[id] ?? LOOKS.clear;
    return this.atmo.sunAzimuth != null ? { ...p, sunAzimuth: this.atmo.sunAzimuth } : p;
  }

  private mistSite(): boolean {
    const m = this.atmo.mist;
    if (!m) return false;
    const t = this.state?.t ?? 0;
    return t >= histToT(m.from) - 0.1 && t <= histToT(m.to) + 1.1;
  }

  private evComp(): number {
    // a site's `exposure` was written against the old fixed exposure of 0.72: keep its intent as compensation
    const site = this.atmo.exposure != null ? Math.log2(this.atmo.exposure / 0.72) : 0;
    return this.preset.ev + site;
  }

  private buildEnvironment(): void {
    const sky = new Sky();
    this.sky = sky;
    sky.scale.setScalar(25000);
    const u = sky.material.uniforms;
    u.turbidity.value = 3.2;
    u.rayleigh.value = 1.5;
    u.mieCoefficient.value = 0.004;
    u.mieDirectionalG.value = 0.8;
    if (this.lowSun()) {
      // a hazier, redder sky near the horizon at dawn
      u.turbidity.value = 6;
      u.rayleigh.value = 2.2;
    }
    const elev = THREE.MathUtils.degToRad(this.atmo.sunElevation ?? 31);
    const azim = THREE.MathUtils.degToRad(this.preset.sunAzimuth); // clockwise from north
    this.sunDir.set(Math.sin(azim) * Math.cos(elev), Math.sin(elev), -Math.cos(azim) * Math.cos(elev));
    u.sunPosition.value.copy(this.sunDir);
    this.scene.add(sky);

    // analytic-sky lighting until (or unless) the photographed sky arrives
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const envScene = new THREE.Scene();
    const sky2 = new Sky();
    sky2.scale.setScalar(1000);
    Object.assign(sky2.material.uniforms.sunPosition.value, this.sunDir);
    for (const k of ["turbidity", "rayleigh", "mieCoefficient", "mieDirectionalG"]) sky2.material.uniforms[k].value = u[k].value;
    envScene.add(sky2);
    this.scene.environment = pmrem.fromScene(envScene, 0.02).texture;
    this.scene.environmentIntensity = 0.5;
    pmrem.dispose();

    if (this.atmo.fog != null && this.atmo.fog >= 0) this.fogBase = this.atmo.fog;
    if (this.atmo.fogColor) this.fogColor.set(this.atmo.fogColor);
    this.scene.fog = new THREE.FogExp2(this.fogColor.getHex(), this.fogBase);
    this.scene.add(this.hemi);
    this.sun.color.set(0xfff0d8);
    if (this.lowSun()) {
      const k = THREE.MathUtils.clamp((this.atmo.sunElevation ?? 0) / 14, 0, 1);
      this.sun.color.set(0xffa860).lerp(new THREE.Color(0xfff0d8), k);
      this.hemi.color.set(0xd6dbe6);
      this.hemi.groundColor.set(0x8a7a5e);
      this.hemi.intensity = 1.25;
      this.scene.environmentIntensity = 0.7;
    }
    this.sun.name = "sun";
    this.scene.add(this.sun, this.sun.target);
    this.rig = analyticRig(this.sunDir, this.fogColor, this.evComp());
    this.sun.intensity = this.rig.sunIntensity;

    // river sites: haze settles on the water; elsewhere on the typical ground level
    const b = this.ds.site.bounds;
    if (this.terrain.hasRiver) this.hazeBase = 0;
    else {
      const hs: number[] = [];
      for (let i = 0; i <= 12; i++) for (let j = 0; j <= 12; j++) hs.push(this.terrain.height(b.xMin + ((b.xMax - b.xMin) * i) / 12, b.zMin + ((b.zMax - b.zMin) * j) / 12, this.state.t));
      hs.sort((a, c) => a - c);
      this.hazeBase = hs[Math.floor(hs.length * 0.3)];
    }

    // River and tidal water: one plane at the modelled high-water level (y = 0).
    this.water = new RiverWater(this.ds, this.terrain);
    this.scene.add(this.water.mesh);

    // High, thin broken cloud for the analytic sky (the photographed skies have their own).
    const cloudMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false,
      uniforms: { uTime: { value: 0 } },
      vertexShader: "varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }",
      fragmentShader: `
        varying vec3 vW; uniform float uTime;
        float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
          return mix(mix(h(i), h(i+vec2(1,0)), f.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), f.x), f.y); }
        float fbm(vec2 p){ float a = 0.5, s = 0.0; for(int i=0;i<5;i++){ s += a*n(p); p = p*2.03 + 11.3; a *= 0.5; } return s; }
        void main(){
          vec2 p = vW.xz / 5200.0 + vec2(uTime * 0.004, uTime * 0.0015);
          float d = fbm(p) * 0.75 + fbm(p * 3.1) * 0.25;
          float a = smoothstep(0.5, 0.74, d);
          float dist = length(vW.xz - cameraPosition.xz);
          a *= exp(-dist / 16000.0) * 0.8;
          vec3 col = mix(vec3(0.74, 0.77, 0.82), vec3(1.0, 0.985, 0.96), smoothstep(0.55, 0.85, d));
          gl_FragColor = vec4(col, a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.clouds = new THREE.Mesh(new THREE.PlaneGeometry(70000, 70000).rotateX(-Math.PI / 2), cloudMat);
    this.clouds.position.y = 2600;
    this.clouds.renderOrder = -1;
    this.scene.add(this.clouds);

    // Outline of the detailed benchmark district (sites without one have no frame).
    const d = this.ds.site.district?.bounds;
    if (d) {
      const pts: number[] = [];
      const corners = [[d.xMin, d.zMin], [d.xMax, d.zMin], [d.xMax, d.zMax], [d.xMin, d.zMax]];
      for (let i = 0; i < 4; i++) {
        const [x0, z0] = corners[i], [x1, z1] = corners[(i + 1) % 4];
        const n = 40;
        for (let k = 0; k < n; k += 2) pts.push(x0 + ((x1 - x0) * k) / n, 0, z0 + ((z1 - z0) * k) / n, x0 + ((x1 - x0) * (k + 1)) / n, 0, z0 + ((z1 - z0) * (k + 1)) / n);
      }
      const lg = new THREE.BufferGeometry();
      lg.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
      this.districtFrame = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.85, depthTest: false }));
      this.districtFrame.renderOrder = 10;
      this.districtFrame.position.y = this.terrain.hasRiver ? 3 : this.terrain.height((d.xMin + d.xMax) / 2, (d.zMin + d.zMax) / 2, this.state.t) + 3;
      this.scene.add(this.districtFrame);
    }
    this.buildMist();
    this.applyAtmosphere();
    this.loadSky();
  }

  /**
   * A site that fixes the sun below about 12 degrees is at dawn or dusk.
   */
  private lowSun(): boolean {
    return this.atmo.sunElevation != null && this.atmo.sunElevation < 12;
  }

  private loadHdr(url: string): Promise<LoadedSky | null> {
    let p = this.skies.get(url);
    if (p) return p;
    p = new Promise<LoadedSky | null>((resolve) => {
      new HDRLoader().setDataType(THREE.FloatType).load(
        url,
        (tex) => {
          const { data, width, height } = tex.image as { data: Float32Array; width: number; height: number };
          const info = analyseSky(data, width, height);
          // the ground the sky light bounces off: measured from the terrain's scanned surfaces where loaded
          const albedo = this.groundAlbedo();
          const sunOnGround = Math.max(0, Math.sin(info.sunEl));
          const light = new THREE.DataTexture(lightingSky(data, info, albedo, sunOnGround), width, height, THREE.RGBAFormat, THREE.FloatType);
          light.mapping = THREE.EquirectangularReflectionMapping;
          // the rows are in the photograph's order (top row first), as HDRLoader leaves them: flip on upload like it
          // does, or the sky lights from below and the ground bounce from above
          light.flipY = true;
          light.colorSpace = THREE.LinearSRGBColorSpace;
          light.magFilter = THREE.LinearFilter;
          light.minFilter = THREE.LinearFilter;
          light.needsUpdate = true;
          tex.mapping = THREE.EquirectangularReflectionMapping;
          resolve({ tex, light, info });
        },
        undefined,
        () => {
          console.warn("HDR sky not found; keeping the analytic sky. Run scripts/fetch-assets.py.");
          resolve(null);
        },
      );
    });
    this.skies.set(url, p);
    return p;
  }

  private groundAlbedo(): THREE.Color {
    // mean of the baked land-use ground (ground/land.ts), measured in the page across the four sites; linear
    return new THREE.Color(0.15, 0.17, 0.055);
  }

  /** Photographed HDR sky for the current look: image-based light, background, sun, haze and cloud cover. */
  private loadSky(): void {
    const url = skyUrl(this.preset.sky);
    this.skyKey = url;
    void this.loadHdr(url).then((s) => {
      if (this.disposed || this.skyKey !== url) return;
      if (!s) {
        this.skyReady = true;
        return;
      }
      this.applySky(s);
    });
  }

  private applySky(s: LoadedSky): void {
    const { info } = s;
    // world angle atan2(z, x) of the preset's azimuth (clockwise from north, north = -z)
    const az = Math.atan2(-Math.cos(THREE.MathUtils.degToRad(this.preset.sunAzimuth)), Math.sin(THREE.MathUtils.degToRad(this.preset.sunAzimuth)));
    const rot = SKY_SIGN * (az - info.sunLon);
    // a site may fix the sun's height; otherwise the light follows the sun in the photograph
    const sunEl = this.atmo.sunElevation != null ? THREE.MathUtils.degToRad(this.atmo.sunElevation) : info.sunEl;
    this.sunDir.set(Math.cos(sunEl) * Math.cos(az), Math.sin(sunEl), Math.cos(sunEl) * Math.sin(az));
    this.scene.background = s.tex;
    this.scene.environment = s.light;
    this.scene.backgroundRotation.set(0, rot, 0);
    this.scene.environmentRotation.set(0, rot, 0);
    this.rig = computeRig(info, this.sunDir, this.evComp());
    this.scene.backgroundIntensity = this.rig.k;
    this.scene.environmentIntensity = this.rig.k;
    this.sun.color.copy(this.rig.sunColor);
    this.sun.intensity = this.rig.sunIntensity;
    this.hemi.intensity = 0; // the lighting sky now carries the ground bounce (and LOOK_HEMI for non-PBR materials)
    this.groundAlbedoNow = this.groundAlbedo();
    this.scene.remove(this.sky, this.clouds);
    if (!this.atmo.fogColor) this.fogColor.copy(info.horizon);
    (this.scene.fog as THREE.FogExp2).color.copy(this.fogColor);
        this.skyReady = true;
    this.applyAtmosphere();
    this.applyQualityLight();
    this.post.resetExposure();
    this.mistNow = -1;
    this.dirty = true;
  }

  private groundAlbedoNow: THREE.Color | null = null;

  /** Aerial perspective, cloud shadows, grade and exposure for the current rig, preset and tier. */
  private applyAtmosphere(): void {
    const p = this.preset;
    const q = QUALITY[this.state.quality];
    writeAtmosphere(this.rig, {
      preset: p, aerosolScale: this.fogBase / 0.00014, hazeBase: this.hazeBase, cloudShadows: this.state.quality !== "low", timeSec: this.timeSec,
    });
    // tide line: surfaces just above high water are wet (river sites)
    LOOK_A[39] = this.terrain.hasRiver ? 0.6 : 0;
    // fill for Lambert/Phong materials, matching the image-based light the physical materials get: the sky's
    // irradiance from above, light bounced off the ground from below (off while the analytic fallback sky and its
    // hemisphere light are in use)
    LOOK_HEMI.fill(0);
    if (this.skyReady && this.groundAlbedoNow) {
      const r = this.rig;
      const g = r.skyIrr.clone().add(r.sunIrr.clone().multiplyScalar(Math.max(0, r.sunDir.y))).multiply(this.groundAlbedoNow);
      LOOK_HEMI.set([r.skyIrr.r, r.skyIrr.g, r.skyIrr.b, 0, g.r, g.g, g.b, 0]);
    }
    if (!this.skyReady) {
      // until the photograph arrives keep three's plain fog colour in step
      (this.scene.fog as THREE.FogExp2).color.copy(this.fogColor);
    }
    const g = this.grade;
    g.exposure = this.rig.exposure;
    g.white.setRGB(...p.white);
    g.saturation = p.saturation;
    g.lift.set(...p.lift);
    g.gamma.set(...p.gamma);
    g.gain.set(...p.gain);
    g.bloom = p.bloom;
    g.look = [p.contrast, p.agxSat];
    g.grain = q.grain;
    g.vignette = q.vignette;
    g.tonemap = this.toneMap;
    // Low has no auto-exposure: a misty scene is metered down by hand instead
    this.renderer.toneMappingExposure = this.rig.exposure * (this.mistSite() || p.mist ? 0.55 : 1);
    this.renderer.toneMapping = this.toneMap === "neutral" ? THREE.NeutralToneMapping : this.toneMap === "aces" ? THREE.ACESFilmicToneMapping : THREE.AgXToneMapping;
    this.water.setLight({
      sunDir: this.sunDir, sunColor: this.rig.sunIrr, skyIrr: this.rig.skyIrr, sky: (this.scene.background as THREE.Texture | null) ?? null,
      skyRot: -this.scene.backgroundRotation.y * SKY_SIGN, skyScale: this.rig.k, horizon: this.rig.horizonAway.clone().lerp(this.rig.horizonToward, 0.3),
    });
    // misty dawn: a whole-timeline ground mist (a site's own dated mist takes precedence)
    this.mist = this.siteMist ?? (p.mist ? this.presetMist(p.mist) : null);
    MIST_PARAMS.fill(0);
    this.mistNow = -1;
  }

  /** Sun shadows and water for the current tier. */
  private applyQualityLight(): void {
    const q = QUALITY[this.state.quality];
    // no direct sun (overcast): no shadow passes at all
    const sizes = this.rig.hasSun && this.rig.sunIntensity > 0.2 ? q.cascades : [];
    this.renderer.shadowMap.enabled = sizes.length > 0;
    this.cascades.configure(sizes, sizes.length > 1 ? -0.00004 : -0.0001);
    this.water.setReflection(q.reflection[0], q.reflection[1], q.reflection[2]);
  }

  /**
   * Dated ground mist (site.atmosphere.mist): a height fog laid over the ground (see ./mist.ts). Below `base`
   * the mist has its full `density`; above it, it thins with a scale height of a third of `height`, so it is
   * mostly gone `height` metres above the base. Seen from inside, shapes fade within a few hundred metres;
   * from high above, the ground under the camera stays readable while the distance and the valleys fill in.
   */
  private buildMist(): void {
    const m = this.atmo.mist as (SiteAtmosphere["mist"] & { base?: number }) | undefined;
    if (!m || !(m.density > 0)) return;
    const height = m.height ?? 40;
    let base = m.base;
    if (base == null || !Number.isFinite(base)) {
      // default: the median ground height of the modelled area in the mist years
      const b = this.ds.site.bounds;
      const yp = this.terrain.yearParams(histToT(m.from));
      const hs: number[] = [];
      for (let i = 0; i <= 24; i++)
        for (let j = 0; j <= 24; j++) {
          const x = b.xMin + ((b.xMax - b.xMin) * i) / 24, z = b.zMin + ((b.zMax - b.zMin) * j) / 24;
          hs.push(this.terrain.floor(this.terrain.heightFrom(this.terrain.staticSample(x, z), yp)));
        }
      hs.sort((a, c) => a - c);
      base = hs[hs.length >> 1];
    }
    const color = new THREE.Color(m.color ?? "#d9dcdc");
    this.siteMist = { t0: histToT(m.from), t1: histToT(m.to) + 1, density: m.density, base, scale: Math.max(2, height / 3), color };
    this.mist = this.siteMist;
  }

  private presetMist(m: NonNullable<LookPreset["mist"]>): NonNullable<Engine["mist"]> {
    return { t0: -1e9, t1: 1e9, density: m.density, base: this.hazeBase + 2, scale: Math.max(2, m.height / 3), color: new THREE.Color(m.color), always: true };
  }

  private updateMist(t: number, camY: number): void {
    const m = this.mist!;
    // present for the whole of the dated years, easing in and out over about a month either side
    const w = m.always ? 1 : THREE.MathUtils.smoothstep(t, m.t0 - 0.08, m.t0) * (1 - THREE.MathUtils.smoothstep(t, m.t1, m.t1 + 0.08));
    // a rendering choice: from far overhead the layer is let thin a little, so the whole-site view stays readable
    const high = THREE.MathUtils.clamp(1 - (camY - m.base - 250) / 2200, 0.6, 1);
    const key = w * 10 + high;
    if (Math.abs(key - this.mistNow) < 0.004) return;
    this.mistNow = key;
    // the mist scatters the light reaching it from every direction: the sky above, the dark ground below and the
    // sun (scene units); roughly half the sky's mean radiance plus a little of the sun's
    const r = this.rig;
    // (the sun term is small: seen from the side, droplets scatter little of a low sun's beam towards the camera)
    const e = r.skyIrr.clone().multiplyScalar(0.42).add(r.sunIrr.clone().multiplyScalar(0.05));
    MIST_PARAMS.set([m.density * w, m.base, m.scale, w > 0 ? 0.985 * high : 0]);
    MIST_COLOR.set([(m.color.r * e.r) / Math.PI, (m.color.g * e.g) / Math.PI, (m.color.b * e.b) / Math.PI]);
    this.dirty = true;
  }

  // ---------- look ----------

  /** Switch the time-of-day / weather look (no effect on sites with their own dated light). */
  setLook(id: LookId): void {
    if (!LOOKS[id]) return;
    this.state.look = id;
    const next = this.presetFor(id);
    const changed = next.sky !== this.preset.sky || next.sunAzimuth !== this.preset.sunAzimuth;
    this.preset = next;
    if (changed) this.loadSky();
    else this.applyAtmosphere();
    this.emit(true);
  }
  getLook(): LookId {
    return this.state.look;
  }
  /** Tone mapper for comparison (AgX is the default). */
  setToneMap(t: ToneMap): void {
    this.toneMap = t;
    this.applyAtmosphere();
  }
  /**
   * The sun as the live view lights it (stable accessor for other renderers, e.g. photo mode).
   * `direction` points towards the sun (world space). `irradiance` is the sun's irradiance on a surface facing it,
   * in scene units (linear RGB); `color` is the same with unit luminance and `intensity` its luminance, i.e. the
   * DirectionalLight's colour and intensity. All values are copies.
   */
  getSun(): { direction: THREE.Vector3; color: THREE.Color; intensity: number; irradiance: THREE.Color; elevationDeg: number; azimuthDeg: number; visible: boolean } {
    const d = this.sunDir.clone();
    return {
      direction: d, color: this.rig.sunColor.clone(), intensity: this.rig.sunIntensity, irradiance: this.rig.sunIrr.clone(),
      elevationDeg: THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(d.y, -1, 1))),
      azimuthDeg: (THREE.MathUtils.radToDeg(Math.atan2(d.x, -d.z)) + 360) % 360,
      visible: this.rig.hasSun && this.rig.sunIntensity > 0.2,
    };
  }

  /**
   * The atmosphere the live view applies (stable accessor; the same numbers the shared shader uniforms hold, see
   * src/scene/look/atmosphere.ts and docs/LOOK.md). Densities are per metre; heights are world y; colours are
   * linear RGB in scene units. The optical depth of a layer along a ray of length L between heights y0 and y1
   * (absolute values) is density * L * (exp(-a) - exp(-b)) / (b - a), with a, b = (y - base) / scaleHeight
   * clamped to >= -1.5. Transmittance = exp(-(tau_aerosol + tau_haze) * extinction); in-scatter tends to
   * mix(inscatterAway, inscatterToward, pow(azimuthal cosine to the sun * 0.5 + 0.5, lobePower)), pulled towards
   * inscatterDown for downward rays (by clamp(-dir.y * 1.4, 0, 0.65)), plus sunGlow * HG(g). The mist is applied
   * after the aerial perspective, as in src/scene/look/atmosphere.ts. All values are copies.
   */
  getAtmosphere(): {
    enabled: boolean;
    aerosol: { density: number; base: number; scaleHeight: number };
    haze: { density: number; base: number; scaleHeight: number };
    extinction: [number, number, number];
    inscatterAway: THREE.Color; inscatterToward: THREE.Color; inscatterDown: THREE.Color; lobePower: number;
    sunGlow: { color: THREE.Color; g: number };
    mist: { density: number; base: number; scaleHeight: number; strength: number; color: THREE.Color } | null;
    clouds: { enabled: boolean; tileSize: number; threshold: number; softness: number; strength: number; deckHeight: number; offset: [number, number] };
    skyIrradiance: THREE.Color;
    exposure: number;
    toneMap: ToneMap;
  } {
    const A = LOOK_A;
    const c = (i: number) => new THREE.Color(A[i], A[i + 1], A[i + 2]);
    return {
      enabled: A[7] > 0.5,
      aerosol: { density: A[4], base: A[5], scaleHeight: A[6] },
      haze: { density: A[8], base: A[9], scaleHeight: A[10] },
      extinction: [A[20], A[21], A[22]],
      inscatterAway: c(12), inscatterToward: c(16), inscatterDown: new THREE.Color(A[11], A[15], A[23]), lobePower: A[19],
      sunGlow: { color: c(24), g: A[27] },
      mist: MIST_PARAMS[0] > 0 ? { density: MIST_PARAMS[0], base: MIST_PARAMS[1], scaleHeight: MIST_PARAMS[2], strength: MIST_PARAMS[3], color: new THREE.Color(MIST_COLOR[0], MIST_COLOR[1], MIST_COLOR[2]) } : null,
      clouds: { enabled: A[35] > 0.5, tileSize: A[28] > 0 ? 1 / A[28] : 0, threshold: A[29], softness: A[30], strength: A[31], deckHeight: A[34], offset: [A[32], A[33]] },
      skyIrradiance: this.rig.skyIrr.clone(),
      exposure: this.rig.exposure,
      toneMap: this.toneMap,
    };
  }

  /** The light rig and grade in use (for tests and the look-development notes). */
  lookInfo(): { look: LookId; preset: string; exposure: number; sunIntensity: number; sunElevation: number; cloudCover: number; hasSun: boolean; k: number; cascades: number; toneMap: ToneMap } {
    return {
      look: this.state.look, preset: this.preset.id, exposure: +this.rig.exposure.toFixed(3), sunIntensity: +this.rig.sunIntensity.toFixed(3),
      sunElevation: +THREE.MathUtils.radToDeg(Math.asin(this.sunDir.y)).toFixed(1), cloudCover: +this.rig.cloudCover.toFixed(2), hasSun: this.rig.hasSun,
      k: +this.rig.k.toFixed(4), cascades: this.cascades.count, toneMap: this.toneMap,
    };
  }

  private buildContent(): void {
    const q = QUALITY[this.state.quality];
    this.content.clear();
    this.landmarks = new LandmarkLayer(this.ds, this.terrain);
    this.fabric = new FabricLayer(this.ds, this.terrain, this.landmarks, q.density);
    this.terrainMesh = new TerrainMesh(this.ds, this.terrain, q.terrain);
    this.terrainMesh.attachFabric(this.fabric);
    this.trees = buildTrees(this.ds, this.terrain, this.fabric, q.trees);
    this.fire = new FireFx(this.ds, this.terrain, this.fabric);
    for (const x of this.extras) x.dispose?.();
    this.extras = [];
    for (const f of EXTRA_FACTORIES) {
      try {
        // content layers know three tiers; the cinematic tier carries High's content
        const quality = this.state.quality === "cinematic" ? "high" : this.state.quality;
        const x = f({ ds: this.ds, terrain: this.terrain, fabric: this.fabric, landmarks: this.landmarks, quality });
        if (x) this.extras.push(x);
      } catch (e) {
        console.warn("extra layer failed", e);
      }
    }
    this.content.add(this.terrainMesh.mesh, this.landmarks.root, this.fabric.root, this.trees, this.fire.points);
    for (const x of this.extras) this.content.add(x.object);
    // small detail (people, props, ground cover, understorey) is left out of the water's mirror image
    const small = new Set(["populace", "ground-detail", "street-props", "understorey"]);
    this.content.traverse((o) => {
      if (small.has(o.name)) o.traverse((c) => c.layers.set(3));
    });
    this.resScale = 1;
    this.resCool = 0;
    this.renderer.setPixelRatio(this.basePixelRatio());
    this.landmarks.setEvidenceOverlay(this.state.evidence ? 1 : 0);
    // no river, no water (and no mirror pass)
    this.water.mesh.visible = this.terrain.hasRiver;
    this.applyQualityLight();
    this.applyAtmosphere();
    this.bedDirty = true;
    this.applyYear(true);
  }

  // ---------- timeline ----------

  private applyYear(force = false): void {
    const t = this.state.t;
    lifeUniforms.uYear.value = t;
    this.landmarks.update(t);
    this.fabric.update(t);
    (this.trees.userData.update as (t: number) => void)(t);
    const now = performance.now();
    if (force || now - this.lastTerrain > 110) {
      if (this.terrainMesh.update(t, force)) {
        this.lastTerrain = now;
        // the banks moved: the water re-measures its depth
        this.bedDirty = true;
      }
    } else this.dirty = true;
  }

  setT(t: number): void {
    if (!Number.isFinite(t)) return;
    const c = this.scale.clamp(t);
    if (c === this.state.t) return;
    this.state.t = c;
    this.applyYear();
    this.emit();
  }
  getT(): number {
    return this.state.t;
  }
  play(direction: 1 | -1 = 1): void {
    this.state.direction = direction;
    // restarting from an end makes "play" always do something
    if (direction > 0 && this.state.t >= this.scale.tMax) this.state.t = this.scale.tMin;
    if (direction < 0 && this.state.t <= this.scale.tMin) this.state.t = this.scale.tMax;
    this.state.playing = true;
    this.emit(true);
  }
  pause(): void {
    this.state.playing = false;
    this.emit(true);
  }
  setSpeed(speed: Speed, rate = this.state.rate): void {
    this.state.speed = speed;
    this.state.rate = rate;
    this.emit(true);
  }

  // ---------- view ----------

  private applyView(v: CameraView, instant = false): void {
    void instant;
    if (this.state.mode === "walk") this.setMode("orbit");
    this.camera.position.set(...v.position);
    this.controls.target.set(...v.target);
    this.controls.update();
    // a cut, not a camera move: start the temporal history afresh
    this.post.resetHistory();
  }
  setView(id: string): void {
    const v = this.views.find((x) => x.id === id);
    if (v) this.applyView(v);
    this.emit(true);
  }
  resetView(): void {
    this.applyView(this.views[0]);
    this.emit(true);
  }
  /** Jump to a staged event: sets the year (mid-year where given) and, when the site is on the map, the camera. */
  goToEpisode(id: string): void {
    const ep = this.ds.episodes.find((e) => e.id === id);
    if (!ep) return;
    this.pause();
    this.setT(histToT(ep.year) + (ep.fraction ?? 0.5));
    if (this.state.mode === "walk") this.setMode("orbit");
    if (ep.inMap && ep.view) {
      this.camera.position.set(...ep.view.position);
      this.controls.target.set(...ep.view.target);
    } else {
      // off the map: look across the modelled area towards the site
      const [ex, ez] = this.terrain.proj.toLocal(ep.lat, ep.lon);
      const b = this.ds.site.bounds;
      const cx = (b.xMin + b.xMax) / 2, cz = (b.zMin + b.zMax) / 2;
      const d = new THREE.Vector3(ex - cx, 0, ez - cz).normalize();
      const y0 = this.terrain.hasRiver ? 0 : this.terrain.height(cx, cz, this.state.t);
      const span = Math.min(1, Math.max(b.xMax - b.xMin, b.zMax - b.zMin) / 4800);
      this.controls.target.set(cx + d.x * 900 * span, y0, cz + d.z * 900 * span);
      this.camera.position.set(cx - d.x * 2600 * span, y0 + 1500 * span, cz - d.z * 2600 * span);
    }
    this.controls.update();
    for (const cb of this.selectListeners) cb({ type: "episode", episode: ep });
    this.emit(true);
  }

  focusLandmark(id: string): void {
    const box = this.landmarks.focusBox(id);
    if (!box) return;
    if (this.state.mode === "walk") this.setMode("orbit");
    const c = box.getCenter(new THREE.Vector3());
    const size = Math.max(60, box.getSize(new THREE.Vector3()).length());
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    dir.y = Math.max(dir.y, 0.35);
    dir.normalize();
    this.controls.target.copy(c);
    this.camera.position.copy(c).addScaledVector(dir, size * 1.6);
    this.controls.update();
  }
  getCamera(): { position: number[]; target: number[]; mode: NavMode } {
    return { position: this.camera.position.toArray(), target: this.controls.target.toArray(), mode: this.state.mode };
  }
  setCamera(position: number[], target: number[]): void {
    this.camera.position.fromArray(position);
    this.controls.target.fromArray(target);
    this.controls.update();
    this.post.resetHistory();
  }

  setMode(mode: NavMode): void {
    if (mode === this.state.mode) return;
    const yp = this.terrain.yearParams(this.state.t);
    const groundAt = (x: number, z: number) => this.terrain.floor(this.terrain.heightFrom(this.terrain.staticSample(x, z), yp));
    if (mode === "walk") {
      const tg = this.controls.target;
      const dir = tg.clone().sub(this.camera.position);
      this.yaw = Math.atan2(-dir.x, -dir.z);
      this.pitch = -0.05;
      this.eye = 1.7;
      this.camera.position.set(tg.x, groundAt(tg.x, tg.z) + this.eye, tg.z);
      this.controls.enabled = false;
    } else {
      const f = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
      const p = this.camera.position.clone();
      const tg = p.clone().addScaledVector(f, 70);
      tg.y = groundAt(tg.x, tg.z);
      this.controls.target.copy(tg);
      this.camera.position.set(p.x - f.x * 60, Math.max(p.y, tg.y) + 55, p.z - f.z * 60);
      this.controls.enabled = true;
      this.controls.update();
    }
    this.state.mode = mode;
    this.post.resetHistory();
    this.emit(true);
  }

  setQuality(q: Quality): void {
    if (q === this.state.quality) return;
    this.state.quality = q;
    this.disposeContent();
    this.buildContent();
    this.resize();
    this.emit(true);
  }
  setLabels(on: boolean): void {
    this.state.labels = on;
    this.emit(true);
  }
  setEvidence(on: boolean): void {
    this.state.evidence = on;
    lifeUniforms.uEvidence.value = on ? 1 : 0;
    this.landmarks.setEvidenceOverlay(on ? 1 : 0);
    this.landmarks.update(this.state.t);
    this.emit(true);
  }

  // ---------- events ----------

  onChange(cb: (s: EngineState) => void): () => void {
    this.listeners.add(cb);
    cb({ ...this.state });
    return () => this.listeners.delete(cb);
  }
  onSelect(cb: (s: Selection) => void): () => void {
    this.selectListeners.add(cb);
    return () => this.selectListeners.delete(cb);
  }
  private emit(force = false): void {
    const now = performance.now();
    if (!force && now - this.lastEmit < 80) {
      this.dirty = true;
      return;
    }
    this.lastEmit = now;
    const s = { ...this.state };
    for (const cb of this.listeners) cb(s);
  }
  getState(): EngineState {
    return { ...this.state };
  }

  private onPointerDown = (e: PointerEvent) => {
    this.drag = { x: e.clientX, y: e.clientY, moved: 0 };
  };
  private onPointerMove = (e: PointerEvent) => {
    if (!this.drag) return;
    const dx = e.clientX - this.drag.x, dy = e.clientY - this.drag.y;
    this.drag.moved += Math.abs(dx) + Math.abs(dy);
    this.drag.x = e.clientX;
    this.drag.y = e.clientY;
    if (this.state.mode === "walk") {
      this.yaw -= dx * 0.0035;
      this.pitch = Math.max(-1.3, Math.min(1.3, this.pitch - dy * 0.0035));
    }
  };
  private onPointerUp = (e: PointerEvent) => {
    const d = this.drag;
    this.drag = null;
    if (!d || d.moved > 6 || e.target !== this.renderer.domElement) return;
    this.pick(e.clientX, e.clientY);
  };
  private onKeyDown = (e: KeyboardEvent) => {
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
    this.keys.add(e.code);
  };
  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
  };

  private pick(cx: number, cy: number): void {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((cx - rect.left) / rect.width) * 2 - 1, -((cy - rect.top) / rect.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const hits = ray.intersectObjects([...this.landmarks.pickables(), this.fabric.root], true);
    const t = this.state.t;
    for (const h of hits) {
      const id = h.object.userData.landmarkId as string | undefined;
      if (h.object.userData.noPick) continue;
      if (id) {
        const lm = this.ds.landmarks.find((l) => l.id === id)!;
        // respect the construction/ruin clip so invisible upper parts cannot be picked
        const st = this.landmarks.active().find((a) => a.lm.id === id);
        if (st && h.point.y > st.anchor.y - 3.5) continue;
        for (const cb of this.selectListeners) cb({ type: "landmark", landmark: lm });
        return;
      }
      if (h.object.userData.fabric && h.instanceId != null) {
        const life = (h.object as THREE.InstancedMesh).geometry.getAttribute("aLife");
        const i = h.instanceId;
        if (t < life.getY(i) || t > life.getZ(i)) continue;
        const zone = this.fabric.zoneForHit(h.object, i);
        if (zone) for (const cb of this.selectListeners) cb({ type: "zone", zone });
        return;
      }
    }
    for (const cb of this.selectListeners) cb(null);
  }

  // ---------- frame ----------

  private resize = () => {
    const w = this.container.clientWidth || 1, h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = "100%";
    this.renderer.domElement.style.height = "100%";
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.setupPost();
  };

  private frame = (now: number) => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.frame);
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.frameTimes.push(now - this.last);
    if (this.frameTimes.length > 90) this.frameTimes.shift();
    this.adaptResolution(now);
    this.last = now;
    const s = this.state;

    if (s.playing) {
      let t = s.t;
      if (s.speed === 0) {
        const u = this.scale.tToU(t) + (s.direction * dt * s.rate) / AUTO_SECONDS;
        t = this.scale.uToT(u);
      } else t += s.direction * dt * s.speed * s.rate;
      const c = this.scale.clamp(t);
      if (c !== t || c === s.t) s.playing = false; // reached an end
      s.t = c;
      this.applyYear();
      this.emit(!s.playing);
    } else if (this.dirty) {
      this.dirty = false;
      this.applyYear();
      this.emit();
    }

    const yp = this.terrain.yearParams(s.t);
    const groundAt = (x: number, z: number) => this.terrain.floor(this.terrain.heightFrom(this.terrain.staticSample(x, z), yp));
    if (s.mode === "walk") {
      const fast = this.keys.has("ShiftLeft") || this.keys.has("ShiftRight") ? 6 : 1;
      const sp = 7 * fast * dt * (1 + this.eye / 12);
      const f = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
      const r = new THREE.Vector3(-f.z, 0, f.x);
      const p = this.camera.position;
      if (this.keys.has("KeyW") || this.keys.has("ArrowUp")) p.addScaledVector(f, sp);
      if (this.keys.has("KeyS") || this.keys.has("ArrowDown")) p.addScaledVector(f, -sp);
      if (this.keys.has("KeyD")) p.addScaledVector(r, sp);
      if (this.keys.has("KeyA")) p.addScaledVector(r, -sp);
      if (this.keys.has("ArrowLeft")) this.yaw += dt * 1.4;
      if (this.keys.has("ArrowRight")) this.yaw -= dt * 1.4;
      if (this.keys.has("KeyE")) this.eye = Math.min(400, this.eye + dt * (4 + this.eye) * fast);
      if (this.keys.has("KeyQ")) this.eye = Math.max(1.7, this.eye - dt * (4 + this.eye) * fast);
      const b = this.ds.site.bounds;
      p.x = Math.max(b.xMin + 20, Math.min(b.xMax - 20, p.x));
      p.z = Math.max(b.zMin + 20, Math.min(b.zMax - 20, p.z));
      p.y = groundAt(p.x, p.z) + this.eye;
      this.camera.rotation.set(this.pitch, this.yaw, 0, "YXZ");
      this.controls.target.copy(p).addScaledVector(f, 40);
    } else {
      const tg = this.controls.target;
      const b = this.ds.site.bounds;
      tg.x = Math.max(b.xMin, Math.min(b.xMax, tg.x));
      tg.z = Math.max(b.zMin, Math.min(b.zMax, tg.z));
      if (this.terrain.hasRiver) tg.y = Math.max(0, Math.min(120, tg.y));
      else {
        // no water datum: keep the point of interest between the ground and 120 m above it
        const tgG = groundAt(tg.x, tg.z);
        tg.y = Math.max(tgG, Math.min(tgG + 120, tg.y));
      }
      this.controls.update();
      const g = groundAt(this.camera.position.x, this.camera.position.z) + 2;
      if (this.camera.position.y < g) this.camera.position.y = g;
    }
    const camH = this.camera.position.y;
    const near = s.mode === "walk" ? 0.3 : THREE.MathUtils.clamp(Math.min(camH, this.camera.position.distanceTo(this.controls.target)) * 0.06, 0.5, 40);
    if (Math.abs(this.camera.near - near) > near * 0.1) {
      this.camera.near = near;
      this.camera.updateProjectionMatrix();
    }

    const focus = this.controls.target;
    const dist = this.camera.position.distanceTo(focus);
    this.camGround = groundAt(this.camera.position.x, this.camera.position.z);

    this.fire.update(s.t, now * 0.001, this.renderer.domElement.height);
    // Optional layers (people, props, ground detail…) must never take the scene down: one that
    // throws is hidden and dropped, and the rest of the frame carries on.
    for (let i = this.extras.length - 1; i >= 0; i--) {
      const x = this.extras[i];
      try {
        x.update(s.t, now * 0.001, this.camera);
      } catch (e) {
        console.warn("extra layer failed during update and was disabled", e);
        x.object.visible = false;
        this.extras.splice(i, 1);
      }
    }
    this.timeSec = now * 0.001;
    this.water.update(this.timeSec);
    (this.clouds.material as THREE.ShaderMaterial).uniforms.uTime.value = this.timeSec;
    driftClouds(dt);

    const d = this.ds.site.district?.bounds;
    const inD = !!d && focus.x > d.xMin && focus.x < d.xMax && focus.z > d.zMin && focus.z < d.zMax && dist < 1400;
    if (inD !== s.inDistrict) {
      s.inDistrict = inD;
      this.emit(true);
    }
    if (this.districtFrame) this.districtFrame.visible = dist > 950 && s.mode === "orbit";
    if (this.mist) this.updateMist(s.t, this.camera.position.y);

    this.renderFrame();
    this.updateLabels();

    if (now - this.lastEmit > 500) {
      const avg = this.frameTimes.reduce((a, v) => a + v, 0) / Math.max(1, this.frameTimes.length);
      s.fps = Math.round(1000 / avg);
      this.emit(true);
    }
  };

  /** For render modes that live outside the engine (e.g. the path-traced photo mode). */
  getRenderContext(): { renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera; container: HTMLElement } {
    return { renderer: this.renderer, scene: this.scene, camera: this.camera, container: this.container };
  }
  /**
   * Hand the per-frame draw to an external renderer. The override is called instead of the normal
   * pipeline; return false from it to fall back to the normal pipeline for that frame. Pass null to release.
   */
  setRenderOverride(fn: ((ctx: { renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera }) => boolean) | null): void {
    this.renderOverride = fn;
  }
  private renderOverride: ((ctx: { renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera }) => boolean) | null = null;

  private camGround = 0;

  private renderFrame(): void {
    if (this.renderOverride) {
      try {
        if (this.renderOverride({ renderer: this.renderer, scene: this.scene, camera: this.camera })) return;
      } catch (e) {
        console.warn("render override failed and was released", e);
        this.renderOverride = null;
      }
    }
    const r = this.renderer;
    r.info.reset();
    const cam = this.camera;
    const focus = this.controls.target;
    const dist = cam.position.distanceTo(focus);
    // sun shadows: cascades over the view (or one map around the point of interest)
    this.cascades.update(cam, this.sunDir, Math.max(1, cam.near), THREE.MathUtils.clamp(dist * 3 + 250, 300, 5200), focus);
    if (this.bedDirty && this.water.mesh.visible) {
      this.bedDirty = false;
      this.water.updateBed(r, this.terrainMesh.mesh);
    }
    const sz = r.getDrawingBufferSize(this.tmpSize);
    this.water.renderReflection(r, this.scene, cam, sz.x, sz.y);
    if (!this.post.active) {
      r.setRenderTarget(null);
      r.render(this.scene, cam);
      return;
    }
    this.post.renderBeauty(cam, () => r.render(this.scene, cam));
    const q = QUALITY[this.state.quality];
    const eyeLevel = this.state.mode === "walk" || cam.position.y - this.camGround < 30;
    const lowSun = this.rig.hasSun && this.sunDir.y < 0.45;
    this.post.finish(cam, this.grade, {
      sunDir: q.post?.shafts && lowSun ? this.sunDir : null,
      sunShafts: 0.35 * (1 - THREE.MathUtils.smoothstep(this.sunDir.y, 0.2, 0.45)),
      dof: q.post?.dof && eyeLevel ? { focus: this.state.mode === "walk" ? 30 : THREE.MathUtils.clamp(dist, 8, 400), fstop: 4 } : null,
    }, this.timeSec);
    r.setRenderTarget(null);
  }
  private tmpSize = new THREE.Vector2();

  // ---------- automatic resolution ----------
  // The scene is bound by pixels on a high-density screen, so the one setting that always buys frame time is the
  // number of pixels drawn. The tier sets the ceiling; this lowers it in steps while frames run late and raises it
  // again while they run on time. Off in automated runs (screenshots must be comparable) and with ?res=fixed.
  private resAuto = false;
  private resScale = 1;
  private resCool = 0;
  /** Seconds to wait before trying a higher resolution again (doubles each time a step up had to be undone). */
  private resBackoff = 4;
  private resUpAt = 0;
  private basePixelRatio(): number {
    return Math.min(window.devicePixelRatio || 1, QUALITY[this.state.quality].dpr);
  }
  private adaptResolution(now: number): void {
    if (!this.resAuto || !this.state.ready || this.renderOverride || document.hidden) return;
    if (now < this.resCool) return;
    // the median of the last second or so: a single hitch (a landmark being built, a texture arriving) is ignored
    const recent = this.frameTimes.slice(-40).filter((v) => v < 250);
    if (recent.length < 30) return;
    recent.sort((a, b) => a - b);
    const med = recent[recent.length >> 1];
    // most frames on time is not enough to go up again: nine in ten must be
    const p75 = recent[Math.floor(recent.length * 0.9)];
    const base = this.basePixelRatio();
    const floor = Math.min(1, 0.75 / base); // never below three quarters of a CSS pixel
    let next = this.resScale;
    if (med > 24 && this.resScale > floor) {
      // under about 42 frames a second: draw fewer pixels
      next = Math.max(floor, this.resScale * (med > 40 ? 0.7 : 0.85));
      if (now - this.resUpAt < 6000) this.resBackoff = Math.min(120, this.resBackoff * 2); // the last step up did not hold
    } else if (p75 < 17.5 && this.resScale < 1 && now - this.resUpAt > this.resBackoff * 1000) {
      next = Math.min(1, this.resScale / 0.85);
      this.resUpAt = now;
    }
    if (next === this.resScale) return;
    this.resScale = next;
    this.resCool = now + 1500;
    this.frameTimes.length = 0;
    this.renderer.setPixelRatio(base * next);
    this.resize();
  }

  private setupPost(): void {
    const sz = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    let tier = QUALITY[this.state.quality].post;
    // With temporal anti-aliasing on a high-density screen, 4x multisampling on top costs a sixth of the frame for
    // edges that are already smooth (compared side by side on ship's rigging at 2 device pixels per CSS pixel: no
    // visible difference). None at 1.75 and above, two samples from 1.25, the tier's own number below that.
    const pr = this.renderer.getPixelRatio();
    if (tier?.taa && pr >= 1.25) tier = { ...tier, msaa: pr >= 1.75 ? 0 : Math.min(2, tier.msaa) };
    this.post.configure(tier, sz.x, sz.y, this.scene, this.camera);
  }

  private updateLabels(): void {
    const on = this.state.labels;
    this.labelLayer.style.display = on ? "block" : "none";
    if (!on) return;
    const w = this.container.clientWidth, h = this.container.clientHeight;
    const v = new THREE.Vector3();
    const cand = this.landmarks
      .active()
      .filter((a) => !["road", "stream", "boats", "waterfront", "hedge", "field-strips"].includes(a.phase.model.kind) && a.status.height > 0.05)
      .map((a) => {
        const d = this.camera.position.distanceTo(a.anchor);
        return { a, d, score: a.size / d };
      })
      .filter((c) => c.score > 0.028)
      .sort((x, y) => y.score - x.score)
      .slice(0, 16);
    const used: { x: number; y: number }[] = [];
    let n = 0;
    for (const c of cand) {
      v.copy(c.a.anchor).project(this.camera);
      if (v.z > 1 || v.z < -1) continue;
      const ax = (v.x * 0.5 + 0.5) * w, y = (-v.y * 0.5 + 0.5) * h;
      if (ax < 40 || ax > w - 40 || y < 70 || y > h - 150) continue;
      const st = c.a.status.state;
      const suffix = st === "construction" ? " · building" : st === "ruin" ? " · ruin" : st === "burning" ? " · burning" : st === "teardown" ? " · being taken down" : "";
      const own = c.a.phase.model.label;
      const text = (typeof own === "string" && own ? own : c.a.lm.name) + suffix;
      // keep the whole label on screen: a long name near an edge slides inwards rather than running off
      const half = Math.min(w / 2 - 8, text.length * 3.6 + 14);
      const x = Math.max(half + 8, Math.min(w - half - 8, ax));
      if (used.some((u) => Math.abs(u.x - x) < 120 && Math.abs(u.y - y) < 22)) continue;
      used.push({ x, y });
      let el = this.labelPool[n];
      if (!el) {
        el = document.createElement("div");
        el.className = "ltt-label";
        el.addEventListener("click", () => {
          const id = el.dataset.id!;
          const lm = this.ds.landmarks.find((l) => l.id === id)!;
          for (const cb of this.selectListeners) cb({ type: "landmark", landmark: lm });
        });
        this.labelLayer.appendChild(el);
        this.labelPool.push(el);
      }
      if (el.textContent !== text) el.textContent = text;
      el.dataset.id = c.a.lm.id;
      el.dataset.ev = c.a.lm.evidence.startsWith("attested") ? "a" : c.a.lm.evidence === "reconstructed" ? "r" : "c";
      el.style.transform = `translate(-50%, -100%) translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
      el.style.display = "block";
      n++;
    }
    for (let i = n; i < this.labelPool.length; i++) this.labelPool[i].style.display = "none";
  }

  // ---------- diagnostics ----------

  stats(): { fps: number; frameMs: number; worstMs: number; calls: number; triangles: number; instances: number; trees: number; pixelRatio: number; size: [number, number] } {
    const ft = this.frameTimes;
    const avg = ft.reduce((a, v) => a + v, 0) / Math.max(1, ft.length);
    const info = this.renderer.info.render;
    const sz = this.renderer.getSize(new THREE.Vector2());
    return {
      fps: Math.round(1000 / avg), frameMs: +avg.toFixed(2), worstMs: +Math.max(...ft).toFixed(2), calls: info.calls, triangles: info.triangles,
      instances: this.fabric.instanceCount, trees: (this.trees.userData.count as number) ?? 0, pixelRatio: this.renderer.getPixelRatio(), size: [sz.x, sz.y],
    };
  }
  landmarkStatus(id: string, t = this.state.t) {
    return this.landmarks.statusOf(id, t);
  }
  /** Synchronous render time of N frames, bypassing vsync (GPU work is flushed by reading a pixel). */
  benchmark(frames = 40): { msPerFrame: number } {
    if (this.disposed) return { msPerFrame: NaN };
    const gl = this.renderer.getContext();
    const px = new Uint8Array(4);
    const t0 = performance.now();
    for (let i = 0; i < frames; i++) {
      this.renderFrame();
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    }
    return { msPerFrame: +((performance.now() - t0) / frames).toFixed(2) };
  }

  private disposeContent(): void {
    this.content.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose();
    });
    this.content.clear();
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    MIST_PARAMS.fill(0);
    const el = this.renderer.domElement;
    el.removeEventListener("pointerdown", this.onPointerDown);
    window.removeEventListener("pointermove", this.onPointerMove);
    window.removeEventListener("pointerup", this.onPointerUp);
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("resize", this.resize);
    this.disposeContent();
    this.post.dispose();
    this.water.dispose();
    this.cascades.dispose();
    LOOK_A.fill(0);
    LOOK_HEMI.fill(0);
    this.controls.dispose();
    this.renderer.dispose();
    el.remove();
    this.labelLayer.remove();
  }
}
