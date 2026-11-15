import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { Line2 } from "three/examples/jsm/lines/Line2.js";
import { LineGeometry } from "three/examples/jsm/lines/LineGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { sampleKeyframes } from "@/lib/lifecycle";
import type { Evidence } from "@/lib/types";
import { TimeScale, formatHist, histToT } from "@/lib/years";
import { safeT, validYear } from "./data";
import { type HeightGrid, loadHeights, sampleFlood, sampleHeight } from "./heights";
import { ATLAS_COLS, type IconId, ICON_INDEX, INK, IS_SETTLEMENT, KIND_ACCENT, PAPER, buildIconAtlas } from "./icons";
import { MARKER_FS, MARKER_VS, OCEAN_FS, OCEAN_VS, SKY_FS, SKY_VS, SUN, TERRAIN_FS, TERRAIN_VS } from "./shaders";
import { type SurfaceTextures, loadSurface, noiseAt } from "./surface";
import type { LineFeature, LineKind, NationalDataset, Place, PlaceKind, Polity } from "./types";

/**
 * Renderer for the national map. Imperative, like the site Engine, and driven
 * through the same timeline API so one interface can control either.
 *
 * Frame: kilometres. x = east, z = south, y = up; the origin is the centre of
 * the height grid. The projection is equirectangular (straight lines of latitude
 * and longitude), which matches the height image exactly.
 */

/** Heights are drawn this many times taller than true scale when the whole map is in view, so that relief reads at national scale. */
export const VERTICAL_EXAGGERATION = 12;
/** Closer in, the exaggeration eases down to this, so hills keep their true proportions better. */
export const NEAR_EXAGGERATION = 4;
/** Years over which a place marker fades in / out around its phase dates. */
export const PLACE_FADE_YEARS = 8;
/** After a line's `to` year it is kept as a ghost at this opacity for this many years. */
export const LINE_GHOST = { opacity: 0.25, years: 600 };
const KM_PER_DEG = 111.195;

export type Quality = "low" | "medium" | "high";
/** 0 = "auto": constant slider speed (whole timeline in AUTO_SECONDS). Otherwise years per second. */
export type Speed = number;
export const AUTO_SECONDS = 150;

export interface NationalState {
  t: number;
  playing: boolean;
  direction: 1 | -1;
  speed: Speed;
  rate: number;
  quality: Quality;
  fps: number;
  labels: boolean;
  polities: boolean;
  evidence: boolean;
  ready: boolean;
}

export type NationalSelection = { type: "place"; place: Place } | { type: "line"; line: LineFeature } | { type: "polity"; polity: Polity } | null;

/** Quality tiers: drawing resolution cap, relief mesh density, fine texture. */
const QUALITY: Record<Quality, { dpr: number; segments: number; detail: number }> = {
  low: { dpr: 1, segments: 320, detail: 0.4 },
  medium: { dpr: 1.5, segments: 640, detail: 1 },
  high: { dpr: 2, segments: 1024, detail: 1 },
};

const EV_COLOR = { a: 0x40bf8c, r: 0xf2ad33, c: 0xc759d9 } as const;
export const evClass = (e: Evidence): "a" | "r" | "c" => (typeof e === "string" && e.startsWith("attested") ? "a" : e === "reconstructed" ? "r" : "c");

export const PLACE_STYLE: Record<PlaceKind, { label: string }> = {
  city: { label: "City" }, town: { label: "Town" }, port: { label: "Port" }, fort: { label: "Fort" }, hillfort: { label: "Hillfort" },
  monument: { label: "Monument" }, monastery: { label: "Monastery" }, cathedral: { label: "Cathedral" }, castle: { label: "Castle" },
  palace: { label: "Palace" }, battle: { label: "Battle" }, mine: { label: "Mine" }, other: { label: "Place" },
};

/** Line styles: a pale casing under a coloured core, so each line reads on any ground. */
export const LINE_STYLE: Record<LineKind, { color: number; width: number; dash: [number, number] | null; casing: number; casingAlpha: number; label: string }> = {
  "roman-road": { color: 0x9a2f1c, width: 2.0, dash: null, casing: 4.2, casingAlpha: 0.5, label: "Roman road" },
  road: { color: 0x5a3b20, width: 1.6, dash: [6, 4], casing: 3.4, casingAlpha: 0.3, label: "Road" },
  "frontier-wall": { color: 0x231713, width: 3.4, dash: null, casing: 6.4, casingAlpha: 0.5, label: "Frontier wall" },
  dyke: { color: 0x34421c, width: 2.8, dash: [5, 2.5], casing: 5.0, casingAlpha: 0.32, label: "Dyke" },
  "river-route": { color: 0x245f86, width: 1.8, dash: null, casing: 3.8, casingAlpha: 0.4, label: "River route" },
  border: { color: 0x5b3c86, width: 1.7, dash: [10, 3.5], casing: 4.0, casingAlpha: 0.35, label: "Border" },
};

const POLITY_COLORS = ["#b8573c", "#4a7aa6", "#86689f", "#bf9433", "#3a8a78", "#a4547a", "#77893a", "#c4713a"];

interface PhaseRt { t0: number; t1: number; size: number; kind: PlaceKind; label: string }
interface PlaceRt {
  place: Place;
  pos: THREE.Vector3;
  phases: PhaseRt[];
  names: { name: string; t0: number; t1: number }[];
  peak: number;
  // evaluated for the current year
  alpha: number;
  size: number;
  kind: PlaceKind;
  ring: boolean;
  name: string;
  // evaluated for the current camera
  sx: number;
  sy: number;
  onScreen: boolean;
  radius: number;
  collapsed: boolean;
}
interface LineRt {
  line: LineFeature;
  t0: number;
  t1: number;
  obj: Line2;
  mat: LineMaterial;
  casing: Line2;
  casingMat: LineMaterial;
  pts: THREE.Vector3[];
  mid: THREE.Vector3;
  alpha: number;
  screen: Float32Array;
}
interface PolityRt {
  polity: Polity;
  t0: number;
  t1: number;
  pos: THREE.Vector3;
  color: string;
  ring: [number, number][] | null; // overlay canvas pixels
  latlon: [number, number][] | null;
  world: THREE.Vector3[] | null;
  area: number;
  alpha: number;
}
interface LabelBox { x0: number; y0: number; x1: number; y1: number; sel: NationalSelection; major?: boolean }
interface CamAnim { p0: THREE.Vector3; t0: THREE.Vector3; p1: THREE.Vector3; t1: THREE.Vector3; start: number; dur: number; hop: number; done?: () => void }

export interface NationalInit {
  t?: number;
  quality?: Quality;
  labels?: boolean;
  polities?: boolean;
  evidence?: boolean;
}

const reducedMotion = () => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
const automated = () => typeof navigator !== "undefined" && !!(navigator as Navigator & { webdriver?: boolean }).webdriver;
const ease = (k: number) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);

export class NationalEngine {
  readonly scale: TimeScale;
  readonly exaggeration = VERTICAL_EXAGGERATION;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private state: NationalState;
  private listeners = new Set<(s: NationalState) => void>();
  private selectListeners = new Set<(s: NationalSelection) => void>();
  private enterListeners = new Set<(siteId: string, place: Place) => void>();
  private viewListeners = new Set<(v: { heading: number; kmPerPx: number }) => void>();
  private lastView = { heading: NaN, kmPerPx: NaN, at: 0 };
  private glide: { from: number; to: number; start: number; dur: number } | null = null;
  private selection: NationalSelection = null;
  private hovered: PlaceRt | null = null;

  // projection (terrain grid frame)
  private lat0: number;
  private lon0: number;
  private kx: number;
  private rect: { xMin: number; zMin: number; w: number; d: number };
  private limit: { xMin: number; xMax: number; zMin: number; zMax: number };

  private heightTex: THREE.DataTexture;
  private terrainMat: THREE.ShaderMaterial;
  private terrainMesh: THREE.Mesh | null = null;
  private ocean: THREE.Mesh;
  private sky: THREE.Mesh;
  private polCanvas: HTMLCanvasElement;
  private polTex: THREE.CanvasTexture;
  private polSig = "";
  private lastPolDraw = 0;
  private woodQuantiles: Float32Array;

  private places: PlaceRt[] = [];
  private markerGeo = new THREE.InstancedBufferGeometry();
  private markerMat: THREE.ShaderMaterial;
  private markers: THREE.Mesh;
  private atlasTex: THREE.CanvasTexture;
  private lines: LineRt[] = [];
  private lineGroup = new THREE.Group();
  /** Holds everything draped on the relief; scaled in height with the live exaggeration. */
  private drape = new THREE.Group();
  private exag = VERTICAL_EXAGGERATION;
  private polities: PolityRt[] = [];

  private labelLayer: HTMLDivElement;
  private labelPool: HTMLDivElement[] = [];
  private hoverCard: HTMLDivElement;
  private labelBoxes: LabelBox[] = [];
  private labelCount = 0;
  private measureCtx: CanvasRenderingContext2D;
  private widths = new Map<string, number>();
  private labelsDirty = true;
  private camSig = "";

  private raf = 0;
  private last = 0;
  private lastEmit = 0;
  private dirty = true;
  private frameTimes: number[] = [];
  private drag: { x: number; y: number; moved: number } | null = null;
  private lastClick = 0;
  private disposed = false;
  private home = { position: new THREE.Vector3(), target: new THREE.Vector3() };
  private fitDistance = 1200;
  private anim: CamAnim | null = null;
  /** Screen rectangles (CSS px, relative to the stage) covered by the interface: labels keep out of them. */
  private obstacles: { x0: number; y0: number; x1: number; y1: number }[] = [];
  private motion = 1;
  private mq: MediaQueryList | null = null;

  /** Loads the height image (or its stand-in), the shading products and the symbol atlas, and builds the engine. */
  static async create(container: HTMLElement, ds: NationalDataset, init: NationalInit = {}): Promise<NationalEngine> {
    const [grid, surface, atlas] = await Promise.all([loadHeights(ds.terrain), loadSurface(ds.terrain, 8), buildIconAtlas()]);
    return new NationalEngine(container, ds, grid, init, surface, atlas);
  }

  constructor(private container: HTMLElement, readonly ds: NationalDataset, readonly grid: HeightGrid, init: NationalInit = {}, private surf?: SurfaceTextures, atlas?: HTMLCanvasElement) {
    this.scale = new TimeScale(ds.site.timeline.scale);
    const firstPreset = ds.eras.find((e) => validYear(e.presetYear))?.presetYear ?? ds.site.timeline.start;
    this.state = {
      t: this.scale.clamp(Number.isFinite(init.t) ? (init.t as number) : histToT(firstPreset)),
      playing: false, direction: 1, speed: 0, rate: 1, quality: init.quality ?? "medium", fps: 0,
      labels: init.labels ?? true, polities: init.polities ?? true, evidence: init.evidence ?? false, ready: false,
    };
    this.motion = reducedMotion() ? 0 : 1;

    const gb = grid.bounds;
    this.lat0 = (gb.latMin + gb.latMax) / 2;
    this.lon0 = (gb.lonMin + gb.lonMax) / 2;
    this.kx = KM_PER_DEG * Math.cos(THREE.MathUtils.degToRad(this.lat0));
    const w = (gb.lonMax - gb.lonMin) * this.kx, d = (gb.latMax - gb.latMin) * KM_PER_DEG;
    this.rect = { xMin: -w / 2, zMin: -d / 2, w, d };
    const sb = ds.site.bounds;
    const [lx0, lz0] = this.toXZ(Math.min(gb.latMax, sb.latMax), Math.max(gb.lonMin, sb.lonMin));
    const [lx1, lz1] = this.toXZ(Math.max(gb.latMin, sb.latMin), Math.min(gb.lonMax, sb.lonMax));
    this.limit = { xMin: lx0, xMax: lx1, zMin: lz0, zMax: lz1 };

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance", preserveDrawingBuffer: true });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.info.autoReset = false;
    this.renderer.setClearColor(0x1a2530);
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.style.display = "block";

    this.camera = new THREE.PerspectiveCamera(32, 1, 2, 30000);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.1;
    this.controls.screenSpacePanning = false;
    this.controls.zoomToCursor = true;
    this.controls.minPolarAngle = 0;
    this.controls.maxPolarAngle = 1.12; // about 64° from vertical: a map, not a flight simulator
    this.controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
    this.controls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE };

    this.labelLayer = document.createElement("div");
    this.labelLayer.className = "nat-labels";
    container.appendChild(this.labelLayer);
    this.hoverCard = document.createElement("div");
    this.hoverCard.className = "nat-hovercard";
    this.hoverCard.setAttribute("role", "presentation");
    this.labelLayer.appendChild(this.hoverCard);
    this.measureCtx = document.createElement("canvas").getContext("2d")!;

    // --- height texture (half float: linear filtering is core WebGL2) ---
    // R = elevation (m), G = flood level (m): decoded on the CPU, so filtering here is safe.
    // The flood level near sea level is softened a little for drawing only (the hit tests keep the exact grid), so the
    // coast through flat marsh and tidal flats is a smooth line rather than the steps of the 300 m cells.
    const soft = softenNearZero(grid.flood, grid.width, grid.height);
    const half = new Uint16Array(grid.width * grid.height * 2);
    for (let i = 0; i < grid.data.length; i++) {
      half[i * 2] = THREE.DataUtils.toHalfFloat(grid.data[i]);
      half[i * 2 + 1] = THREE.DataUtils.toHalfFloat(soft[i]);
    }
    this.heightTex = new THREE.DataTexture(half, grid.width, grid.height, THREE.RGFormat, THREE.HalfFloatType);
    // a mip chain built here (half-float mipmaps cannot be relied on from the driver), so the coast stays smooth seen from afar
    this.heightTex.mipmaps = heightMips({ ...grid, flood: soft }, half);
    this.heightTex.generateMipmaps = false;
    this.heightTex.magFilter = THREE.LinearFilter;
    this.heightTex.minFilter = THREE.LinearMipmapLinearFilter;
    this.heightTex.wrapS = this.heightTex.wrapT = THREE.ClampToEdgeWrapping;
    this.heightTex.needsUpdate = true;

    // --- polity overlay: indicative extents painted into a map-space canvas and draped by the terrain shader ---
    this.polCanvas = document.createElement("canvas");
    this.polCanvas.width = 768;
    this.polCanvas.height = Math.max(64, Math.min(1400, Math.round((768 * d) / w)));
    this.polTex = new THREE.CanvasTexture(this.polCanvas);
    this.polTex.flipY = false;
    this.polTex.colorSpace = THREE.SRGBColorSpace;
    this.polTex.premultiplyAlpha = true;
    this.polTex.generateMipmaps = false;
    this.polTex.minFilter = this.polTex.magFilter = THREE.LinearFilter;

