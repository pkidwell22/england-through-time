import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { Line2 } from "three/examples/jsm/lines/Line2.js";
import { LineGeometry } from "three/examples/jsm/lines/LineGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { sampleKeyframes } from "@/lib/lifecycle";
import type { Evidence } from "@/lib/types";
import { TimeScale, histToT } from "@/lib/years";
import { safeT, validYear } from "./data";
import { type HeightGrid, loadHeights, sampleFlood, sampleHeight } from "./heights";
import type { LineFeature, LineKind, NationalDataset, Place, PlaceKind, Polity } from "./types";

/**
 * Renderer for the national map. Imperative, like the site Engine, and driven
 * through the same timeline API so one interface can control either.
 *
 * Frame: kilometres. x = east, z = south, y = up; the origin is the centre of
 * the height grid. The projection is equirectangular (straight lines of latitude
 * and longitude), which matches the height image exactly.
 */

/** Heights are drawn this many times taller than true scale, so that relief reads at national scale. */
export const VERTICAL_EXAGGERATION = 12;
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

const QUALITY: Record<Quality, { dpr: number; segments: number }> = {
  low: { dpr: 1, segments: 256 },
  medium: { dpr: 1.5, segments: 512 },
  high: { dpr: 2, segments: 1024 },
};

const EV_COLOR = { a: 0x40bf8c, r: 0xf2ad33, c: 0xc759d9 } as const;
export const evClass = (e: Evidence): "a" | "r" | "c" => (typeof e === "string" && e.startsWith("attested") ? "a" : e === "reconstructed" ? "r" : "c");

/** Marker glyph (see the fragment shader) and colour for each kind of place. */
export const PLACE_STYLE: Record<PlaceKind, { glyph: number; color: number; label: string }> = {
  city: { glyph: 1, color: 0xf6efdd, label: "City" },
  town: { glyph: 0, color: 0xf6efdd, label: "Town" },
  port: { glyph: 0, color: 0x9fd0e0, label: "Port" },
  fort: { glyph: 2, color: 0xd0583f, label: "Fort" },
  hillfort: { glyph: 3, color: 0xd9a441, label: "Hillfort" },
  monument: { glyph: 6, color: 0xe6e0d2, label: "Monument" },
  monastery: { glyph: 5, color: 0xb9a4e6, label: "Monastery" },
  cathedral: { glyph: 5, color: 0xf6efdd, label: "Cathedral" },
  castle: { glyph: 4, color: 0x8c95a8, label: "Castle" },
  palace: { glyph: 8, color: 0xe2b45a, label: "Palace" },
  battle: { glyph: 7, color: 0xe5484d, label: "Battle" },
  mine: { glyph: 9, color: 0x9a7b5a, label: "Mine" },
  other: { glyph: 0, color: 0xcfc8b6, label: "Other" },
};

export const LINE_STYLE: Record<LineKind, { color: number; width: number; dash: [number, number] | null; label: string }> = {
  "roman-road": { color: 0x9c3a26, width: 2.1, dash: null, label: "Roman road" },
  road: { color: 0x5d4027, width: 1.5, dash: [7, 4], label: "Road" },
  "frontier-wall": { color: 0x3a1f1a, width: 3.6, dash: null, label: "Frontier wall" },
  dyke: { color: 0x3f4d24, width: 3.0, dash: [4, 3], label: "Dyke" },
  "river-route": { color: 0x2f6f96, width: 1.8, dash: null, label: "River route" },
  border: { color: 0x6a4f94, width: 1.6, dash: [9, 3], label: "Border" },
};

const POLITY_COLORS = ["#b0563f", "#4f7fa8", "#8a6fb0", "#c49a3a", "#3f9482", "#a85a80", "#7d8f3f", "#c9773a"];

interface PhaseRt { t0: number; t1: number; size: number; kind: PlaceKind; label: string }
interface PlaceRt {
  place: Place;
  pos: THREE.Vector3;
  phases: PhaseRt[];
  names: { name: string; t0: number; t1: number }[];
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
}
interface LineRt {
  line: LineFeature;
  t0: number;
  t1: number;
  obj: Line2;
  mat: LineMaterial;
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
  area: number;
  alpha: number;
}
interface LabelBox { x0: number; y0: number; x1: number; y1: number; sel: NationalSelection }

