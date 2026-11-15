import * as THREE from "three";

/**
 * Cascaded shadow maps for the sun, without three's CSM addon (which replaces every material's
 * onBeforeCompile and would break the life, terrain and vegetation patches). The cascades are ordinary
 * shadow-casting DirectionalLights; the shader side lives in ./atmosphere.ts, which treats two or more
 * shadowed directional lights as cascades of one sun and applies the sun's light once, from light 0.
 * Cascades after the first have zero intensity, so anything that reads the lights without that shader
 * (e.g. a path tracer) still sees exactly one sun.
 *
 * Each cascade covers a slice of the view frustum (practical split: half logarithmic, half uniform); its
 * square is the slice's bounding sphere, so it does not change size as the camera turns, and its centre is
 * snapped to whole shadow-map texels, so shadow edges do not crawl as the camera moves.
 * Cascades after the first are refreshed every other frame.
 */
export class SunCascades {
  readonly lights: THREE.DirectionalLight[] = [];
  private splits: number[] = [];
  private frame = 0;
  private corners = Array.from({ length: 8 }, () => new THREE.Vector3());
  private tmp = new THREE.Vector3();
  private lightView = new THREE.Matrix4();
  private lightViewInv = new THREE.Matrix4();

  constructor(private scene: THREE.Scene, readonly sun: THREE.DirectionalLight) {
    this.lights.push(sun);
  }

  /** sizes[i] = map size of cascade i (empty = no shadows). `far` = distance covered by the last cascade. */
  configure(sizes: number[], bias: number): void {
    for (let i = 1; i < this.lights.length; i++) {
      const l = this.lights[i];
      l.shadow.map?.dispose();
      this.scene.remove(l, l.target);
      l.dispose();
    }
    this.lights.length = 1;
    const sun = this.sun;
    sun.castShadow = sizes.length > 0;
    // layer 4 (crowd figures) casts shadows but stays out of the water's mirror
    sun.shadow.camera.layers.enable(4);
    sun.shadow.bias = bias;
    if (sizes.length) {
      sun.shadow.mapSize.set(sizes[0], sizes[0]);
      sun.shadow.map?.dispose();
      sun.shadow.map = null as unknown as THREE.WebGLRenderTarget;
    }
    for (let i = 1; i < sizes.length; i++) {
      const l = new THREE.DirectionalLight(sun.color, 0);
      l.name = `sun-cascade-${i}`;
      l.userData.cascadeOf = "sun";
      l.castShadow = true;
      l.shadow.camera.layers.enable(4);
      l.shadow.mapSize.set(sizes[i], sizes[i]);
      l.shadow.bias = bias;
      this.scene.add(l, l.target);
      this.lights.push(l);
    }
    for (const l of this.lights) l.shadow.autoUpdate = true;
  }

  get count(): number {
    return this.sun.castShadow ? this.lights.length : 0;
  }

  /** Lay the cascades over the view frustum from `near` to `far` (m). */
  update(camera: THREE.PerspectiveCamera, sunDir: THREE.Vector3, near: number, far: number, focus?: THREE.Vector3): void {
    const n = this.count;
    if (!n) return;
    this.frame++;
    for (const l of this.lights) l.color.copy(this.sun.color);
    if (n === 1) {
      // one map: fitted around the point of interest, as before, but texel-snapped
      const dist = focus ? camera.position.distanceTo(focus) : far * 0.3;
      const ext = THREE.MathUtils.clamp(dist * 0.95, 140, 2600);
      this.place(this.sun, focus ?? camera.position, ext, sunDir);
      return;
    }
    const lambda = 0.55;
    this.splits = [near];
    for (let i = 1; i <= n; i++) {
      const p = i / n;
      const log = near * Math.pow(far / near, p), uni = near + (far - near) * p;
      this.splits.push(lambda * log + (1 - lambda) * uni);
    }
    const tanY = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2), tanX = tanY * camera.aspect;
    camera.updateMatrixWorld();
    for (let i = 0; i < n; i++) {
      const l = this.lights[i];
      if (i > 0 && (this.frame + i) % 2 !== 0) {
        l.shadow.autoUpdate = false;
        l.shadow.needsUpdate = false;
        continue;
      }
      l.shadow.autoUpdate = true;
      // overlap neighbours a little so the blend band has data on both sides
      const z0 = this.splits[i] * (i ? 0.9 : 1), z1 = this.splits[i + 1];
      let k = 0;
      for (const z of [z0, z1])
        for (const sx of [-1, 1])
          for (const sy of [-1, 1]) this.corners[k++].set(sx * tanX * z, sy * tanY * z, -z).applyMatrix4(camera.matrixWorld);
      const c = this.tmp.set(0, 0, 0);
      for (const p of this.corners) c.add(p);
      c.multiplyScalar(1 / 8);
      let r = 0;
      for (const p of this.corners) r = Math.max(r, p.distanceTo(c));
      this.place(l, c, r * 1.04, sunDir);
    }
  }

  private place(l: THREE.DirectionalLight, centre: THREE.Vector3, ext: number, sunDir: THREE.Vector3): void {
    const sc = l.shadow.camera as THREE.OrthographicCamera;
    // snap the centre to the texel grid of a light-aligned frame
    this.lightView.lookAt(new THREE.Vector3(0, 0, 0), sunDir.clone().negate(), new THREE.Vector3(0, 1, 0));
    this.lightViewInv.copy(this.lightView).invert();
    const texel = (2 * ext) / l.shadow.mapSize.x;
    const p = centre.clone().applyMatrix4(this.lightViewInv);
    p.x = Math.round(p.x / texel) * texel;
    p.y = Math.round(p.y / texel) * texel;
    p.applyMatrix4(this.lightView);
    if (Math.abs(sc.right - ext) > ext * 0.02 || sc.far !== 12000) {
      sc.left = -ext; sc.right = ext; sc.top = ext; sc.bottom = -ext;
      sc.near = 1; sc.far = 12000;
      sc.updateProjectionMatrix();
    }
    l.shadow.normalBias = Math.max(0.02, texel * 1.2);
    l.target.position.copy(p);
    l.position.copy(p).addScaledVector(sunDir, 6000);
    l.target.updateMatrixWorld();
    l.updateMatrixWorld();
  }

  dispose(): void {
    this.configure([], 0);
  }
}
