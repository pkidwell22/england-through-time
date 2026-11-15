import * as THREE from "three";
import type { SmokeSink } from "./world";
import { applyLookFog } from "../look/atmosphere";

/**
 * Thin domestic smoke above occupied houses: a broad lazy haze out of the roof ridge or louvre for
 * open-hearth styles, a narrower wisp from a chimney for the chimneyed styles. Wood and turf smoke
 * seen against the sky is a dull grey-brown, not white, and it thins and pales as it rises and drifts
 * downwind. The puffs are small, soft-edged, irregular and overlapping, so a plume reads as one
 * trail rather than separate discs (from rooftop height large pale discs read as falling snow).
 * It is deliberately faint and low so it can never be mistaken for the dated fires of fx.ts
 * (dark, tall, hot-cored). Illustrative: one plume per selected house, not a record of any hearth.
 */
const PER = 8;

export class SmokeLayer implements SmokeSink {
  readonly points: THREE.Points;
  private pos: Float32Array;
  private seed: Float32Array;
  private posA: THREE.BufferAttribute;
  private seedA: THREE.BufferAttribute;
  private mat: THREE.ShaderMaterial;
  private n = 0;

  constructor(readonly cap: number) {
    this.pos = new Float32Array(cap * PER * 3);
    this.seed = new Float32Array(cap * PER * 4);
    const g = new THREE.BufferGeometry();
    this.posA = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.seedA = new THREE.BufferAttribute(this.seed, 4).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute("position", this.posA);
    g.setAttribute("aS", this.seedA);
    g.setDrawRange(0, 0);
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, fog: false,
      uniforms: { uTime: { value: 0 }, uViewH: { value: 900 }, uWind: { value: new THREE.Vector3(0.55, 0, -0.3) } },
      vertexShader: `
        attribute vec4 aS;
        uniform float uTime, uViewH; uniform vec3 uWind;
        varying float vA; varying float vAge; varying float vSeed;
        void main() {
          float ch = step(0.5, aS.z);
          float age = fract(aS.y + uTime * mix(0.03, 0.045, aS.x) + aS.x * 7.0);
          float rise = mix(5.0, 9.0, ch) * (0.75 + 0.5 * aS.x) * pow(age, 0.75);
          vec3 p = position;
          p.y += rise;
          // carried off downwind as it rises, with a slow wobble
          p.xz += uWind.xz * rise * 0.9 + vec2(sin(uTime * 0.33 + aS.x * 40.0 + age * 4.0), cos(uTime * 0.27 + aS.x * 31.0 + age * 3.0)) * (0.2 + 1.2 * age);
          p.xz += (vec2(fract(aS.x * 13.0), fract(aS.x * 29.0)) - 0.5) * mix(1.6, 0.25, ch) * (1.0 - age);
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          float diam = mix(1.2, 0.5, ch) + age * mix(4.0, 2.8, ch);
          gl_PointSize = clamp(diam * projectionMatrix[1][1] * uViewH * 0.5 / max(1.0, -mv.z), 1.0, 48.0);
          // fades in at the vent and thins away with height
          vA = aS.w * smoothstep(0.0, 0.12, age) * pow(1.0 - age, 1.4) * mix(0.22, 0.2, ch);
          vAge = age;
          vSeed = aS.x * 17.0 + aS.y * 5.0;
        }`,
      fragmentShader: `
        varying float vA; varying float vAge; varying float vSeed;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float d = length(c) * 2.0;
          if (d > 1.0 || vA < 0.002) discard;
          // a soft, lumpy wisp rather than a disc
          float ang = atan(c.y, c.x);
          float lump = 0.8 + 0.2 * sin(ang * 3.0 + vSeed) * sin(ang * 5.0 - vSeed * 1.7);
          float soft = exp(-d * d * 3.2 / (lump * lump)) * (1.0 - smoothstep(0.8, 1.0, d));
          // dull grey-brown near the vent, paler and greyer as it thins
          vec3 col = mix(vec3(0.40, 0.37, 0.33), vec3(0.58, 0.57, 0.55), vAge);
          gl_FragColor = vec4(col, soft * vA);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    // look hook: aerial perspective, mist and the light of the current sky (src/scene/look/atmosphere.ts)
    applyLookFog(this.mat, { lit: true });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 4;
    this.points.name = "domestic-smoke";
    this.points.userData.noPick = true;
  }

  begin(): void {
    this.n = 0;
  }

  add(x: number, y: number, z: number, type: number, seed: number, strength: number): boolean {
    if (this.n >= this.cap) return false;
    for (let k = 0; k < PER; k++) {
      const i = (this.n * PER + k) * 3, j = (this.n * PER + k) * 4;
      this.pos[i] = x; this.pos[i + 1] = y; this.pos[i + 2] = z;
      this.seed[j] = seed; this.seed[j + 1] = k / PER + seed * 0.1; this.seed[j + 2] = type; this.seed[j + 3] = strength;
    }
    this.n++;
    return true;
  }

  commit(): void {
    this.posA.needsUpdate = true;
    this.seedA.needsUpdate = true;
    this.points.geometry.setDrawRange(0, this.n * PER);
    this.points.visible = this.n > 0;
  }

  update(timeSec: number, viewportHeight: number): void {
    this.mat.uniforms.uTime.value = timeSec;
    this.mat.uniforms.uViewH.value = viewportHeight;
  }
}