export interface NationalInit {
  t?: number;
  quality?: Quality;
  labels?: boolean;
  polities?: boolean;
  evidence?: boolean;
}

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
  private selection: NationalSelection = null;

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

  private places: PlaceRt[] = [];
  private markerGeo = new THREE.BufferGeometry();
  private markerMat: THREE.ShaderMaterial;
  private markers: THREE.Points;
  private lines: LineRt[] = [];
  private lineGroup = new THREE.Group();
  private polities: PolityRt[] = [];

  private labelLayer: HTMLDivElement;
  private labelPool: HTMLDivElement[] = [];
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

  /** Loads the height image (or its stand-in) and builds the engine. */
  static async create(container: HTMLElement, ds: NationalDataset, init: NationalInit = {}): Promise<NationalEngine> {
    const grid = await loadHeights(ds.terrain);
    return new NationalEngine(container, ds, grid, init);
  }

  constructor(private container: HTMLElement, readonly ds: NationalDataset, readonly grid: HeightGrid, init: NationalInit = {}) {
    this.scale = new TimeScale(ds.site.timeline.scale);
    const firstPreset = ds.eras.find((e) => validYear(e.presetYear))?.presetYear ?? ds.site.timeline.start;
    this.state = {
      t: this.scale.clamp(Number.isFinite(init.t) ? (init.t as number) : histToT(firstPreset)),
      playing: false, direction: 1, speed: 0, rate: 1, quality: init.quality ?? "medium", fps: 0,
      labels: init.labels ?? true, polities: init.polities ?? true, evidence: init.evidence ?? false, ready: false,
    };

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
    this.measureCtx = document.createElement("canvas").getContext("2d")!;

    // --- height texture (half float: linear filtering is core WebGL2) ---
    // R = elevation (m), G = flood level (m): decoded on the CPU, so filtering here is safe.
    const half = new Uint16Array(grid.width * grid.height * 2);
    for (let i = 0; i < grid.data.length; i++) {
      half[i * 2] = THREE.DataUtils.toHalfFloat(grid.data[i]);
      half[i * 2 + 1] = THREE.DataUtils.toHalfFloat(grid.flood[i]);
    }
    this.heightTex = new THREE.DataTexture(half, grid.width, grid.height, THREE.RGFormat, THREE.HalfFloatType);
    this.heightTex.minFilter = this.heightTex.magFilter = THREE.LinearFilter;
    this.heightTex.wrapS = this.heightTex.wrapT = THREE.ClampToEdgeWrapping;
    this.heightTex.needsUpdate = true;

    // --- polity overlay: indicative extents painted into a map-space canvas and draped by the terrain shader ---
    this.polCanvas = document.createElement("canvas");
    this.polCanvas.width = 768;
    this.polCanvas.height = Math.max(64, Math.min(1400, Math.round((768 * d) / w)));
    this.polTex = new THREE.CanvasTexture(this.polCanvas);
    this.polTex.flipY = false;
    this.polTex.colorSpace = THREE.SRGBColorSpace;
    this.polTex.generateMipmaps = false;
    this.polTex.minFilter = this.polTex.magFilter = THREE.LinearFilter;

    const C = (hex: number) => ({ value: new THREE.Color(hex) });
    const shared = {
      uH: { value: this.heightTex },
      uPol: { value: this.polTex },
      uRect: { value: new THREE.Vector4(this.rect.xMin, this.rect.zMin, 1 / w, 1 / d) },
      uTexel: { value: new THREE.Vector2(1 / grid.width, 1 / grid.height) },
      uCell: { value: new THREE.Vector2(w / grid.width, d / grid.height) },
      uSea: { value: 0 },
      uExag: { value: VERTICAL_EXAGGERATION / 1000 },
      uWood: { value: 0.3 },
      uPolOn: { value: 1 },
      uTime: { value: 0 },
      cWood: C(0x4a6644), cOpen: C(0xb3b585), cHill: C(0xa49c74), cMoor: C(0x93866a), cHigh: C(0xc2bba8), cMarsh: C(0x7f9a7a),
      cShallow: C(0x86b3b6), cShelf: C(0x4d8192), cDeep: C(0x2b4b61), cEdge: C(0x3a6377), cInk: C(0x1b2a33), uFog: C(0x9fb2bd),
    };
    this.terrainMat = new THREE.ShaderMaterial({ uniforms: shared, vertexShader: TERRAIN_VS, fragmentShader: TERRAIN_FS });
    this.terrainMat.extensions = { ...(this.terrainMat.extensions ?? {}) } as THREE.ShaderMaterial["extensions"];

    // open sea beyond the height grid, out to the horizon
    this.ocean = new THREE.Mesh(
      new THREE.RingGeometry(1, 14000, 48, 1).rotateX(-Math.PI / 2),
      new THREE.ShaderMaterial({
        uniforms: { cDeep: shared.cEdge, uFog: shared.uFog },
        vertexShader: "varying vec3 vW; void main(){ vec4 w = modelMatrix*vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }",
        fragmentShader: `uniform vec3 cDeep; uniform vec3 uFog; varying vec3 vW;
          void main(){ float dist = length(cameraPosition - vW); float f = 1.0 - exp(-pow(dist/${FOG_KM}, 2.0));
            gl_FragColor = vec4(mix(cDeep, uFog, f), 1.0);
            #include <colorspace_fragment>
          }`,
      }),
    );
    this.ocean.position.y = -0.6;
    this.ocean.renderOrder = -2;
    this.scene.add(this.ocean);

    // simple gradient sky: pale haze at the horizon, deeper blue overhead
    this.sky = new THREE.Mesh(
      new THREE.SphereGeometry(12000, 32, 16),
      new THREE.ShaderMaterial({
        side: THREE.BackSide, depthWrite: false,
        uniforms: { uFog: shared.uFog, cTop: C(0x46627f) },
        vertexShader: "varying vec3 vD; void main(){ vD = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }",
        fragmentShader: `uniform vec3 uFog; uniform vec3 cTop; varying vec3 vD;
          void main(){ float e = normalize(vD).y; vec3 c = mix(uFog, cTop, smoothstep(0.0, 0.55, e)); c = mix(c, uFog*1.06, exp(-abs(e)*14.0)*0.6);
            gl_FragColor = vec4(c, 1.0);
            #include <colorspace_fragment>
          }`,
      }),
    );
    this.sky.renderOrder = -3;
    this.sky.frustumCulled = false;
    this.scene.add(this.sky);

    this.markerMat = new THREE.ShaderMaterial({
      transparent: true, depthTest: false, depthWrite: false,
      uniforms: { uPx: { value: 1 }, uTime: { value: 0 } },
      vertexShader: MARKER_VS,
      fragmentShader: MARKER_FS,
    });
    this.markers = new THREE.Points(this.markerGeo, this.markerMat);
    this.markers.frustumCulled = false;
    this.markers.renderOrder = 30;
    this.lineGroup.renderOrder = 20;
    this.scene.add(this.lineGroup, this.markers);

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
    el.addEventListener("contextmenu", this.onContext);
    window.addEventListener("pointermove", this.onPointerMove);
    window.addEventListener("pointerup", this.onPointerUp);
    window.addEventListener("resize", this.resize);
    this.state.ready = true;
    this.last = performance.now();
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
  private surfaceYxz(x: number, z: number): number {
    const [lat, lon] = this.toLatLon(x, z);
    return this.surfaceY(lat, lon);
  }

  // ---------- scene construction ----------

  private buildTerrain(): void {
    if (this.terrainMesh) {
      this.scene.remove(this.terrainMesh);
      this.terrainMesh.geometry.dispose();
    }
    const q = QUALITY[this.state.quality];
    const nx = q.segments, nz = Math.max(2, Math.round((q.segments * this.rect.d) / this.rect.w));
    const geo = new THREE.PlaneGeometry(this.rect.w, this.rect.d, nx, nz).rotateX(-Math.PI / 2);
    geo.deleteAttribute("normal");
    geo.deleteAttribute("uv");
    this.terrainMesh = new THREE.Mesh(geo, this.terrainMat);
    this.terrainMesh.frustumCulled = false;
    this.terrainMesh.renderOrder = 0;
    this.scene.add(this.terrainMesh);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.dpr));
    this.markerMat.uniforms.uPx.value = this.renderer.getPixelRatio();
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
        place, phases, names, pos: new THREE.Vector3(x, this.surfaceY(place.lat, place.lon) + 0.2, z),
        alpha: 0, size: 0, kind: place.kind, ring: false, name: place.name, sx: 0, sy: 0, onScreen: false, radius: 0,
      });
    }
    // small things first so the larger markers are drawn over them
    const peak = (p: PlaceRt) => Math.max(...p.phases.map((f) => f.size));
    this.places.sort((a, b) => peak(a) - peak(b));
    const n = this.places.length;
    const pos = new Float32Array(n * 3);
    this.places.forEach((p, i) => p.pos.toArray(pos, i * 3));
    this.markerGeo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    this.markerGeo.setAttribute("aStyle", new THREE.BufferAttribute(new Float32Array(n * 4), 4).setUsage(THREE.DynamicDrawUsage)); // size px, glyph, alpha, flags
    this.markerGeo.setAttribute("aColor", new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage));
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
      const mat = new LineMaterial({
        color: style.color, linewidth: style.width, transparent: true, opacity: 0, depthTest: false, depthWrite: false,
        dashed: !!style.dash, dashSize: style.dash?.[0] ?? 1, gapSize: style.dash?.[1] ?? 0, worldUnits: false,
      });
      const obj = new Line2(geo, mat);
      obj.computeLineDistances();
      obj.frustumCulled = false;
      obj.renderOrder = line.kind === "frontier-wall" || line.kind === "dyke" ? 22 : 21;
      this.lineGroup.add(obj);
      this.lines.push({ line, t0, t1, obj, mat, pts, mid: pts[Math.floor(pts.length / 2)], alpha: 0, screen: new Float32Array(pts.length * 2) });
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
        ring, latlon, area, alpha: 0,
      });
    });
  }

  // ---------- timeline ----------

  private applyYear(): void {
    const t = this.state.t;
    const u = this.terrainMat.uniforms;
    u.uSea.value = this.seaLevel(t);
    u.uWood.value = this.woodland(t);
    this.ocean.position.y = (u.uSea.value * VERTICAL_EXAGGERATION) / 1000 - 0.6;

    const style = this.markerGeo.getAttribute("aStyle") as THREE.BufferAttribute;
    const color = this.markerGeo.getAttribute("aColor") as THREE.BufferAttribute;
    const c = new THREE.Color();
    const selId = this.selection?.type === "place" ? this.selection.place.id : null;
    this.places.forEach((p, i) => {
      this.evalPlace(p, t);
      const st = PLACE_STYLE[p.kind] ?? PLACE_STYLE.other;
      const px = p.ring ? 8 : 5 + 2.8 * p.size;
      const flags = (p.ring ? 1 : 0) + (p.place.site ? 2 : 0) + (p.place.id === selId ? 4 : 0);
      style.setXYZW(i, px, st.glyph, p.alpha, flags);
      c.setHex(this.state.evidence ? EV_COLOR[evClass(p.place.evidence)] : st.color);
      color.setXYZ(i, c.r, c.g, c.b);
    });
    style.needsUpdate = true;
    color.needsUpdate = true;

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
      l.obj.visible = a > 0.004;
      l.mat.opacity = a;
      const st = LINE_STYLE[l.line.kind] ?? LINE_STYLE.road;
      l.mat.color.setHex(this.state.evidence ? EV_COLOR[evClass(l.line.evidence)] : st.color);
      l.mat.linewidth = st.width * (l.line.id === selLine ? 1.7 : 1);
    }

    const FADE = 15;
    let sig = this.state.polities ? "" : "off";
    for (const p of this.polities) {
      let a = 0;
      if (t >= p.t0) a = t < p.t1 ? Math.min(1, 0.3 + (t - p.t0) / FADE) : Math.max(0, 1 - (t - p.t1) / FADE);
      p.alpha = a;
      if (a > 0 && p.ring) sig += `${p.polity.id}:${Math.round(a * 20)};`;
    }
    u.uPolOn.value = this.state.polities ? 1 : 0;
    if (sig !== this.polSig) this.drawPolities(sig);
    this.labelsDirty = true;
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
      p.alpha = continues ? 1 : Math.min(1, 0.4 + f);
      p.kind = cur.kind;
      p.ring = cur.size === 0;
      // sizes ease from the previous phase rather than jump
      p.size = continues && prev && prev.size > 0 && cur.size > 0 ? prev.size + (cur.size - prev.size) * f : cur.size;
      if (p.ring) p.alpha *= 0.75;
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
    // largest first, so small polities inside big ones stay visible
    const act = this.polities.filter((p) => p.alpha > 0 && p.ring).sort((a, b) => b.area - a.area);
    for (const p of act) {
      ctx.lineJoin = "round";
      ctx.fillStyle = p.color;
      ctx.strokeStyle = p.color;
      // Extents are indicative, so the edge is a soft band rather than a ruled frontier.
      if (canBlur) ctx.filter = "blur(5px)";
      ctx.globalAlpha = p.alpha * 0.3;
      trace(p.ring!);
      ctx.fill();
      if (canBlur) ctx.filter = "blur(1.6px)";
      ctx.globalAlpha = p.alpha * 0.5;
      ctx.lineWidth = 3;
      trace(p.ring!);
      ctx.stroke();
      if (canBlur) ctx.filter = "none";
    }
    ctx.globalAlpha = 1;
    this.polTex.needsUpdate = true;
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
    const tilt = 0.4; // radians from vertical
    // the timeline and header take about a quarter of the height, so fit into what is left
    this.fitDistance = Math.max((d * Math.cos(tilt)) / (2 * tan * 0.86), w / (2 * tan * aspect * 0.9));
    const cx = (l.xMin + l.xMax) / 2, cz = (l.zMin + l.zMax) / 2 + d * 0.035;
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
  resetView(): void {
    this.computeHome();
    this.applyHome();
    this.emit(true);
  }
  /** Centre a place and move in close enough to see its surroundings. The year is not changed. */
  focusPlace(id: string, distance = 240): void {
    const p = this.places.find((x) => x.place.id === id);
    if (!p) return;
    const dir = this.camera.position.clone().sub(this.controls.target);
    const len = Math.min(dir.length(), distance);
    dir.normalize();
    this.controls.target.set(p.pos.x, 0, p.pos.z);
    this.camera.position.copy(this.controls.target).addScaledVector(dir, len);
    this.controls.update();
  }
  getCamera(): { position: number[]; target: number[] } {
    return { position: this.camera.position.toArray(), target: this.controls.target.toArray() };
  }
  setCamera(position: number[], target: number[]): void {
    if (![...position, ...target].every(Number.isFinite)) return;
    this.camera.position.fromArray(position);
    this.controls.target.fromArray(target);
    this.controls.update();
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
  /** Set the selection (highlights it on the map) and tell listeners. */
  select(sel: NationalSelection): void {
    this.selection = sel;
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

  private onContext = (e: Event) => e.preventDefault();
  private onPointerDown = (e: PointerEvent) => {
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
  };
  private onHover = (e: PointerEvent) => {
    if (this.drag) return;
    this.renderer.domElement.style.cursor = this.hitTest(e.clientX, e.clientY, false) ? "pointer" : "grab";
  };

  /** What is under a screen point: a label, then a marker, then a line, then (for clicks) an indicative polity extent. */
  private hitTest(cx: number, cy: number, deep: boolean): NationalSelection {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const x = cx - rect.left, y = cy - rect.top;
    this.projectAll(rect.width, rect.height);
    let best: PlaceRt | null = null, bd = Infinity;
    for (const p of this.places) {
      if (p.alpha < 0.15 || !p.onScreen) continue;
      const d = Math.hypot(p.sx - x, p.sy - y);
      if (d < p.radius + 5 && d - p.radius < bd) {
        bd = d - p.radius;
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
    for (const l of this.lines) l.mat.resolution.set(w, h);
    this.markerMat.uniforms.uPx.value = this.renderer.getPixelRatio();
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

    if (s.playing) {
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

    // navigation limits: stay over the map, never under the relief
    const tg = this.controls.target, l = this.limit;
    tg.x = Math.max(l.xMin, Math.min(l.xMax, tg.x));
    tg.z = Math.max(l.zMin, Math.min(l.zMax, tg.z));
    tg.y = 0;
    this.controls.update();
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
    this.markerMat.uniforms.uTime.value = now * 0.001;
    // dashes keep a constant on-screen length whatever the zoom
    const h = this.container.clientHeight || 1;
    const kmPerPx = (2 * dist * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2))) / h;
    for (const ln of this.lines) if (ln.mat.dashed) ln.mat.dashScale = 1 / Math.max(0.02, kmPerPx);

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
      v.copy(p.pos).project(this.camera);
      p.onScreen = v.z > -1 && v.z < 1 && Math.abs(v.x) < 1.05 && Math.abs(v.y) < 1.05;
      p.sx = (v.x * 0.5 + 0.5) * w;
      p.sy = (-v.y * 0.5 + 0.5) * h;
      p.radius = ((p.ring ? 8 : 5 + 2.8 * p.size) * zoom) / 2;
    }
    for (const l of this.lines) {
      if (l.alpha < 0.05) continue;
      for (let i = 0; i < l.pts.length; i++) {
        v.copy(l.pts[i]).project(this.camera);
        const ok = v.z > -1 && v.z < 1;
        l.screen[i * 2] = ok ? (v.x * 0.5 + 0.5) * w : NaN;
        l.screen[i * 2 + 1] = ok ? (-v.y * 0.5 + 0.5) * h : NaN;
      }
    }
  }
  /** Markers grow a little as the camera comes in. Must match the marker vertex shader. */
  private zoomFactor(dist: number): number {
    return THREE.MathUtils.clamp(Math.pow(this.fitDistance / Math.max(1, dist), 0.3), 0.8, 1.9);
  }

  private textWidth(text: string, font: string, spacing = 0): number {
    const key = font + "|" + text;
    let w = this.widths.get(key);
    if (w == null) {
      this.measureCtx.font = font;
      w = this.measureCtx.measureText(text).width + spacing * text.length;
      this.widths.set(key, w);
    }
    return w;
  }

  private updateLabels(): void {
    this.labelsDirty = false;
    this.labelBoxes.length = 0;
    const on = this.state.labels;
    this.labelLayer.style.display = on ? "block" : "none";
    this.markerMat.uniforms.uPx.value = this.renderer.getPixelRatio() * this.zoomFactor(this.camera.position.distanceTo(this.controls.target));
    if (!on) {
      this.labelCount = 0;
      return;
    }
    const w = this.container.clientWidth, h = this.container.clientHeight;
    this.projectAll(w, h);
    const dist = this.camera.position.distanceTo(this.controls.target);
    const zoom = this.fitDistance / Math.max(1, dist); // 1 = whole map, larger = closer
    const boxes: LabelBox[] = [];
    const free = (b: { x0: number; y0: number; x1: number; y1: number }) => !boxes.some((o) => b.x0 < o.x1 + 3 && b.x1 > o.x0 - 3 && b.y0 < o.y1 + 2 && b.y1 > o.y0 - 2);
    let n = 0;
    const put = (text: string, cls: string, x: number, y: number, opacity: number, fontPx: number | null, sel: NationalSelection, site = false) => {
      let el = this.labelPool[n];
      if (!el) {
        el = document.createElement("div");
        this.labelLayer.appendChild(el);
        this.labelPool.push(el);
      }
      if (el.textContent !== text) el.textContent = text;
      const cn = "nat-label " + cls + (site ? " has-site" : "");
      if (el.className !== cn) el.className = cn;
      el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
      el.style.opacity = opacity.toFixed(2);
      el.style.fontSize = fontPx ? `${fontPx.toFixed(1)}px` : "";
      el.style.display = "block";
      el.dataset.sel = sel ? (sel.type === "place" ? sel.place.id : sel.type === "line" ? sel.line.id : sel.polity.id) : "";
      n++;
    };
    const selId = this.selection?.type === "place" ? this.selection.place.id : null;

    // 1. markers are obstacles: no label may cover a visible place
    const vis = this.places.filter((p) => p.onScreen && p.alpha > 0.15);
    for (const p of vis) if (!p.ring && p.size >= 2) boxes.push({ x0: p.sx - p.radius, y0: p.sy - p.radius, x1: p.sx + p.radius, y1: p.sy + p.radius, sel: null });

    // 2. polity names: large spaced capitals, centred on labelAt
    if (this.state.polities) {
      const v = new THREE.Vector3();
      const fpx = THREE.MathUtils.clamp(11.5 * Math.pow(zoom, 0.5), 11, 18);
      const act = this.polities.filter((p) => p.alpha > 0.02).sort((a, b) => b.alpha - a.alpha || b.area - a.area);
      for (const p of act) {
        v.copy(p.pos).project(this.camera);
        if (v.z > 1 || v.z < -1) continue;
        const x = (v.x * 0.5 + 0.5) * w, y = (-v.y * 0.5 + 0.5) * h;
        // long names ("Kingdom of the East Angles") are set on two lines
        let text = (p.polity.name.replace(/\s*\([^)]*\)/g, "").trim() || p.polity.name).toUpperCase(); // the panel gives the full name
        if (text.length > 14 && text.includes(" ")) {
          const words = text.split(" ");
          let best = 1, bd = Infinity;
          for (let k = 1; k < words.length; k++) {
            const d = Math.abs(words.slice(0, k).join(" ").length - words.slice(k).join(" ").length);
            if (d < bd) { bd = d; best = k; }
          }
          text = words.slice(0, best).join(" ") + "\n" + words.slice(best).join(" ");
        }
        const rows = text.split("\n");
        const big = p.polity.kind === "realm" || p.polity.kind === "province" ? 1.2 : p.polity.kind === "people" ? 0.9 : 1;
        const size = fpx * big;
        const tw = Math.max(...rows.map((r) => this.textWidth(r, `600 ${size.toFixed(1)}px ${SERIF}`, size * 0.3)));
        const th = size * 1.3 * rows.length;
        const b = { x0: x - tw / 2, y0: y - th / 2, x1: x + tw / 2, y1: y + th / 2 };
        if (b.x1 < 0 || b.x0 > w || b.y1 < 0 || b.y0 > h) continue;
        // polity names only yield to each other: places are small and are placed around them
        if (boxes.some((o) => o.sel?.type === "polity" && b.x0 < o.x1 + 8 && b.x1 > o.x0 - 8 && b.y0 < o.y1 + 5 && b.y1 > o.y0 - 5)) continue;
        const sel: NationalSelection = { type: "polity", polity: p.polity };
        boxes.push({ ...b, sel });
        put(text, "polity k-" + p.polity.kind, b.x0, b.y0, p.alpha * 0.9, size, sel);
      }
    }

    // 3. place names: most important first; smaller places wait until the camera is close
    const minSize = zoom < 1.25 ? 3 : zoom < 2.2 ? 2 : 1;
    const maxLabels = zoom < 1.25 ? 30 : zoom < 2.2 ? 48 : 70;
    const cand = vis
      .filter((p) => p.place.id === selId || (p.ring ? zoom > 3.4 : p.size >= minSize - 0.01) || (p.place.site != null && !p.ring))
      .sort((a, b) => Number(b.place.id === selId) - Number(a.place.id === selId) || Number(!!b.place.site) - Number(!!a.place.site) || b.size - a.size || b.alpha - a.alpha);
    let placed = 0;
    for (const p of cand) {
      if (placed >= maxLabels) break;
      const cls = p.ring ? 0 : Math.max(1, Math.min(5, Math.round(p.size)));
      const fpx = [10.5, 10.5, 11, 12, 13.5, 15][cls];
      const font = `${cls >= 4 ? 600 : 500} ${fpx}px ${cls >= 4 ? SERIF : SANS}`;
      const tw = this.textWidth(p.name, font) + (p.place.site ? 15 : 0) + 2;
      const th = fpx * 1.25, r = p.radius + 3;
      const opts: [number, number][] = [[p.sx + r, p.sy - th / 2], [p.sx - r - tw, p.sy - th / 2], [p.sx - tw / 2, p.sy - r - th], [p.sx - tw / 2, p.sy + r], [p.sx + r * 0.7, p.sy - r * 0.7 - th], [p.sx + r * 0.7, p.sy + r * 0.7]];
      for (const [x, y] of opts) {
        const b = { x0: x, y0: y, x1: x + tw, y1: y + th };
        if (b.x0 < 2 || b.x1 > w - 2 || b.y0 < 2 || b.y1 > h - 2) continue;
        if (!free(b)) continue;
        const sel: NationalSelection = { type: "place", place: p.place };
        boxes.push({ ...b, sel });
        put(p.name, `place s${cls}` + (p.place.id === selId ? " sel" : "") + (p.ring ? " gone" : ""), x, y, Math.min(1, p.alpha * 1.3), null, sel, !!p.place.site);
        placed++;
        break;
      }
    }

    // 4. line names, once the camera is close enough for them to mean something
    if (zoom > 1.5) {
      const v = new THREE.Vector3();
      for (const l of this.lines) {
        if (l.alpha < 0.5) continue;
        v.copy(l.mid).project(this.camera);
        if (v.z > 1 || v.z < -1) continue;
        const x = (v.x * 0.5 + 0.5) * w, y = (-v.y * 0.5 + 0.5) * h;
        const tw = this.textWidth(l.line.name, `italic 500 11px ${SERIF}`) + 2;
        const b = { x0: x + 6, y0: y - 16, x1: x + 6 + tw, y1: y - 2 };
        if (b.x0 < 2 || b.x1 > w - 2 || b.y0 < 2 || b.y1 > h - 2 || !free(b)) continue;
        const sel: NationalSelection = { type: "line", line: l.line };
        boxes.push({ ...b, sel });
        put(l.line.name, "line", b.x0, b.y0, 0.92, null, sel);
      }
    }
    for (let i = n; i < this.labelPool.length; i++) this.labelPool[i].style.display = "none";
    this.labelCount = n;
    this.labelBoxes = boxes.filter((b) => b.sel);
  }

  // ---------- diagnostics ----------

  stats(): {
    fps: number; frameMs: number; worstMs: number; calls: number; triangles: number; places: number; placesVisible: number; lines: number; linesVisible: number;
    polities: number; politiesVisible: number; labels: number; pixelRatio: number; size: [number, number];
    terrain: { width: number; height: number; procedural: boolean; min: number; max: number }; seaLevel: number; woodland: number; exaggeration: number;
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
      terrain: { width: this.grid.width, height: this.grid.height, procedural: this.grid.procedural, min: this.grid.min, max: this.grid.max },
      seaLevel: this.seaLevel(), woodland: this.woodland(), exaggeration: VERTICAL_EXAGGERATION,
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

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    const el = this.renderer.domElement;
    el.removeEventListener("pointerdown", this.onPointerDown);
    el.removeEventListener("pointermove", this.onHover);
    el.removeEventListener("contextmenu", this.onContext);
    window.removeEventListener("pointermove", this.onPointerMove);
    window.removeEventListener("pointerup", this.onPointerUp);
    window.removeEventListener("resize", this.resize);
    this.listeners.clear();
    this.selectListeners.clear();
    this.enterListeners.clear();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose();
    });
    this.heightTex.dispose();
    this.polTex.dispose();
    this.controls.dispose();
    this.renderer.dispose();
    el.remove();
    this.labelLayer.remove();
  }
}

