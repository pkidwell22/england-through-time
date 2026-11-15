import * as THREE from "three";
import type { Dataset } from "@/lib/types";
import { hash2, rng } from "@/lib/geo";
import type { TerrainModel } from "@/lib/terrain";
import { histToT } from "@/lib/years";
import type { FabricLayer } from "./fabric";
import { applyLookFog } from "./look/atmosphere";

/**
 * Smoke and flame for dated fires: zones that end "by fire" and landmark phases
 * that end "burned". Purely an effect layer; when and where things burn comes
 * from the data.
 */
export class FireFx {
  readonly points: THREE.Points;
  private mat: THREE.ShaderMaterial;

  constructor(ds: Dataset, terrain: TerrainModel, fabric: FabricLayer) {
    const base: number[] = [];
    const win: number[] = [];
    const seed: number[] = [];
    const PER = 16;
    const plume = (x: number, y: number, z: number, t0: number, t1: number, k: number) => {
      for (let i = 0; i < PER; i++) {
        base.push(x, y, z);
        win.push(t0, t1);
        seed.push(i / PER, hash2(Math.round(x * 3) + i, Math.round(z * 3) + k), 0.6 + hash2(k, i) * 0.8);
      }
    };
    let k = 0;
    for (const zg of fabric.zoneGeoms) {
      const z = zg.zone;
      if (z.declineBy !== "fire" || !z.decline) continue;
      const t0 = histToT(z.decline[0]), t1 = histToT(z.decline[1]) + 1;
      const yp = terrain.yearParams(t0);
      const r = rng(k * 77 + 5);
      const n = Math.min(60, Math.max(10, Math.round((zg.radius * zg.radius) / 4500)));
      let placed = 0;
      for (let tries = 0; tries < n * 12 && placed < n; tries++) {
        const x = zg.bbox[0] + r() * (zg.bbox[2] - zg.bbox[0]), zz = zg.bbox[1] + r() * (zg.bbox[3] - zg.bbox[1]);
        if (zg.weight(x, zz) < 0.3) continue;
        const y = terrain.heightFrom(terrain.staticSample(x, zz), yp);
        if (!terrain.dry(y, 1.25)) continue;
        // each plume starts at a different moment in the fire and smoulders afterwards
        const s = t0 + r() * (t1 - t0) * 0.8;
        plume(x, y + 3, zz, s, s + (t1 - t0) * 0.35 + 0.25, k++);
        placed++;
      }
    }
    for (const lm of ds.landmarks) {
      const [x, z] = terrain.proj.toLocal(lm.lat, lm.lon);
      for (const p of lm.phases) {
        if (p.end !== "burned" || p.to == null) continue;
        const t0 = histToT(p.to);
        const y = Math.max(1, terrain.height(x, z, t0));
        for (let j = 0; j < 4; j++) plume(x + (hash2(j, k) - 0.5) * 24, y + 6, z + (hash2(k, j) - 0.5) * 24, t0, t0 + 1.2, k++);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(base, 3));
    g.setAttribute("aWin", new THREE.Float32BufferAttribute(win, 2));
    g.setAttribute("aSeed", new THREE.Float32BufferAttribute(seed, 3));
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, fog: false,
      uniforms: { uYear: { value: 0 }, uTime: { value: 0 }, uScale: { value: 600 } },
      vertexShader: `
        attribute vec2 aWin; attribute vec3 aSeed;
        uniform float uYear, uTime, uScale;
        varying float vAge; varying float vOn; varying float vHot;
        void main() {
          float on = smoothstep(aWin.x - 0.02, aWin.x + 0.06, uYear) * (1.0 - smoothstep(aWin.y, aWin.y + 0.5, uYear));
          float flaming = 1.0 - smoothstep(aWin.x, aWin.y, uYear);
          float age = fract(aSeed.x + uTime * 0.045 * aSeed.z + aSeed.y);
          vec3 p = position;
          float rise = age * (120.0 + 160.0 * aSeed.y);
          p.y += rise;
          // wind from the south-west, strengthening with height
          p.x += rise * 0.55 + sin(uTime * 0.3 + aSeed.y * 40.0 + age * 5.0) * 6.0 * age;
          p.z -= rise * 0.3 + cos(uTime * 0.25 + aSeed.y * 31.0) * 5.0 * age;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = on * (14.0 + age * 70.0) * aSeed.z * uScale / max(1.0, -mv.z);
          vAge = age; vOn = on; vHot = flaming;
        }`,
      fragmentShader: `
        varying float vAge; varying float vOn; varying float vHot;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float d = length(c);
          if (d > 0.5 || vOn < 0.01) discard;
          float soft = smoothstep(0.5, 0.05, d);
          // smoke is lit by the current sky and sun (ltA[9], see look/atmosphere.ts); flame is self-lit
          vec3 smoke = mix(vec3(0.07, 0.06, 0.055), vec3(0.38, 0.37, 0.36), smoothstep(0.1, 0.9, vAge)) * ltA[9].rgb;
          vec3 flame = mix(vec3(3.2, 1.3, 0.25), vec3(1.6, 0.35, 0.05), smoothstep(0.0, 0.12, vAge));
          float hot = vHot * (1.0 - smoothstep(0.0, 0.14, vAge));
          vec3 col = mix(smoke, flame, hot);
          float a = soft * vOn * mix(0.55, 0.0, smoothstep(0.35, 1.0, vAge)) * (0.75 + hot);
          gl_FragColor = vec4(col, a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    applyLookFog(this.mat);
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    this.points.name = "fire-fx";
  }

  update(t: number, timeSec: number, viewportHeight: number): void {
    this.mat.uniforms.uYear.value = t;
    this.mat.uniforms.uTime.value = timeSec;
    this.mat.uniforms.uScale.value = viewportHeight * 1.1;
  }
}