    const C = (hex: number) => ({ value: new THREE.Color(hex) });
    const sunEl = THREE.MathUtils.degToRad(SUN.elevationDeg), sunAz = THREE.MathUtils.degToRad(SUN.azimuthDeg);
    const sunDir = new THREE.Vector3(Math.sin(sunAz) * Math.cos(sunEl), Math.sin(sunEl), -Math.cos(sunAz) * Math.cos(sunEl)).normalize();
    const blank = new THREE.DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1);
    blank.needsUpdate = true;
    const lib = {
      uNoise: { value: surf?.noise ?? blank },
      uSunDir: { value: sunDir },
      uSunCol: { value: new THREE.Color(1.0, 0.93, 0.83).multiplyScalar(2.6) },
      uSkyCol: { value: new THREE.Color(0.36, 0.47, 0.66).multiplyScalar(1.0) },
      uHaze: C(0xc2cfd4),
      uHazeK: { value: 0.0006 },
      uTime: { value: 0 },
      uMotion: { value: this.motion },
    };
    const shared = {
      ...lib,
      uH: { value: this.heightTex },
      uRel: { value: surf?.relief ?? blank },
      uSurf: { value: surf?.surface ?? blank },
      uWat: { value: surf?.water ?? blank },
      uPol: { value: this.polTex },
      uRect: { value: new THREE.Vector4(this.rect.xMin, this.rect.zMin, 1 / w, 1 / d) },
      uTexel: { value: new THREE.Vector2(1 / grid.width, 1 / grid.height) },
      uCell: { value: new THREE.Vector2(w / grid.width, d / grid.height) },
      uSea: { value: 0 },
      uExag: { value: VERTICAL_EXAGGERATION / 1000 },
      uWood: { value: 0.3 },
      uWoodThr: { value: 0.5 },
      uFarm: { value: 0.5 },
      uCarr: { value: 0 },
      uPolOn: { value: 1 },
      uLight: { value: 5.0 },
      uDetail: { value: QUALITY[this.state.quality].detail },
      cGrass: C(0x66794a), cDown: C(0x9b9a68), cWood: C(0x39532f), cWood2: C(0x4a653b), cCarr: C(0x3b4f33), cReed: C(0x8a8458), cSedge: C(0x6f7b4c),
      cHeath: C(0x86805a), cMoor: C(0x6c5c4c), cRock: C(0x8a867d), cSand: C(0xd6c69c), cWetSand: C(0xa19473), cMud: C(0x766d5c),
      cFieldA: C(0xa79c63), cFieldB: C(0x7e924f), cFieldC: C(0x998660), cFieldD: C(0x63804a),
      cShallow: C(0x4e9a95), cShelf: C(0x22677a), cDeep: C(0x123b51), cOpen: C(0x1a5468), cTurbid: C(0x6c8a72), cFoam: C(0xf2f5f0), cRiver: C(0x2e6c7c), cLake: C(0x1d4e5d),
    };
    this.terrainMat = new THREE.ShaderMaterial({ uniforms: shared, vertexShader: TERRAIN_VS, fragmentShader: TERRAIN_FS });

    // open sea beyond the height grid, out to the horizon
    this.ocean = new THREE.Mesh(
      new THREE.RingGeometry(1, 14000, 64, 1).rotateX(-Math.PI / 2),
      new THREE.ShaderMaterial({ uniforms: { ...lib, cOpen: shared.cOpen }, vertexShader: OCEAN_VS, fragmentShader: OCEAN_FS }),
    );
    this.ocean.position.y = -0.6;
    this.ocean.renderOrder = -2;
    this.scene.add(this.ocean);

    this.sky = new THREE.Mesh(
      new THREE.SphereGeometry(12000, 32, 16),
      new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false, uniforms: { uHaze: lib.uHaze, cTop: C(0x5a7fa3), uSunDir: lib.uSunDir }, vertexShader: SKY_VS, fragmentShader: SKY_FS }),
    );
    this.sky.renderOrder = -3;
    this.sky.frustumCulled = false;
    this.scene.add(this.sky);

    // markers: instanced quads drawn from the symbol atlas
    this.atlasTex = new THREE.CanvasTexture(atlas ?? document.createElement("canvas"));
    this.atlasTex.colorSpace = THREE.NoColorSpace;
    this.atlasTex.flipY = false;
    this.atlasTex.premultiplyAlpha = true;
    this.atlasTex.generateMipmaps = true;
    this.atlasTex.minFilter = THREE.LinearMipmapLinearFilter;
    this.atlasTex.anisotropy = 4;
    this.markerMat = new THREE.ShaderMaterial({
      transparent: true, depthTest: false, depthWrite: false,
      uniforms: {
        uAtlas: { value: this.atlasTex }, uViewport: { value: new THREE.Vector2(1, 1) }, uTime: lib.uTime, uMotion: lib.uMotion,
        uCols: { value: ATLAS_COLS }, cInk: { value: new THREE.Color(INK) }, cGilt: { value: new THREE.Color(0xe9b84f) },
      },
      vertexShader: MARKER_VS,
      fragmentShader: MARKER_FS,
    });
    this.markers = new THREE.Mesh(this.markerGeo, this.markerMat);
    this.markers.frustumCulled = false;
    this.markers.renderOrder = 30;
    this.lineGroup.renderOrder = 20;
    this.drape.add(this.lineGroup, this.markers);
    this.scene.add(this.drape);

    this.woodQuantiles = this.buildWoodQuantiles();
    this.buildTerrain();
    this.buildPlaces();
    this.buildLines();
    this.buildPolities();
    this.resize();
    this.computeHome();
    this.applyHome();
    this.applyYear();

    const el = this.renderer.domElement;
    el.addEventListener("pointerdown", this.onPointerDown);
    el.addEventListener("pointermove", this.onHover);
    el.addEventListener("pointerleave", this.onLeave);
    el.addEventListener("wheel", this.cancelAnim, { passive: true });
    el.addEventListener("contextmenu", this.onContext);
    window.addEventListener("pointermove", this.onPointerMove);
    window.addEventListener("pointerup", this.onPointerUp);
    window.addEventListener("resize", this.resize);
    this.mq = window.matchMedia?.("(prefers-reduced-motion: reduce)") ?? null;
    this.mq?.addEventListener?.("change", this.onMotionPref);
    this.state.ready = true;
    this.last = performance.now();
    // an opening move onto the whole map; skipped for automated browsers and reduced motion
    if (this.motion && !automated() && !Number.isNaN(this.home.position.x)) {
      const p1 = this.home.position.clone(), t1 = this.home.target.clone();
      const off = p1.clone().sub(t1);
      this.camera.position.copy(t1).add(off.multiplyScalar(1.22).applyAxisAngle(new THREE.Vector3(0, 1, 0), 0.12));
      this.controls.update();
      this.anim = { p0: this.camera.position.clone(), t0: t1.clone(), p1, t1, start: performance.now() + 250, dur: 2400, hop: 0 };
    }
    this.raf = requestAnimationFrame(this.frame);
  }

  // ---------- geography ----------

  /** Latitude/longitude -> local kilometres [x east, z south]. */
  toXZ(lat: number, lon: number): [number, number] {
    return [(lon - this.lon0) * this.kx, -(lat - this.lat0) * KM_PER_DEG];
  }
  toLatLon(x: number, z: number): [number, number] {
    return [this.lat0 - z / KM_PER_DEG, this.lon0 + x / this.kx];
  }
  private seaLevel(t = this.state.t): number {
    const kf = this.ds.terrain.seaLevel.filter((k) => validYear(k.year) && Number.isFinite(k.value));
    return kf.length ? sampleKeyframes(kf, t) : 0;
  }
  private woodland(t = this.state.t): number {
    const kf = this.ds.site.woodland.cover.filter((k) => validYear(k.year) && Number.isFinite(k.value));
    return kf.length ? sampleKeyframes(kf, t) : 0.2;
  }
  /** Rendered surface height (km, exaggerated) at a point: land, or the sea surface of the present. */
  private surfaceY(lat: number, lon: number): number {
    return (Math.max(sampleHeight(this.grid, lat, lon), 0) * VERTICAL_EXAGGERATION) / 1000;
  }
  /** Surface height (km) as drawn now, with the live exaggeration. */
  private surfaceYxz(x: number, z: number): number {
    const [lat, lon] = this.toLatLon(x, z);
    return this.surfaceY(lat, lon) * this.drape.scale.y;
  }
  /** Exaggeration for a camera distance: full when the whole map is in view, easing down closer in. */
  private exagFor(dist: number): number {
    const far = this.fitDistance * 0.55, close = 45;
    const k = THREE.MathUtils.clamp(Math.log(dist / close) / Math.log(far / close), 0, 1);
    return NEAR_EXAGGERATION + (VERTICAL_EXAGGERATION - NEAR_EXAGGERATION) * k * k * (3 - 2 * k);
  }
  private applyExag(e: number): void {
    if (Math.abs(e - this.exag) < 1e-3) return;
    this.exag = e;
    this.terrainMat.uniforms.uExag.value = e / 1000;
    this.drape.scale.y = e / VERTICAL_EXAGGERATION;
    this.ocean.position.y = (this.terrainMat.uniforms.uSea.value * e) / 1000 - 0.6;
    this.labelsDirty = true;
  }

  /**
   * The woodland mask is generic noise; the year's national cover fraction picks its threshold. Sampling the same
   * noise the shader reads gives the threshold that wooded that share of the ground where trees can grow.
   */
  private buildWoodQuantiles(): Float32Array {
    const nd = this.surf?.noiseData;
    const out = new Float32Array(201);
    if (!nd) {
      for (let i = 0; i <= 200; i++) out[i] = 0.3 + 0.4 * (i / 200);
      return out;
    }
    // the same lookups as fbmk() in shaders.ts at close range (rotated octaves, offsets per octave)
    const rot = (x: number, z: number): [number, number] => [0.8 * x - 0.6 * z, 0.6 * x + 0.8 * z];
    const nk = (x: number, z: number, f: number, o: number) => noiseAt(nd, x * f + o, z * f + o, 0);
    const fbm = (x: number, z: number, f: number, o: number) => {
      const [x2, z2] = rot(x, z), [x3, z3] = rot(x2, z2);
      return (nk(x, z, f, o) + 0.5 * nk(x2, z2, f * 2.03, o + 0.31) + 0.25 * nk(x3, z3, f * 4.11, o + 0.17)) / 1.75;
    };
    const s: number[] = [];
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 6000; i++) {
      const x = rnd() * 700, z = rnd() * 700;
      // domain warp from channels 1 and 2, as in the shader
      const qx = x + (noiseAt(nd, x * 0.004 + 0.37, z * 0.004 + 0.37, 1) - 0.5) * 18, qz = z + (noiseAt(nd, x * 0.004 + 0.37, z * 0.004 + 0.37, 2) - 0.5) * 18;
      const [rx, rz] = rot(qx, qz);
      const [r2x, r2z] = rot(...rot(x, z));
      s.push(fbm(qx, qz, 0.013, 3.7) * 0.5 + fbm(rx, rz, 0.031, 1.1) * 0.3 + nk(r2x, r2z, 0.09, 0.6) * 0.2);
    }
    s.sort((a, b) => a - b);
    for (let i = 0; i <= 200; i++) out[i] = s[Math.min(s.length - 1, Math.round((i / 200) * (s.length - 1)))];
    return out;
  }
  private woodThreshold(cover: number): number {
    // the data are a share of all land; about four fifths of the land is ground the mask lets trees grow on
    const share = THREE.MathUtils.clamp(cover / 0.8, 0, 0.985);
    return this.woodQuantiles[Math.round((1 - share) * 200)];
  }

  // ---------- scene construction ----------

  /** Relief meshes at the quality's density and at a half and a quarter of it, built when first needed. */
  private terrainGeos = new Map<number, THREE.BufferGeometry>();
  private terrainGeo(segments: number): THREE.BufferGeometry {
    let g = this.terrainGeos.get(segments);
    if (!g) {
      const nz = Math.max(2, Math.round((segments * this.rect.d) / this.rect.w));
      g = new THREE.PlaneGeometry(this.rect.w, this.rect.d, segments, nz).rotateX(-Math.PI / 2);
      g.deleteAttribute("normal");
      g.deleteAttribute("uv");
      this.terrainGeos.set(segments, g);
    }
    return g;
  }
  private buildTerrain(): void {
    for (const g of this.terrainGeos.values()) g.dispose();
    this.terrainGeos.clear();
    const q = QUALITY[this.state.quality];
    if (!this.terrainMesh) {
      this.terrainMesh = new THREE.Mesh(this.terrainGeo(q.segments), this.terrainMat);
      this.terrainMesh.frustumCulled = false;
      this.terrainMesh.renderOrder = 0;
      this.scene.add(this.terrainMesh);
    } else this.terrainMesh.geometry = this.terrainGeo(q.segments);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.dpr));
    this.terrainMat.uniforms.uDetail.value = q.detail;
    // Low drops the finest texture layers from the shader altogether
    const low = this.state.quality === "low";
    if (low !== "LOWQ" in this.terrainMat.defines) {
      if (low) this.terrainMat.defines.LOWQ = "";
      else delete this.terrainMat.defines.LOWQ;
      this.terrainMat.needsUpdate = true;
    }
  }
  /**
   * Seen from afar the full mesh has triangles smaller than a pixel, which costs a lot and adds nothing: use the
   * coarsest level whose vertices are still about three device pixels apart at the centre of the view.
   */
  private pickTerrainLod(kmPerPx: number): void {
    if (!this.terrainMesh) return;
    const q = QUALITY[this.state.quality];
    const kmPerDev = kmPerPx / this.renderer.getPixelRatio();
    const want = this.rect.w / Math.max(1e-3, 2.6 * kmPerDev);
    let seg = q.segments;
    for (const k of [0.25, 0.5, 0.7]) {
      const s = Math.round(q.segments * k);
      if (s >= Math.max(160, want)) { seg = s; break; }
    }
    const g = this.terrainGeo(seg);
    if (this.terrainMesh.geometry !== g) this.terrainMesh.geometry = g;
  }

  private buildPlaces(): void {
    const END = Infinity;
    for (const place of this.ds.places) {
      if (!Number.isFinite(place.lat) || !Number.isFinite(place.lon) || !Array.isArray(place.phases)) continue;
      const phases: PhaseRt[] = [];
      for (const p of place.phases) {
        const t0 = safeT(p.from);
        if (!Number.isFinite(t0)) continue;
        let t1 = p.to == null ? END : safeT(p.to);
        if (!Number.isFinite(t1) && t1 !== END) t1 = END;
        if (t1 <= t0) t1 = t0 + 1; // a single-year entry (a battle) lasts that year
        phases.push({ t0, t1, size: Math.max(0, Math.min(5, Number(p.size) || 0)), kind: (p.kind ?? place.kind) in PLACE_STYLE ? (p.kind ?? place.kind) : "other", label: p.label });
      }
      if (!phases.length) continue;
      phases.sort((a, b) => a.t0 - b.t0);
      // Data files differ on whether `to` is the last year of a phase or the first year after it.
      // Either way a phase runs until its successor starts when they are at most a year apart,
      // and a final dated phase includes its `to` year.
      for (let i = 0; i < phases.length; i++) {
        const next = phases[i + 1];
        if (next && next.t0 - phases[i].t1 <= 1 && next.t0 > phases[i].t0) phases[i].t1 = next.t0;
        else if (!next && phases[i].t1 !== END) phases[i].t1 += 1;
      }
      const names = (place.altNames ?? [])
        .map((a) => ({ name: a.name, t0: safeT(a.from), t1: a.to == null ? END : safeT(a.to) + 1 }))
        .filter((a) => Number.isFinite(a.t0) && !Number.isNaN(a.t1));
      const [x, z] = this.toXZ(place.lat, place.lon);
      this.places.push({
        place, phases, names, pos: new THREE.Vector3(x, this.surfaceY(place.lat, place.lon) + 0.2, z), peak: Math.max(...phases.map((f) => f.size)),
        alpha: 0, size: 0, kind: place.kind, ring: false, name: place.name, sx: 0, sy: 0, onScreen: false, radius: 0, collapsed: false,
      });
    }
    // small things first so the larger markers are drawn over them; places with a site last of all
    this.places.sort((a, b) => Number(!!a.place.site) - Number(!!b.place.site) || a.peak - b.peak);
    const n = this.places.length;
    const quad = new THREE.PlaneGeometry(2, 2);
    this.markerGeo.index = quad.index;
    this.markerGeo.setAttribute("position", quad.getAttribute("position"));
    const inst = new Float32Array(n * 3);
    this.places.forEach((p, i) => p.pos.toArray(inst, i * 3));
    this.markerGeo.setAttribute("aInst", new THREE.InstancedBufferAttribute(inst, 3));
    this.markerGeo.setAttribute("aStyle", new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4).setUsage(THREE.DynamicDrawUsage));
    this.markerGeo.setAttribute("aTint", new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage));
    this.markerGeo.setAttribute("aAcc", new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage));
    this.markerGeo.instanceCount = n;
  }

  private buildLines(): void {
    for (const line of this.ds.lines) {
      const t0 = safeT(line.from);
      const path = (line.path ?? []).filter((v) => Array.isArray(v) && Number.isFinite(v[0]) && Number.isFinite(v[1]));
      if (!Number.isFinite(t0) || path.length < 2) continue;
      const t1 = line.to == null ? Infinity : Number.isFinite(safeT(line.to)) ? safeT(line.to) : Infinity;
      const style = LINE_STYLE[line.kind] ?? LINE_STYLE.road;
      // drape: subdivide so no piece is longer than ~1.5 km, and sit just above the surface
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i < path.length - 1; i++) {
        const [la0, lo0] = path[i], [la1, lo1] = path[i + 1];
        const [x0, z0] = this.toXZ(la0, lo0), [x1, z1] = this.toXZ(la1, lo1);
        const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 1.5));
        for (let k = i === 0 ? 0 : 1; k <= n; k++) {
          const f = k / n;
          const la = la0 + (la1 - la0) * f, lo = lo0 + (lo1 - lo0) * f;
          const [x, z] = this.toXZ(la, lo);
          pts.push(new THREE.Vector3(x, this.surfaceY(la, lo) + 0.12, z));
        }
      }
      const geo = new LineGeometry();
      geo.setPositions(pts.flatMap((p) => [p.x, p.y, p.z]));
      const casingMat = new LineMaterial({ color: 0xf3ead6, linewidth: style.casing, transparent: true, opacity: 0, depthTest: false, depthWrite: false, worldUnits: false });
      const casing = new Line2(geo, casingMat);
      casing.computeLineDistances();
      casing.frustumCulled = false;
      casing.renderOrder = 20;
      const mat = new LineMaterial({
        color: style.color, linewidth: style.width, transparent: true, opacity: 0, depthTest: false, depthWrite: false,
        dashed: !!style.dash, dashSize: style.dash?.[0] ?? 1, gapSize: style.dash?.[1] ?? 0, worldUnits: false,
      });
      const obj = new Line2(geo, mat);
      obj.computeLineDistances();
      obj.frustumCulled = false;
      obj.renderOrder = line.kind === "frontier-wall" || line.kind === "dyke" ? 22 : 21;
      this.lineGroup.add(casing, obj);
      this.lines.push({ line, t0, t1, obj, mat, casing, casingMat, pts, mid: pts[Math.floor(pts.length / 2)], alpha: 0, screen: new Float32Array(pts.length * 2) });
    }
  }

  private buildPolities(): void {
    const gb = this.grid.bounds;
    const cw = this.polCanvas.width, ch = this.polCanvas.height;
    this.ds.polities.forEach((polity, i) => {
      const t0 = safeT(polity.from);
      if (!Number.isFinite(t0) || !Array.isArray(polity.labelAt)) return;
      const t1 = polity.to == null ? Infinity : Number.isFinite(safeT(polity.to)) ? safeT(polity.to) : Infinity;
      const [lat, lon] = polity.labelAt;
      const [x, z] = this.toXZ(lat, lon);
      const latlon = polity.polygon && polity.polygon.length >= 3 ? polity.polygon.filter((v) => Array.isArray(v) && Number.isFinite(v[0]) && Number.isFinite(v[1])) : null;
      const ring = latlon ? latlon.map(([la, lo]) => [((lo - gb.lonMin) / (gb.lonMax - gb.lonMin)) * cw, ((gb.latMax - la) / (gb.latMax - gb.latMin)) * ch] as [number, number]) : null;
      const world = latlon ? latlon.map(([la, lo]) => { const [wx, wz] = this.toXZ(la, lo); return new THREE.Vector3(wx, this.surfaceY(la, lo), wz); }) : null;
      let area = Infinity;
      if (latlon) {
        area = 0;
        for (let a = 0, b = latlon.length - 1; a < latlon.length; b = a++) area += latlon[b][1] * latlon[a][0] - latlon[a][1] * latlon[b][0];
        area = Math.abs(area / 2);
      }
      let hsh = 0;
      for (const c of polity.id) hsh = (hsh * 31 + c.charCodeAt(0)) >>> 0;
      this.polities.push({
        polity, t0, t1, pos: new THREE.Vector3(x, this.surfaceY(lat, lon) + 0.3, z), color: POLITY_COLORS[(hsh + i) % POLITY_COLORS.length],
        ring, latlon, world, area, alpha: 0,
      });
    });
  }

  // ---------- timeline ----------

  private applyYear(): void {
    const t = this.state.t;
    const u = this.terrainMat.uniforms;
    u.uSea.value = this.seaLevel(t);
    const wood = this.woodland(t);
    u.uWood.value = wood;
    u.uWoodThr.value = this.woodThreshold(wood);
    // generic trends, not data: the field patchwork grows as the woodland figure falls; fen carr in the early millennia
    u.uFarm.value = THREE.MathUtils.clamp((0.62 - wood) / 0.5, 0, 1);
    u.uCarr.value = THREE.MathUtils.clamp((-1500 - t) / 1500, 0, 1);
    this.ocean.position.y = (u.uSea.value * this.exag) / 1000 - 0.6;

    for (const p of this.places) this.evalPlace(p, t);
    this.updateMarkers();

    const selLine = this.selection?.type === "line" ? this.selection.line.id : null;
    for (const l of this.lines) {
      let a = 0;
      if (t >= l.t0) {
        if (t < l.t1) a = Math.min(1, 0.35 + (t - l.t0) / PLACE_FADE_YEARS);
        else {
          const dt = t - l.t1;
          // drop to the ghost over a decade, hold, then fade out over the last fifty years
          a = dt < 10 ? 1 - (1 - LINE_GHOST.opacity) * (dt / 10) : dt < LINE_GHOST.years ? LINE_GHOST.opacity * Math.min(1, (LINE_GHOST.years - dt) / 50) : 0;
        }
      }
      l.alpha = a;
      l.obj.visible = l.casing.visible = a > 0.004;
      l.mat.opacity = a;
      const st = LINE_STYLE[l.line.kind] ?? LINE_STYLE.road;
      l.casingMat.opacity = a * st.casingAlpha;
      l.mat.color.setHex(this.state.evidence ? EV_COLOR[evClass(l.line.evidence)] : st.color);
      const sel = l.line.id === selLine ? 1.7 : 1;
      l.mat.linewidth = st.width * sel;
      l.casingMat.linewidth = st.casing * sel;
      l.casingMat.color.setHex(l.line.id === selLine ? 0xfff6dc : 0xf3ead6);
    }

    const FADE = 15;
    let sig = this.state.polities ? "" : "off";
    for (const p of this.polities) {
      let a = 0;
      if (t >= p.t0) a = t < p.t1 ? Math.min(1, 0.3 + (t - p.t0) / FADE) : Math.max(0, 1 - (t - p.t1) / FADE);
      p.alpha = a;
      if (a > 0 && p.ring) sig += `${p.polity.id}:${Math.round(a * 20)};`;
    }
    const selPol = this.selection?.type === "polity" ? this.selection.polity.id : "";
    sig += "|" + selPol;
    u.uPolOn.value = this.state.polities ? 1 : 0;
    if (sig !== this.polSig) this.drawPolities(sig);
    this.labelsDirty = true;
  }

  /** Marker size in CSS pixels (before the zoom factor): dots grow with the size of a settlement, symbols less so. */
  private markerPx(p: PlaceRt): number {
    if (p.collapsed) return 6.5;
    if (p.ring) return 13;
    const icon = this.iconFor(p);
    return (IS_SETTLEMENT[icon] ? 8 + 3.1 * p.size : 16 + 2.0 * p.size) / 0.925;   // the atlas draws symbols at 0.74 of a cell
  }
  private iconFor(p: PlaceRt): IconId {
    if (p.ring) return "gone";
    if (p.collapsed) return "pip";
    return (p.kind in ICON_INDEX ? p.kind : "other") as IconId;
  }

  private updateMarkers(): void {
    const style = this.markerGeo.getAttribute("aStyle") as THREE.InstancedBufferAttribute;
    const tint = this.markerGeo.getAttribute("aTint") as THREE.InstancedBufferAttribute;
    const acc = this.markerGeo.getAttribute("aAcc") as THREE.InstancedBufferAttribute;
    const c = new THREE.Color(), a = new THREE.Color();
    const selId = this.selection?.type === "place" ? this.selection.place.id : null;
    const zoom = this.zoomFactor(this.camera.position.distanceTo(this.controls.target));
    this.places.forEach((p, i) => {
      const icon = this.iconFor(p);
      const px = this.markerPx(p) * zoom;
      const flags = (p.ring ? 1 : 0) + (p.place.site ? 2 : 0) + (p.place.id === selId ? 4 : 0) + (this.hovered === p ? 8 : 0);
      // the selected place is always drawn clearly while it exists at all
      const alpha = p.place.id === selId && p.alpha > 0.01 ? Math.max(p.alpha, 0.95) : p.collapsed ? p.alpha * 0.85 : p.alpha;
      style.setXYZW(i, px, ICON_INDEX[icon], alpha, flags);
      if (this.state.evidence) {
        c.setHex(EV_COLOR[evClass(p.place.evidence)]);
        a.copy(c);
      } else {
        // a dot keeps the colour of what it stands for
        const k = (p.kind in KIND_ACCENT ? p.kind : "other") as IconId;
        c.set(p.collapsed && KIND_ACCENT[k] !== PAPER ? KIND_ACCENT[k] : PAPER);
        a.set(KIND_ACCENT[icon]);
      }
      tint.setXYZ(i, c.r, c.g, c.b);
      acc.setXYZ(i, a.r, a.g, a.b);
    });
    style.needsUpdate = tint.needsUpdate = acc.needsUpdate = true;
  }

  private evalPlace(p: PlaceRt, t: number): void {
    let cur: PhaseRt | null = null, prev: PhaseRt | null = null;
    for (const f of p.phases) {
      if (f.t0 <= t && t < f.t1) cur = f;
      else if (f.t1 <= t) prev = !prev || f.t1 >= prev.t1 ? f : prev;
    }
    if (cur) {
      const continues = prev != null && prev.t1 >= cur.t0 - 0.001;
      const f = Math.min(1, (t - cur.t0) / PLACE_FADE_YEARS);
      // a one-year entry (a battle) is shown at full strength in its year
      p.alpha = continues || cur.t1 - cur.t0 <= 1.001 ? 1 : Math.min(1, 0.4 + f);
      p.kind = cur.kind;
      p.ring = cur.size === 0;
      // sizes ease from the previous phase rather than jump
      p.size = continues && prev && prev.size > 0 && cur.size > 0 ? prev.size + (cur.size - prev.size) * f : cur.size;
      if (p.ring) p.alpha *= 0.8;
    } else if (prev) {
      const span = prev.kind === "battle" ? 40 : PLACE_FADE_YEARS;
      p.alpha = Math.max(0, 1 - (t - prev.t1) / span);
      p.kind = prev.kind;
      p.ring = prev.size === 0;
      p.size = prev.size;
    } else p.alpha = 0;
    let name = p.place.name;
    for (const a of p.names) if (a.t0 <= t && t < a.t1) name = a.name;
    p.name = name;
  }

  private drawPolities(sig: string): void {
    const now = performance.now();
    // during playback the alphas change every frame: repaint at most ~12 times a second
    if (now - this.lastPolDraw < 80 && this.polSig !== "") {
      this.dirty = true;
      return;
    }
    this.lastPolDraw = now;
    this.polSig = sig;
    const ctx = this.polCanvas.getContext("2d")!;
    const cw = this.polCanvas.width, ch = this.polCanvas.height;
    ctx.clearRect(0, 0, cw, ch);
    if (!this.state.polities) {
      this.polTex.needsUpdate = true;
      return;
    }
    const trace = (ring: [number, number][]) => {
      ctx.beginPath();
      ring.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.closePath();
    };
    const canBlur = "filter" in ctx;
    const selId = this.selection?.type === "polity" ? this.selection.polity.id : null;
    // largest first, so small polities inside big ones stay visible
    const act = this.polities.filter((p) => p.alpha > 0 && p.ring).sort((a, b) => b.area - a.area);
    for (const p of act) {
      const sel = p.polity.id === selId;
      ctx.lineJoin = "round";
      ctx.fillStyle = p.color;
      ctx.strokeStyle = p.color;
      // Extents are indicative, so the edge is a soft band rather than a ruled frontier.
      if (canBlur) ctx.filter = "blur(6px)";
      ctx.globalAlpha = p.alpha * (sel ? 0.42 : 0.26);
      trace(p.ring!);
      ctx.fill();
      if (canBlur) ctx.filter = "blur(1.2px)";
      ctx.globalAlpha = p.alpha * (sel ? 0.9 : 0.55);
      ctx.lineWidth = sel ? 3 : 2;
      ctx.setLineDash([7, 4]);
      trace(p.ring!);
      ctx.stroke();
      ctx.setLineDash([]);
      if (canBlur) ctx.filter = "none";
    }
    ctx.globalAlpha = 1;
    this.polTex.needsUpdate = true;
  }

  /** Move to a year over a short time (era presets), so the land cover and the coast change visibly; instant for reduced motion and automated browsers. */
  glideT(t: number, ms = 650): void {
    if (!Number.isFinite(t)) return;
    const c = this.scale.clamp(t);
    if (!this.motion || automated() || Math.abs(c - this.state.t) < 1) return this.setT(c);
    this.state.playing = false;
    this.glide = { from: this.state.t, to: c, start: performance.now(), dur: ms };
  }
  setT(t: number): void {
    if (!Number.isFinite(t)) return;
    this.glide = null;
    const c = this.scale.clamp(t);
    if (c === this.state.t) return;
    this.state.t = c;
    this.applyYear();
    // at once, not throttled: a controlled slider must see the new year before its own change event
    this.emit(true);
  }
  getT(): number {
    return this.state.t;
  }
  play(direction: 1 | -1 = 1): void {
    this.glide = null;
    this.state.direction = direction;
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
    if (!Number.isFinite(speed) || !Number.isFinite(rate)) return;
    this.state.speed = speed;
    this.state.rate = rate;
    this.emit(true);
  }

  // ---------- view ----------

  private computeHome(): void {
    const l = this.limit;
    const w = l.xMax - l.xMin, d = l.zMax - l.zMin;
    const tan = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const aspect = this.camera.aspect || 1.6;
    const tilt = 0.42; // radians from vertical
    // the timeline takes the foot of the screen and a card may stand at the right, so fit into what is left
    this.fitDistance = Math.max((d * Math.cos(tilt)) / (2 * tan * 0.84), w / (2 * tan * aspect * 0.8));
    const cx = (l.xMin + l.xMax) / 2 + w * 0.04, cz = (l.zMin + l.zMax) / 2 + d * 0.045;
    this.home.target.set(cx, 0, cz);
    this.home.position.set(cx, Math.cos(tilt) * this.fitDistance, cz + Math.sin(tilt) * this.fitDistance);
    this.controls.minDistance = 28;
    this.controls.maxDistance = this.fitDistance * 1.9;
  }
  private applyHome(): void {
    this.camera.position.copy(this.home.position);
    this.controls.target.copy(this.home.target);
    this.controls.update();
  }
  private cancelAnim = () => {
    this.anim = null;
  };
  resetView(): void {
    this.anim = null;
    this.computeHome();
    this.applyHome();
    this.emit(true);
  }
  /** Glide back to the whole map (the interface's reset button). */
  flyHome(): void {
    this.computeHome();
    if (!this.motion || automated()) return this.resetView();
    this.startAnim(this.home.position.clone(), this.home.target.clone(), 1300);
  }
  /** Centre a place and move in close enough to see its surroundings. The year is not changed. */
  focusPlace(id: string, distance = 240): void {
    const p = this.places.find((x) => x.place.id === id);
    if (!p) return;
    this.anim = null;
    const dir = this.camera.position.clone().sub(this.controls.target);
    const len = Math.min(dir.length(), distance);
    dir.normalize();
    this.controls.target.set(p.pos.x, 0, p.pos.z);
    this.camera.position.copy(this.controls.target).addScaledVector(dir, len);
    this.controls.update();
  }
  /** The same as focusPlace, as a camera move (the interface uses this). */
  flyToPlace(id: string, distance = 240, ms = 1400): void {
    const p = this.places.find((x) => x.place.id === id);
    if (!p) return;
    const dir = this.camera.position.clone().sub(this.controls.target);
    const len = Math.min(dir.length(), distance);
    dir.normalize();
    // keep the place clear of the card on the right when there is room to
    const t1 = new THREE.Vector3(p.pos.x, 0, p.pos.z);
    const off = this.panelOffset(len);
    t1.x += off;
    const p1 = t1.clone().addScaledVector(dir, len);
    if (!this.motion || automated()) {
      this.anim = null;
      this.controls.target.copy(t1);
      this.camera.position.copy(p1);
      this.controls.update();
      return;
    }
    this.startAnim(p1, t1, ms);
  }
  /** Shift (km) that moves a centred subject left of a right-hand card, on wide screens. */
  private panelOffset(dist: number): number {
    const w = this.container.clientWidth;
    if (w < 900) return 0;
    const kmPerPx = (2 * dist * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2))) / (this.container.clientHeight || 1);
    return Math.min(380, w * 0.22) * 0.5 * kmPerPx;
  }
  /** Bring a selected place into view if the card or the screen edge hides it; the zoom is kept. */
  private nudgeInto(p: PlaceRt): void {
    if (!this.motion) return;
    const w = this.container.clientWidth, h = this.container.clientHeight;
    this.projectAll(w, h);
    const right = w >= 900 ? w - Math.min(440, w * 0.3) : w - 40;
    if (p.onScreen && p.sx > 60 && p.sx < right && p.sy > 90 && p.sy < h - 190) return;
    const dist = this.camera.position.distanceTo(this.controls.target);
    this.flyToPlace(p.place.id, dist, 900);
  }
  /** A short dive towards a place, used as the way into a detailed site. Resolves when it is done. */
  diveInto(id: string): Promise<void> {
    const p = this.places.find((x) => x.place.id === id);
    if (!p || !this.motion) return Promise.resolve();
    return new Promise((resolve) => {
      const t1 = new THREE.Vector3(p.pos.x, 0, p.pos.z);
      const dir = this.camera.position.clone().sub(this.controls.target).normalize();
      const flat = new THREE.Vector3(dir.x, 0, dir.z);
      const tilted = flat.lengthSq() > 1e-6 ? flat.normalize().multiplyScalar(Math.sin(0.95)).setY(Math.cos(0.95)) : new THREE.Vector3(0, Math.cos(0.95), Math.sin(0.95));
      const p1 = t1.clone().addScaledVector(tilted, 34);
      this.startAnim(p1, t1, 950, resolve);
    });
  }
  private startAnim(p1: THREE.Vector3, t1: THREE.Vector3, dur: number, done?: () => void): void {
    const p0 = this.camera.position.clone(), t0 = this.controls.target.clone();
    const travel = t0.distanceTo(t1);
    const d0 = p0.distanceTo(t0), d1 = p1.distanceTo(t1);
    const hop = Math.min(0.9, Math.max(0, travel / Math.max(d0, d1) - 0.35) * 0.5);
    this.anim = { p0, t0, p1, t1, start: performance.now(), dur, hop, done };
  }
  private stepAnim(now: number): void {
    const a = this.anim;
    if (!a) return;
    const k = Math.max(0, Math.min(1, (now - a.start) / a.dur));
    const e = ease(k);
    const tgt = a.t0.clone().lerp(a.t1, e);
    const o0 = a.p0.clone().sub(a.t0), o1 = a.p1.clone().sub(a.t1);
    const d0 = o0.length(), d1 = o1.length();
    const dist = d0 * Math.pow(d1 / d0, e) * (1 + a.hop * Math.sin(Math.PI * e));
    const dir = o0.normalize().lerp(o1.normalize(), e).normalize();
    this.controls.target.copy(tgt);
    this.camera.position.copy(tgt).addScaledVector(dir, dist);
    if (k >= 1) {
      this.anim = null;
      a.done?.();
    }
  }
  getCamera(): { position: number[]; target: number[] } {
    return { position: this.camera.position.toArray(), target: this.controls.target.toArray() };
  }
  setCamera(position: number[], target: number[]): void {
    if (![...position, ...target].every(Number.isFinite)) return;
    this.anim = null;
    this.camera.position.fromArray(position);
    this.controls.target.fromArray(target);
    this.controls.update();
  }

  /** The interface reports where its panels are, so map lettering is not set underneath them. */
  setObstacles(rects: { x0: number; y0: number; x1: number; y1: number }[]): void {
    const sig = JSON.stringify(rects.map((r) => [r.x0, r.y0, r.x1, r.y1].map(Math.round)));
    if (sig === JSON.stringify(this.obstacles.map((r) => [r.x0, r.y0, r.x1, r.y1].map(Math.round)))) return;
    this.obstacles = rects;
    this.labelsDirty = true;
  }

  setQuality(q: Quality): void {
    if (q === this.state.quality || !QUALITY[q]) return;
    this.state.quality = q;
    this.buildTerrain();
    this.resize();
    this.emit(true);
  }
  setLabels(on: boolean): void {
    this.state.labels = on;
    this.labelsDirty = true;
    this.emit(true);
  }
  setPolities(on: boolean): void {
    this.state.polities = on;
    this.polSig = "";
    this.applyYear();
    this.emit(true);
  }
  /** Tint markers and lines by evidence class (attested / reconstructed / conjectural). */
  setEvidence(on: boolean): void {
    this.state.evidence = on;
    this.applyYear();
    this.emit(true);
  }

  // ---------- events ----------

  onChange(cb: (s: NationalState) => void): () => void {
    this.listeners.add(cb);
    cb({ ...this.state });
    return () => this.listeners.delete(cb);
  }
  onSelect(cb: (s: NationalSelection) => void): () => void {
    this.selectListeners.add(cb);
    return () => this.selectListeners.delete(cb);
  }
  /** Fired when the user asks to descend into a place's detailed site (double-click on a marker that has one). */
  onEnter(cb: (siteId: string, place: Place) => void): () => void {
    this.enterListeners.add(cb);
    return () => this.enterListeners.delete(cb);
  }
  /** Camera heading (radians, 0 = looking north) and scale at the centre of the view, about ten times a second. */
  onView(cb: (v: { heading: number; kmPerPx: number }) => void): () => void {
    this.viewListeners.add(cb);
    return () => this.viewListeners.delete(cb);
  }
  /** Turn the view to face north again, keeping zoom and tilt. */
  faceNorth(): void {
    const tg = this.controls.target.clone();
    const off = this.camera.position.clone().sub(tg);
    const flat = Math.hypot(off.x, off.z);
    const p1 = tg.clone().add(new THREE.Vector3(0, off.y, flat));
    if (!this.motion || automated()) return this.setCamera(p1.toArray(), tg.toArray());
    this.startAnim(p1, tg, 700);
  }
  /** Set the selection (highlights it on the map) and tell listeners. */
  select(sel: NationalSelection): void {
    this.selection = sel;
    this.polSig = "";
    this.applyYear();
    for (const cb of this.selectListeners) cb(sel);
  }
  selectPlace(id: string): void {
    const p = this.ds.places.find((x) => x.id === id);
    if (p) this.select({ type: "place", place: p });
  }
  getSelection(): NationalSelection {
    return this.selection;
  }
  getState(): NationalState {
    return { ...this.state };
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

  private onMotionPref = () => {
    this.motion = reducedMotion() ? 0 : 1;
    this.terrainMat.uniforms.uMotion.value = this.motion;
  };
  private onContext = (e: Event) => e.preventDefault();
  private onPointerDown = (e: PointerEvent) => {
    this.anim = null;
    this.drag = { x: e.clientX, y: e.clientY, moved: 0 };
  };
  private onPointerMove = (e: PointerEvent) => {
    if (!this.drag) return;
    this.drag.moved += Math.abs(e.clientX - this.drag.x) + Math.abs(e.clientY - this.drag.y);
    this.drag.x = e.clientX;
    this.drag.y = e.clientY;
  };
  private onPointerUp = (e: PointerEvent) => {
    const d = this.drag;
    this.drag = null;
    if (!d || d.moved > 6 || e.target !== this.renderer.domElement || e.button !== 0) return;
    const hit = this.hitTest(e.clientX, e.clientY, true);
    const now = performance.now();
    const again = now - this.lastClick < 380 && hit?.type === "place" && this.selection?.type === "place" && this.selection.place.id === hit.place.id;
    this.lastClick = now;
    if (again && hit?.type === "place" && hit.place.site) {
      for (const cb of this.enterListeners) cb(hit.place.site, hit.place);
      return;
    }
    this.select(hit);
    if (hit?.type === "place") {
      const p = this.places.find((x) => x.place.id === hit.place.id);
      if (p) this.nudgeInto(p);
    }
  };
  private onHover = (e: PointerEvent) => {
    if (this.drag && this.drag.moved > 3) return;
    const hit = this.hitTest(e.clientX, e.clientY, false);
    this.renderer.domElement.style.cursor = hit ? "pointer" : "grab";
    const p = hit?.type === "place" ? this.places.find((x) => x.place.id === hit.place.id) ?? null : null;
    if (p !== this.hovered) {
      this.hovered = p;
      this.updateMarkers();
      this.labelsDirty = true;
    }
  };
  private onLeave = () => {
    if (this.hovered) {
      this.hovered = null;
      this.updateMarkers();
      this.labelsDirty = true;
    }
  };

  /** What is under a screen point: a marker, then a label, then a line, then (for clicks) an indicative polity extent. */
  private hitTest(cx: number, cy: number, deep: boolean): NationalSelection {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const x = cx - rect.left, y = cy - rect.top;
    this.projectAll(rect.width, rect.height);
    let best: PlaceRt | null = null, bd = Infinity;
    for (const p of this.places) {
      if (p.alpha < 0.15 || !p.onScreen) continue;
      const d = Math.hypot(p.sx - x, p.sy - y);
      // nearest centre wins, scaled by size so a click on a small symbol next to a big one finds the small one
      const score = d / (p.radius + 3);
      if (d < p.radius + 5 && score < bd) {
        bd = score;
        best = p;
      }
    }
    if (best) return { type: "place", place: best.place };
    if (this.state.labels) for (const b of this.labelBoxes) if (b.sel && x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1) return b.sel;
    let bl: LineRt | null = null;
    bd = 7;
    for (const l of this.lines) {
      if (l.alpha < 0.05) continue;
      const s = l.screen;
      for (let i = 0; i + 3 < s.length; i += 2) {
        if (Number.isNaN(s[i]) || Number.isNaN(s[i + 2])) continue;
        const ex = s[i + 2] - s[i], ey = s[i + 3] - s[i + 1];
        const f = Math.max(0, Math.min(1, ((x - s[i]) * ex + (y - s[i + 1]) * ey) / (ex * ex + ey * ey || 1)));
        const d = Math.hypot(x - (s[i] + ex * f), y - (s[i + 1] + ey * f));
        if (d < bd) {
          bd = d;
          bl = l;
        }
      }
    }
    if (bl) return { type: "line", line: bl.line };
    if (!deep || !this.state.polities) return null;
    const g = this.groundAt(x / rect.width, y / rect.height);
    if (!g) return null;
    const [lat, lon] = this.toLatLon(g.x, g.z);
    if (sampleFlood(this.grid, lat, lon) < this.seaLevel()) return null;
    let bp: PolityRt | null = null;
    for (const p of this.polities) {
      if (p.alpha < 0.3 || !p.latlon) continue;
      let inside = false;
      for (let a = 0, b = p.latlon.length - 1; a < p.latlon.length; b = a++) {
        const [la0, lo0] = p.latlon[a], [la1, lo1] = p.latlon[b];
        if (la0 > lat !== la1 > lat && lon < ((lo1 - lo0) * (lat - la0)) / (la1 - la0) + lo0) inside = !inside;
      }
      if (inside && (!bp || p.area < bp.area)) bp = p;
    }
    return bp ? { type: "polity", polity: bp.polity } : null;
  }

  /** Where the view ray through a screen point (fractions of width/height) meets the relief. */
  private groundAt(fx: number, fy: number): THREE.Vector3 | null {
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(fx * 2 - 1, -(fy * 2 - 1)), this.camera);
    const o = ray.ray.origin, d = ray.ray.direction;
    if (d.y >= -1e-4) return null;
    const p = new THREE.Vector3();
    const tMax = (o.y + 1) / -d.y;
    const tStart = Math.max(0, (o.y - 25) / -d.y);
    for (let s = tStart; s <= tMax; s += 1.5) {
      p.copy(o).addScaledVector(d, s);
      if (p.y <= this.surfaceYxz(p.x, p.z)) return p;
    }
    return p.copy(o).addScaledVector(d, o.y / -d.y);
  }

  // ---------- frame ----------

  private resize = () => {
    const w = this.container.clientWidth || 1, h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = "100%";
    this.renderer.domElement.style.height = "100%";
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    for (const l of this.lines) {
      l.mat.resolution.set(w, h);
      l.casingMat.resolution.set(w, h);
    }
    this.markerMat.uniforms.uViewport.value.set(w, h);
    this.labelsDirty = true;
  };

  private frame = (now: number) => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.frame);
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.frameTimes.push(now - this.last);
    if (this.frameTimes.length > 90) this.frameTimes.shift();
    this.last = now;
    const s = this.state;

    if (this.glide) {
      const g = this.glide;
      const k = Math.min(1, (now - g.start) / g.dur);
      // eased in the slider's own (non-linear) scale, so a long jump across prehistory does not crawl
      const u0 = this.scale.tToU(g.from), u1 = this.scale.tToU(g.to);
      s.t = k >= 1 ? g.to : this.scale.uToT(u0 + (u1 - u0) * ease(k));
      if (k >= 1) this.glide = null;
      this.applyYear();
      this.emit(true);
    } else if (s.playing) {
      let t = s.t;
      if (s.speed === 0) t = this.scale.uToT(this.scale.tToU(t) + (s.direction * dt * s.rate) / AUTO_SECONDS);
      else t += s.direction * dt * s.speed * s.rate;
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

    if (this.anim && now >= this.anim.start) this.stepAnim(now);
    // navigation limits: stay over the map, never under the relief
    const tg = this.controls.target, l = this.limit;
    tg.x = Math.max(l.xMin, Math.min(l.xMax, tg.x));
    tg.z = Math.max(l.zMin, Math.min(l.zMax, tg.z));
    tg.y = 0;
    this.controls.update();
    this.applyExag(this.exagFor(this.camera.position.distanceTo(tg)));
    const cam = this.camera.position;
    const floor = this.surfaceYxz(cam.x, cam.z) + 4;
    if (cam.y < floor) cam.y = floor;
    const dist = cam.distanceTo(tg);
    const near = THREE.MathUtils.clamp(Math.min(cam.y, dist) * 0.2, 1, 60);
    if (Math.abs(this.camera.near - near) > near * 0.1) {
      this.camera.near = near;
      this.camera.updateProjectionMatrix();
    }
    this.sky.position.copy(cam);

    this.terrainMat.uniforms.uTime.value = now * 0.001;
    // dashes keep a constant on-screen length whatever the zoom
    const h = this.container.clientHeight || 1;
    const kmPerPx = (2 * dist * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2))) / h;
    for (const ln of this.lines) if (ln.mat.dashed) ln.mat.dashScale = 1 / Math.max(0.02, kmPerPx);
    this.pickTerrainLod(kmPerPx);
    const heading = Math.atan2(cam.x - tg.x, cam.z - tg.z);
    const lv = this.lastView;
    if (now - lv.at > 90 && (Math.abs(heading - lv.heading) > 0.003 || Math.abs(kmPerPx / lv.kmPerPx - 1) > 0.01 || Number.isNaN(lv.heading))) {
      this.lastView = { heading, kmPerPx, at: now };
      for (const cb of this.viewListeners) cb({ heading, kmPerPx });
    }

    this.renderFrame();

    const sig = `${cam.x.toFixed(2)},${cam.y.toFixed(2)},${cam.z.toFixed(2)},${tg.x.toFixed(2)},${tg.z.toFixed(2)},${this.camera.aspect.toFixed(3)}`;
    if (sig !== this.camSig) {
      this.camSig = sig;
      this.labelsDirty = true;
    }
    if (this.labelsDirty) this.updateLabels();

    if (now - this.lastEmit > 500) {
      const avg = this.frameTimes.reduce((a, v) => a + v, 0) / Math.max(1, this.frameTimes.length);
      s.fps = Math.round(1000 / avg);
      this.emit(true);
    }
  };

  private renderFrame(): void {
    this.renderer.info.reset();
    this.renderer.render(this.scene, this.camera);
  }

  /** Project markers and line vertices to CSS pixels. */
  private projectAll(w: number, h: number): void {
    const v = new THREE.Vector3();
    const dist = this.camera.position.distanceTo(this.controls.target);
    const zoom = this.zoomFactor(dist);
    for (const p of this.places) {
      v.copy(p.pos);
      v.y *= this.drape.scale.y;
      v.project(this.camera);
      p.onScreen = v.z > -1 && v.z < 1 && Math.abs(v.x) < 1.05 && Math.abs(v.y) < 1.05;
      p.sx = (v.x * 0.5 + 0.5) * w;
      p.sy = (-v.y * 0.5 + 0.5) * h;
      p.radius = (this.markerPx(p) * zoom) / 2;
    }
    for (const l of this.lines) {
      if (l.alpha < 0.05) continue;
      for (let i = 0; i < l.pts.length; i++) {
        v.copy(l.pts[i]);
        v.y *= this.drape.scale.y;
        v.project(this.camera);
        const ok = v.z > -1 && v.z < 1;
        l.screen[i * 2] = ok ? (v.x * 0.5 + 0.5) * w : NaN;
        l.screen[i * 2 + 1] = ok ? (-v.y * 0.5 + 0.5) * h : NaN;
      }
    }
  }
  /** Markers grow a little as the camera comes in. */
  private zoomFactor(dist: number): number {
    return THREE.MathUtils.clamp(Math.pow(this.fitDistance / Math.max(1, dist), 0.28), 0.85, 1.7);
  }

  private textWidth(text: string, font: string, spacing = 0): number {
    const key = font + "|" + spacing + "|" + text;
    let w = this.widths.get(key);
    if (w == null) {
      this.measureCtx.font = font;
      w = this.measureCtx.measureText(text).width + spacing * text.length;
      this.widths.set(key, w);
    }
    return w;
  }

  /** Thin out markers that would sit on top of a more important one: they shrink to a pip (still clickable). */
  private declutter(selId: string | null): boolean {
    const order = this.places
      .filter((p) => p.alpha > 0.15 && p.onScreen)
      .sort((a, b) => this.priority(b, selId) - this.priority(a, selId));
    const placed: { x: number; y: number; r: number }[] = [];
    let changed = false;
    const zoom = this.zoomFactor(this.camera.position.distanceTo(this.controls.target));
    const whole = this.fitDistance / Math.max(1, this.camera.position.distanceTo(this.controls.target));
    for (const p of order) {
      const keep = p.place.id === selId || this.hovered === p || !!p.place.site;
      const was = p.collapsed;
      p.collapsed = false;
      const r = (this.markerPx(p) * zoom) / 2;
      // seen from afar, a minor site is a dot until there is room for its symbol
      const minor = !IS_SETTLEMENT[this.iconFor(p)] && p.size < (whole < 1.4 ? 3 : whole < 2.2 ? 2 : 0);
      const clash = !keep && (minor || placed.some((o) => Math.hypot(o.x - p.sx, o.y - p.sy) < (o.r + r) * 0.62));
      p.collapsed = clash;
      if (!clash) placed.push({ x: p.sx, y: p.sy, r });
      if (was !== p.collapsed) changed = true;
    }
    for (const p of this.places) if ((p.alpha <= 0.15 || !p.onScreen) && p.collapsed) { p.collapsed = false; changed = true; }
    return changed;
  }
  private priority(p: PlaceRt, selId: string | null): number {
    const settle = IS_SETTLEMENT[this.iconFor({ ...p, collapsed: false })] ? 0.4 : 0;
    return (p.place.id === selId ? 100 : 0) + (this.hovered === p ? 50 : 0) + (p.place.site ? 20 : 0) + (p.ring ? -2 : 0) + p.size + settle + p.alpha * 0.1;
  }

  private updateLabels(): void {
    this.labelsDirty = false;
    this.labelBoxes.length = 0;
    const on = this.state.labels;
    const w = this.container.clientWidth, h = this.container.clientHeight;
    this.projectAll(w, h);
    const selId = this.selection?.type === "place" ? this.selection.place.id : null;
    if (this.declutter(selId)) {
      this.updateMarkers();
      this.projectAll(w, h);
    } else this.updateMarkers();
    this.updateHoverCard(w, h);
    this.labelLayer.classList.toggle("off", !on);
    if (!on) {
      for (const el of this.labelPool) el.style.display = "none";
      this.labelCount = 0;
      return;
    }
    const dist = this.camera.position.distanceTo(this.controls.target);
    const zoom = this.fitDistance / Math.max(1, dist); // 1 = whole map, larger = closer
    const boxes: LabelBox[] = [];
    const free = (b: { x0: number; y0: number; x1: number; y1: number }) => !boxes.some((o) => b.x0 < o.x1 + 3 && b.x1 > o.x0 - 3 && b.y0 < o.y1 + 2 && b.y1 > o.y0 - 2);
    let n = 0;
    const put = (text: string, cls: string, x: number, y: number, opacity: number, sel: NationalSelection, extra?: { fontPx?: number; rot?: number; spacing?: number; w?: number; h?: number }) => {
      let el = this.labelPool[n];
      if (!el) {
        el = document.createElement("div");
        this.labelLayer.appendChild(el);
        this.labelPool.push(el);
      }
      if (el.textContent !== text) el.textContent = text;
      if (el.className !== cls) el.className = cls;
      const rot = extra?.rot ? ` rotate(${extra.rot.toFixed(2)}rad)` : "";
      el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)${rot}`;
      el.style.transformOrigin = extra?.rot && extra.w ? `${(extra.w / 2).toFixed(1)}px ${((extra.h ?? 0) / 2).toFixed(1)}px` : "";
      el.style.opacity = opacity.toFixed(2);
      el.style.fontSize = extra?.fontPx ? `${extra.fontPx.toFixed(1)}px` : "";
      el.style.letterSpacing = extra?.spacing != null ? `${extra.spacing.toFixed(2)}px` : "";
      el.style.display = "block";
      el.dataset.sel = sel ? (sel.type === "place" ? sel.place.id : sel.type === "line" ? sel.line.id : sel.polity.id) : "";
      n++;
    };

    // 0. the interface's panels
    for (const o of this.obstacles) boxes.push({ ...o, sel: null });
    // 1. markers are obstacles: no label may cover a visible symbol
    const vis = this.places.filter((p) => p.onScreen && p.alpha > 0.15);
    for (const p of vis) {
      if (p.collapsed || !(p.size >= 2 || p.place.site)) continue;
      const major = p.size >= 4 || !!p.place.site || p.place.id === selId;
      boxes.push({ x0: p.sx - p.radius, y0: p.sy - p.radius, x1: p.sx + p.radius, y1: p.sy + p.radius, sel: null, major } as LabelBox);
    }
    if (this.hovered && this.hoverCard.style.display !== "none") {
      const r = this.hoverCard.getBoundingClientRect(), cr = this.container.getBoundingClientRect();
      boxes.push({ x0: r.left - cr.left, y0: r.top - cr.top, x1: r.right - cr.left, y1: r.bottom - cr.top, sel: null });
    }

    // 2. territory names: spaced capitals laid along the extent's long axis
    if (this.state.polities) {
      const v = new THREE.Vector3();
      const act = this.polities.filter((p) => p.alpha > 0.02).sort((a, b) => b.alpha - a.alpha || b.area - a.area);
      for (const p of act) {
        v.copy(p.pos);
        v.y *= this.drape.scale.y;
        v.project(this.camera);
        if (v.z > 1 || v.z < -1) continue;
        const x = (v.x * 0.5 + 0.5) * w, y = (-v.y * 0.5 + 0.5) * h;
        // long axis and extent of the outline on screen (principal axis of its vertices)
        let ang = 0, span = 0;
        if (p.world) {
          const pts: [number, number][] = [];
          for (const q of p.world) {
            v.copy(q);
            v.y *= this.drape.scale.y;
            v.project(this.camera);
            if (v.z < 1 && v.z > -1) pts.push([(v.x * 0.5 + 0.5) * w, (-v.y * 0.5 + 0.5) * h]);
          }
          if (pts.length >= 3) {
            let mx = 0, my = 0;
            for (const [a, b] of pts) { mx += a; my += b; }
            mx /= pts.length; my /= pts.length;
            let sxx = 0, syy = 0, sxy = 0;
            for (const [a, b] of pts) { sxx += (a - mx) ** 2; syy += (b - my) ** 2; sxy += (a - mx) * (b - my); }
            ang = 0.5 * Math.atan2(2 * sxy, sxx - syy);
            if (ang > Math.PI / 2) ang -= Math.PI;
            if (ang < -Math.PI / 2) ang += Math.PI;
            ang = THREE.MathUtils.clamp(ang, -0.42, 0.42);
            const ca = Math.cos(ang), sa = Math.sin(ang);
            let lo = Infinity, hi = -Infinity;
            for (const [a, b] of pts) { const s = (a - mx) * ca + (b - my) * sa; lo = Math.min(lo, s); hi = Math.max(hi, s); }
            span = hi - lo;
          }
        }
        let text = (p.polity.name.replace(/\s*\([^)]*\)/g, "").trim() || p.polity.name).toUpperCase(); // the panel gives the full name
        const big = p.polity.kind === "realm" || p.polity.kind === "province" ? 1.22 : p.polity.kind === "people" ? 0.92 : 1;
        const size = THREE.MathUtils.clamp(11.5 * Math.pow(zoom, 0.45), 11, 19) * big;
        const font = `500 ${size.toFixed(1)}px ${SERIF}`;
        const base = this.textWidth(text, font);
        // spread the letters over about half the extent, within a sensible range
        let spacing = THREE.MathUtils.clamp(span ? (span * 0.5 - base) / Math.max(1, text.length) : size * 0.3, size * 0.18, size * 0.7);
        if (base + spacing * text.length > Math.max(260, span * 0.9) && text.includes(" ")) {
          const words = text.split(" ");
          let best = 1, bd = Infinity;
          for (let k = 1; k < words.length; k++) {
            const dd = Math.abs(words.slice(0, k).join(" ").length - words.slice(k).join(" ").length);
            if (dd < bd) { bd = dd; best = k; }
          }
          text = words.slice(0, best).join(" ") + "\n" + words.slice(best).join(" ");
          spacing = Math.min(spacing, size * 0.4);
        }
        const rows = text.split("\n");
        const tw = Math.max(...rows.map((r) => this.textWidth(r, font, spacing)));
        const th = size * 1.3 * rows.length;
        // territory names yield to each other and to the big or selected symbols; they slide up or down to clear them
        const hit = (bb: { x0: number; y0: number; x1: number; y1: number }) =>
          boxes.some((o) => (o.sel?.type === "polity" || (o.sel === null && !!o.major)) && bb.x0 < o.x1 + 8 && bb.x1 > o.x0 - 8 && bb.y0 < o.y1 + 5 && bb.y1 > o.y0 - 5);
        let b = { x0: x - tw / 2, y0: y - th / 2, x1: x + tw / 2, y1: y + th / 2 };
        for (const dy of [0, -1, 1, -2, 2]) {
          const c = { x0: b.x0, x1: b.x1, y0: y - th / 2 + dy * th * 0.9, y1: y + th / 2 + dy * th * 0.9 };
          if (!hit(c)) { b = c; break; }
          if (dy === 2) b = { ...b, x0: NaN };
        }
        if (Number.isNaN(b.x0)) continue;
        if (b.x1 < 0 || b.x0 > w || b.y1 < 0 || b.y0 > h) continue;
        const sel: NationalSelection = { type: "polity", polity: p.polity };
        boxes.push({ ...b, sel });
        const isSel = this.selection?.type === "polity" && this.selection.polity.id === p.polity.id;
        put(text, "nat-label polity k-" + p.polity.kind + (isSel ? " sel" : ""), b.x0, b.y0, p.alpha * (isSel ? 1 : 0.78), sel, { fontPx: size, rot: ang, spacing, w: tw, h: th });
      }
    }

    // 3. place names: most important first; smaller places wait until the camera is close
    const minSize = zoom < 1.25 ? 3 : zoom < 2.2 ? 2 : 1;
    const maxLabels = zoom < 1.25 ? 34 : zoom < 2.2 ? 56 : 80;
    const cand = vis
      .filter((p) => p.place.id === selId || this.hovered === p || (!p.collapsed && ((p.ring ? zoom > 3.4 : p.size >= minSize - 0.01) || (p.place.site != null && !p.ring))))
      .sort((a, b) => this.priority(b, selId) - this.priority(a, selId));
    let placed = 0;
    for (const p of cand) {
      if (placed >= maxLabels) break;
      if (this.hovered === p && this.hoverCard.style.display !== "none") continue; // the hover card names it
      const cls = p.ring ? 0 : Math.max(1, Math.min(5, Math.round(p.size)));
      const settle = IS_SETTLEMENT[this.iconFor({ ...p, collapsed: false })];
      const fpx = settle ? [11, 11, 11.5, 12.5, 14.5, 17][cls] : [11, 11, 11, 11.5, 12.5, 13.5][cls];
      const font = `${settle ? (cls >= 4 ? 600 : 500) : "italic 500"} ${fpx}px ${SERIF}`;
      const spacing = settle && cls >= 5 ? 0.6 : 0;
      const tw = this.textWidth(p.name, font, spacing) + (p.place.site ? 16 : 0) + 2;
      const th = fpx * 1.22, r = p.radius + 3;
      const opts: [number, number][] = [[p.sx + r, p.sy - th / 2], [p.sx - r - tw, p.sy - th / 2], [p.sx - tw / 2, p.sy - r - th], [p.sx - tw / 2, p.sy + r], [p.sx + r * 0.7, p.sy - r * 0.7 - th], [p.sx + r * 0.7, p.sy + r * 0.7], [p.sx - r * 0.7 - tw, p.sy - r * 0.7 - th], [p.sx - r * 0.7 - tw, p.sy + r * 0.7]];
      for (const [x, y] of opts) {
        const b = { x0: x, y0: y, x1: x + tw, y1: y + th };
        if (b.x0 < 2 || b.x1 > w - 2 || b.y0 < 2 || b.y1 > h - 2) continue;
        if (!free(b)) continue;
        const sel: NationalSelection = { type: "place", place: p.place };
        boxes.push({ ...b, sel });
        const c = `nat-label place ${settle ? "settle" : "site"} s${cls}` + (p.place.id === selId ? " sel" : "") + (p.ring ? " gone" : "") + (p.place.site ? " has-site" : "") + (this.hovered === p ? " hov" : "");
        put(p.name, c, x, y, Math.min(1, p.alpha * 1.3), sel);
        placed++;
        break;
      }
    }

    // 4. line names along the line, once the camera is close enough for them to mean something
    if (zoom > 1.5) {
      for (const l of this.lines) {
        if (l.alpha < 0.5) continue;
        const s = l.screen;
        const m = Math.floor(l.pts.length / 2);
        const i0 = Math.max(0, m - 2), i1 = Math.min(l.pts.length - 1, m + 2);
        const x0 = s[i0 * 2], y0 = s[i0 * 2 + 1], x1 = s[i1 * 2], y1 = s[i1 * 2 + 1];
        if (![x0, y0, x1, y1].every(Number.isFinite)) continue;
        let ang = Math.atan2(y1 - y0, x1 - x0);
        if (ang > Math.PI / 2) ang -= Math.PI;
        if (ang < -Math.PI / 2) ang += Math.PI;
        const font = `italic 500 11.5px ${SERIF}`;
        const tw = this.textWidth(l.line.name, font, 0.3) + 2, th = 15;
        const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
        // sit just to one side of the line
        const ox = Math.sin(ang) * 9, oy = -Math.cos(ang) * 9;
        const bx = cx + ox - tw / 2, by = cy + oy - th / 2;
        const ext = Math.abs(Math.cos(ang)) * tw / 2 + Math.abs(Math.sin(ang)) * th / 2, eyt = Math.abs(Math.sin(ang)) * tw / 2 + Math.abs(Math.cos(ang)) * th / 2;
        const b = { x0: cx + ox - ext, y0: cy + oy - eyt, x1: cx + ox + ext, y1: cy + oy + eyt };
        if (b.x0 < 2 || b.x1 > w - 2 || b.y0 < 2 || b.y1 > h - 2 || !free(b)) continue;
        const sel: NationalSelection = { type: "line", line: l.line };
        boxes.push({ ...b, sel });
        put(l.line.name, "nat-label line k-" + l.line.kind, bx, by, 0.95, sel, { rot: ang, w: tw, h: th });
      }
    }
    for (let i = n; i < this.labelPool.length; i++) this.labelPool[i].style.display = "none";
    this.labelCount = n;
    this.labelBoxes = boxes.filter((b) => b.sel);
  }

  /** A small card beside the hovered symbol: its name in this year, what it is and, for a site, how to go in. */
  private updateHoverCard(w: number, h: number): void {
    const p = this.hovered;
    const card = this.hoverCard;
    if (!p || p.alpha < 0.15 || !p.onScreen) {
      card.style.display = "none";
      return;
    }
    const kind = PLACE_STYLE[p.kind]?.label ?? "Place";
    const cur = p.phases.find((f) => f.t0 <= this.state.t && this.state.t < f.t1);
    const sub = p.ring ? `${kind}, abandoned` : cur ? `${kind}, ${cur.label.length > 46 ? cur.label.slice(0, 44).trimEnd() + "…" : cur.label}` : kind;
    const key = `${p.place.id}|${p.name}|${sub}`;
    if (card.dataset.key !== key) {
      card.dataset.key = key;
      card.innerHTML = "";
      const b = document.createElement("b");
      b.textContent = p.name;
      const s = document.createElement("span");
      s.textContent = sub;
      card.append(b, s);
      if (p.place.site) {
        const e = document.createElement("em");
        e.textContent = "Detailed site. Double-click to go in";
        card.append(e);
      }
      card.classList.toggle("has-site", !!p.place.site);
    }
    card.style.display = "block";
    const cw = card.offsetWidth || 180, ch = card.offsetHeight || 40;
    let x = p.sx + p.radius + 10, y = p.sy - ch / 2;
    if (x + cw > w - 8) x = p.sx - p.radius - 10 - cw;
    y = Math.max(8, Math.min(h - ch - 8, y));
    card.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
  }

  // ---------- diagnostics ----------

  stats(): {
    fps: number; frameMs: number; worstMs: number; calls: number; triangles: number; places: number; placesVisible: number; lines: number; linesVisible: number;
    polities: number; politiesVisible: number; labels: number; pixelRatio: number; size: [number, number];
    terrain: { width: number; height: number; procedural: boolean; min: number; max: number; shading: string[] }; seaLevel: number; woodland: number; exaggeration: number;
  } {
    const ft = this.frameTimes;
    const avg = ft.reduce((a, v) => a + v, 0) / Math.max(1, ft.length);
    const info = this.renderer.info.render;
    const sz = this.renderer.getSize(new THREE.Vector2());
    return {
      fps: Math.round(1000 / avg), frameMs: +avg.toFixed(2), worstMs: +Math.max(0, ...ft).toFixed(2), calls: info.calls, triangles: info.triangles,
      places: this.places.length, placesVisible: this.places.filter((p) => p.alpha > 0.01).length,
      lines: this.lines.length, linesVisible: this.lines.filter((l) => l.alpha > 0.01).length,
      polities: this.polities.length, politiesVisible: this.polities.filter((p) => p.alpha > 0.01).length,
      labels: this.labelCount, pixelRatio: this.renderer.getPixelRatio(), size: [sz.x, sz.y],
      terrain: { width: this.grid.width, height: this.grid.height, procedural: this.grid.procedural, min: this.grid.min, max: this.grid.max, shading: this.surf ? ["relief", "surface", "water"].filter((k) => !this.surf!.missing.includes(k)) : [] },
      seaLevel: this.seaLevel(), woodland: this.woodland(), exaggeration: +this.exag.toFixed(2),
    };
  }
  /** For tests: how a place is being shown this year, and where on screen. */
  placeStatus(id: string): { alpha: number; size: number; kind: PlaceKind; abandoned: boolean; name: string; screen: [number, number]; onScreen: boolean } | null {
    const p = this.places.find((x) => x.place.id === id);
    if (!p) return null;
    this.projectAll(this.container.clientWidth, this.container.clientHeight);
    return { alpha: p.alpha, size: p.size, kind: p.kind, abandoned: p.ring, name: p.name, screen: [p.sx, p.sy], onScreen: p.onScreen };
  }
  lineStatus(id: string): { alpha: number } | null {
    const l = this.lines.find((x) => x.line.id === id);
    return l ? { alpha: l.alpha } : null;
  }
  polityStatus(id: string): { alpha: number } | null {
    const p = this.polities.find((x) => x.polity.id === id);
    return p ? { alpha: p.alpha } : null;
  }
  /** Synchronous render time of N frames, bypassing vsync (GPU work is flushed by reading a pixel). */
  benchmark(frames = 40): { msPerFrame: number } {
    const gl = this.renderer.getContext();
    const px = new Uint8Array(4);
    const t0 = performance.now();
    for (let i = 0; i < frames; i++) {
      this.renderFrame();
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    }
    return { msPerFrame: +((performance.now() - t0) / frames).toFixed(2) };
  }
  /** A year as text, for the interface. */
  static yearText(y: number): string {
    return validYear(y) ? formatHist(y) : "";
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    const el = this.renderer.domElement;
    el.removeEventListener("pointerdown", this.onPointerDown);
    el.removeEventListener("pointermove", this.onHover);
    el.removeEventListener("pointerleave", this.onLeave);
    el.removeEventListener("wheel", this.cancelAnim);
    el.removeEventListener("contextmenu", this.onContext);
    window.removeEventListener("pointermove", this.onPointerMove);
    window.removeEventListener("pointerup", this.onPointerUp);
    window.removeEventListener("resize", this.resize);
    this.mq?.removeEventListener?.("change", this.onMotionPref);
    this.listeners.clear();
    this.selectListeners.clear();
    this.enterListeners.clear();
    this.viewListeners.clear();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose();
    });
    for (const g of this.terrainGeos.values()) g.dispose();
    this.heightTex.dispose();
    this.polTex.dispose();
    this.atlasTex.dispose();
    if (this.surf) for (const t of [this.surf.relief, this.surf.surface, this.surf.water, this.surf.noise]) t.dispose();
    this.controls.dispose();
    this.renderer.dispose();
    el.remove();
    this.labelLayer.remove();
  }
}

/**
 * Gaussian-blurred copy (sigma about 1.1 cells) of a field, used only where the value is within a few metres of
 * zero; cliffs and open sea keep their exact values, and the two are blended so the result stays continuous.
 */
function softenNearZero(f: Float32Array, w: number, h: number): Float32Array {
  const K = [0.0544, 0.2442, 0.4026, 0.2442, 0.0544];
  const LIM = 4;
  const c = new Float32Array(f.length);
  for (let i = 0; i < f.length; i++) c[i] = Math.max(-LIM, Math.min(LIM, f[i]));
  const tmp = new Float32Array(f.length), out = new Float32Array(f.length);
  for (let y = 0; y < h; y++) {
    const r = y * w;
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let k = -2; k <= 2; k++) s += K[k + 2] * c[r + Math.min(w - 1, Math.max(0, x + k))];
      tmp[r + x] = s;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let k = -2; k <= 2; k++) s += K[k + 2] * tmp[Math.min(h - 1, Math.max(0, y + k)) * w + x];
      const i = y * w + x;
      const t = Math.min(1, Math.max(0, (Math.abs(f[i]) - 2.5) / 1.5)); // 0 near zero, 1 from 4 m away
      out[i] = s * (1 - t) + f[i] * t;
    }
  }
  return out;
}

/** Box-filtered mip levels of the (elevation, flood level) grid, as half floats. */
function heightMips(grid: HeightGrid, level0: Uint16Array): { data: Uint16Array; width: number; height: number }[] {
  const out = [{ data: level0, width: grid.width, height: grid.height }];
  let w = grid.width, h = grid.height;
  let a = grid.data, b = grid.flood;
  while (w > 1 || h > 1) {
    const nw = Math.max(1, w >> 1), nh = Math.max(1, h >> 1);
    const na = new Float32Array(nw * nh), nb = new Float32Array(nw * nh);
    const half = new Uint16Array(nw * nh * 2);
    for (let y = 0; y < nh; y++) {
      const y0 = Math.min(h - 1, y * 2), y1 = Math.min(h - 1, y * 2 + 1);
      for (let x = 0; x < nw; x++) {
        const x0 = Math.min(w - 1, x * 2), x1 = Math.min(w - 1, x * 2 + 1);
        const i = y * nw + x;
        na[i] = (a[y0 * w + x0] + a[y0 * w + x1] + a[y1 * w + x0] + a[y1 * w + x1]) * 0.25;
        nb[i] = (b[y0 * w + x0] + b[y0 * w + x1] + b[y1 * w + x0] + b[y1 * w + x1]) * 0.25;
        half[i * 2] = THREE.DataUtils.toHalfFloat(na[i]);
        half[i * 2 + 1] = THREE.DataUtils.toHalfFloat(nb[i]);
      }
    }
    out.push({ data: half, width: nw, height: nh });
    a = na; b = nb; w = nw; h = nh;
  }
  return out;
}

const SERIF = `"Iowan Old Style", "Iowan Old Style BT", Charter, "Palatino Linotype", Palatino, Georgia, serif`;