const SERIF = `"Iowan Old Style", "Palatino Linotype", Palatino, "Book Antiqua", Georgia, serif`;
const SANS = `ui-sans-serif, -apple-system, "Segoe UI", system-ui, sans-serif`;
/** Haze: distance (km) at which about two thirds of the colour has gone to the horizon tone. */
const FOG_KM = "4200.0";

const TERRAIN_COMMON = /* glsl */ `
  uniform sampler2D uH;
  uniform vec4 uRect;
  uniform float uSea;
  uniform float uExag;
  // 0 at the edge of the height grid, 1 a little way in: the data stops there, so the model melts into open sea
  float edgeFade(vec2 m){ vec2 e = min(m, 1.0 - m); return smoothstep(0.0, 0.07, min(e.x, e.y)); }
`;

const TERRAIN_VS = /* glsl */ `
  ${TERRAIN_COMMON}
  varying vec2 vM;
  varying vec3 vW;
  void main(){
    vec4 w = modelMatrix * vec4(position, 1.0);
    vM = (w.xz - uRect.xy) * uRect.zw;
    float h = texture2D(uH, vM).r;
    w.y = mix(uSea, max(h, uSea), edgeFade(vM)) * uExag;
    vW = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const TERRAIN_FS = /* glsl */ `
  ${TERRAIN_COMMON}
  uniform sampler2D uPol;
  uniform vec2 uTexel;
  uniform vec2 uCell;
  uniform float uWood;
  uniform float uPolOn;
  uniform float uTime;
  uniform vec3 cWood, cOpen, cHill, cMoor, cHigh, cMarsh, cShallow, cShelf, cDeep, cEdge, cInk, uFog;
  varying vec2 vM;
  varying vec3 vW;

  float H(vec2 uv){ return texture2D(uH, uv).r; }
  vec2 grad(vec2 uv, float k){
    vec2 e = uTexel * k;
    return vec2(H(uv + vec2(e.x, 0.0)) - H(uv - vec2(e.x, 0.0)), H(uv + vec2(0.0, e.y)) - H(uv - vec2(0.0, e.y))) / (2.0 * k * uCell * 1000.0);
  }
  float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
    return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y); }

  void main(){
    // smoothed bilinear lookup: rounds off the diamond-shaped creases of plain bilinear filtering along the coast
    vec2 tc = vM / uTexel + 0.5;
    vec2 ti = floor(tc), tf = tc - ti;
    tf = tf * tf * (3.0 - 2.0 * tf);
    vec2 hf = texture2D(uH, (ti + tf - 0.5) * uTexel).rg;
    float h = hf.r;
    // true slope (rise over run) at two scales: fine detail and the broad landform
    vec2 g1 = grad(vM, 1.0);
    vec2 g4 = grad(vM, 4.0);
    float a = h - uSea;

    // ---- shaded relief: light from the north-west, as on a printed map ----
    const float RELIEF = 13.0;
    vec3 L = normalize(vec3(-0.58, 0.60, -0.55));
    vec3 n1 = normalize(vec3(-g1.x * RELIEF, 1.0, -g1.y * RELIEF));
    vec3 n4 = normalize(vec3(-g4.x * RELIEF * 1.6, 1.0, -g4.y * RELIEF * 1.6));
    float s = (dot(n1, L) * 0.62 + dot(n4, L) * 0.38) / L.y;   // 1 on level ground
    float lum = clamp(1.0 + (s - 1.0) * 0.95, 0.42, 1.38);
    float slope = length(g1);

    // ---- land cover: one national woodland figure, not a map of where the trees were ----
    float w = clamp(uWood / 0.7, 0.0, 1.0);
    vec3 low = mix(cOpen, cWood, w);
    vec3 hill = mix(cHill, cWood * 0.95, w * 0.65);
    vec3 land = mix(low, hill, smoothstep(110.0, 330.0, a));
    land = mix(land, mix(cMoor, cWood, w * 0.25), smoothstep(280.0, 560.0, a));
    land = mix(land, cHigh, smoothstep(640.0, 1000.0, a));
    land = mix(land, cMoor * 0.92, smoothstep(0.10, 0.36, slope) * 0.35);
    // ground within a few metres of the sea of the time: marsh and tidal flats
    land = mix(land, cMarsh, (1.0 - smoothstep(0.6, 4.5, a)) * 0.5);
    land *= lum;
    // steep, shaded faces lose a little colour, like hand-painted relief
    land = mix(land, vec3(dot(land, vec3(0.3, 0.55, 0.15))) * vec3(0.92, 0.95, 1.05), clamp((1.0 - lum) * 0.5, 0.0, 0.3));

    vec4 pol = texture2D(uPol, vM);
    land = mix(land, pol.rgb * (0.55 + 0.45 * lum), pol.a * uPolOn);

    // ---- sea: colour by depth, the shallow shelf lighter ----
    float d = max(-a, 0.0);
    vec3 sea = mix(cShallow, cShelf, smoothstep(0.0, 24.0, d));
    sea = mix(sea, cDeep, smoothstep(18.0, 95.0, d));
    vec3 V = normalize(cameraPosition - vW);
    vec2 wp = vW.xz * 0.9;
    float r1 = noise(wp + vec2(uTime * 0.05, uTime * 0.03)), r2 = noise(wp * 2.3 - vec2(uTime * 0.04, uTime * 0.06));
    vec3 wn = normalize(vec3((r1 - 0.5) * 0.22, 1.0, (r2 - 0.5) * 0.22));
    float glint = pow(max(dot(reflect(-L, wn), V), 0.0), 90.0);
    float fres = pow(1.0 - max(V.y, 0.0), 4.0);
    sea += vec3(1.0, 0.97, 0.9) * glint * 0.22 + uFog * fres * 0.25;
    sea *= 0.97 + 0.06 * r1;

    // ---- coastline: resolved per pixel from the height data, with an ink line ----
    // Sea is what the flood level says is joined to open water this year, not simply "below sea level":
    // drained fen that now lies under 0 m stays land (and takes the marsh tint above).
    float fl = hf.g - uSea;
    float fw = max(fwidth(hf.g), 1e-4);
    float f = fl / fw;
    vec3 col = mix(sea, land, smoothstep(-0.7, 0.7, f));
    col = mix(col, cInk, (1.0 - smoothstep(0.5, 1.7, abs(f))) * 0.5);

    col = mix(cEdge, col, edgeFade(vM));
    float dist = length(cameraPosition - vW);
    col = mix(col, uFog, 1.0 - exp(-pow(dist / ${FOG_KM}, 2.0)));
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;

const MARKER_VS = /* glsl */ `
  attribute vec4 aStyle;   // size px, glyph, alpha, flags
  attribute vec3 aColor;
  uniform float uPx;
  varying vec3 vColor;
  varying vec4 vStyle;
  void main(){
    vColor = aColor;
    vStyle = aStyle;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    // the glyph fills 0.56 of the sprite; the rest is room for the outline, the site ring and a soft shadow
    gl_PointSize = aStyle.z > 0.004 ? aStyle.x * uPx / 0.56 : 0.0;
  }
`;

const MARKER_FS = /* glsl */ `
  uniform float uTime;
  uniform float uPx;
  varying vec3 vColor;
  varying vec4 vStyle;
  float sdBox(vec2 p, vec2 b){ vec2 d = abs(p) - b; return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0); }
  float sdTri(vec2 p, float r){ const float k = 1.7320508; p.x = abs(p.x) - r; p.y = p.y + r / k;
    if (p.x + k * p.y > 0.0) p = vec2(p.x - k * p.y, -k * p.x - p.y) / 2.0;
    p.x -= clamp(p.x, -2.0 * r, 0.0); return -length(p) * sign(p.y); }
  float sdHex(vec2 p, float r){ const vec3 k = vec3(-0.8660254, 0.5, 0.57735); p = abs(p); p -= 2.0 * min(dot(k.xy, p), 0.0) * k.xy;
    p -= vec2(clamp(p.x, -k.z * r, k.z * r), r); return length(p) * sign(p.y); }
  float glyph(vec2 p, float k){
    float r = 0.56;
    if (k < 1.5) return length(p) - r * (k < 0.5 ? 0.86 : 1.0);                    // 0 town / 1 city
    if (k < 2.5) return sdBox(p, vec2(r * 0.8));                                    // 2 fort
    if (k < 3.5) return sdTri(p + vec2(0.0, 0.06), r * 0.95);                       // 3 hillfort
    if (k < 4.5) return (abs(p.x) + abs(p.y)) * 0.7071 - r * 0.74;                  // 4 castle
    if (k < 5.5) return min(sdBox(p, vec2(r * 0.3, r)), sdBox(p - vec2(0.0, r * 0.22), vec2(r * 0.78, r * 0.3))); // 5 church
    if (k < 6.5) return abs(length(p) - r * 0.76) - r * 0.25;                       // 6 monument
    if (k < 7.5) { vec2 q = vec2(p.x + p.y, p.x - p.y) * 0.7071; return min(sdBox(q, vec2(r * 1.05, r * 0.25)), sdBox(q, vec2(r * 0.25, r * 1.05))); } // 7 battle
    if (k < 8.5) return sdHex(p, r * 0.86);                                         // 8 palace
    return sdTri(vec2(p.x, -p.y) + vec2(0.0, 0.06), r * 0.9);                       // 9 mine
  }
  void main(){
    vec2 p = vec2(gl_PointCoord.x * 2.0 - 1.0, 1.0 - gl_PointCoord.y * 2.0);
    float size = vStyle.x * uPx / 0.56;
    float aa = 2.2 / size;
    float flags = vStyle.w;
    bool sel = flags > 3.5; if (sel) flags -= 4.0;
    bool site = flags > 1.5; if (site) flags -= 2.0;
    bool ring = flags > 0.5;
    vec3 ink = vec3(0.045, 0.04, 0.03);
    vec3 amber = vec3(0.76, 0.46, 0.10);
    vec4 c = vec4(0.0);
    if (ring) {
      // abandoned, but the site is known: a faint open ring
      float d = abs(length(p) - 0.42) - 0.075;
      float sh = 1.0 - smoothstep(0.0, 0.16 + aa, d);
      c = vec4(ink, sh * 0.45);
      c = mix(c, vec4(vColor * 0.9, 0.85), 1.0 - smoothstep(-aa, aa, d));
    } else {
      float d = glyph(p, vStyle.y);
      float ow = max(0.12, 2.6 * aa);
      c = vec4(ink, (1.0 - smoothstep(ow, ow + 0.2, d)) * 0.3);            // soft shadow
      c = mix(c, vec4(ink, 0.95), 1.0 - smoothstep(ow - aa, ow, d));       // outline
      c = mix(c, vec4(vColor, 1.0), 1.0 - smoothstep(-aa, 0.0, d));        // fill
      if (vStyle.y > 0.5 && vStyle.y < 1.5) c = mix(c, vec4(ink, 1.0), 1.0 - smoothstep(0.17 - aa, 0.17, length(p))); // city: centre dot
    }
    if (site || sel) {
      // a detailed site can be entered here: amber ring (steady and heavier when selected)
      float rr = sel ? 0.9 : 0.86 + 0.04 * sin(uTime * 2.4);
      float d = abs(length(p) - rr) - (sel ? 0.07 : 0.045);
      c = mix(c, vec4(ink, 0.5), (1.0 - smoothstep(0.0, 0.07 + aa, d)) * (1.0 - c.a));
      c = mix(c, vec4(sel ? vec3(1.0, 0.9, 0.62) : amber * 1.25, 1.0), 1.0 - smoothstep(-aa, aa, d));
    }
    c.a *= vStyle.z;
    if (c.a < 0.004) discard;
    gl_FragColor = c;
    #include <colorspace_fragment>
  }
`;
