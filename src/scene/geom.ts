import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { tileOf } from "./materials";

/**
 * Collects simple solids per material name and merges them into one mesh per
 * material. All dimensions are metres. Local frame: +x = "length" axis,
 * +y up, +z = width axis. UVs are emitted in texture repeats at real scale.
 */
export class Builder {
  private parts = new Map<string, THREE.BufferGeometry[]>();
  private stack: THREE.Matrix4[] = [new THREE.Matrix4()];

  private get m(): THREE.Matrix4 {
    return this.stack[this.stack.length - 1];
  }

  /** Run fn in a child frame translated/rotated (about Y, radians) relative to the current one. */
  at(x: number, y: number, z: number, rotY: number, fn: () => void): void {
    const local = new THREE.Matrix4().makeRotationY(rotY).setPosition(x, y, z);
    this.stack.push(this.m.clone().multiply(local));
    fn();
    this.stack.pop();
  }

  add(mat: string, g: THREE.BufferGeometry, local?: THREE.Matrix4): void {
    let geo = g.index ? g.toNonIndexed() : g;
    if (!geo.attributes.normal) geo.computeVertexNormals();
    if (!geo.attributes.uv) {
      geo.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 2), 2));
    }
    for (const k of Object.keys(geo.attributes)) if (k !== "position" && k !== "normal" && k !== "uv") geo.deleteAttribute(k);
    const mm = local ? this.m.clone().multiply(local) : this.m;
    geo.applyMatrix4(mm);
    let list = this.parts.get(mat);
    if (!list) this.parts.set(mat, (list = []));
    list.push(geo);
  }

  /** Box centred on (x, z) with its base at y. */
  box(mat: string, w: number, h: number, d: number, x = 0, y = 0, z = 0, rotY = 0): void {
    if (w <= 0 || h <= 0 || d <= 0) return;
    const g = new THREE.BoxGeometry(w, h, d);
    const t = tileOf(mat);
    const uv = g.attributes.uv as THREE.BufferAttribute;
    const dims: [number, number][] = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
    for (let f = 0; f < 6; f++)
      for (let v = 0; v < 4; v++) {
        const i = f * 4 + v;
        uv.setXY(i, (uv.getX(i) * dims[f][0]) / t, (uv.getY(i) * dims[f][1]) / t);
      }
    this.add(mat, g, new THREE.Matrix4().makeRotationY(rotY).setPosition(x, y + h / 2, z));
  }

  /**
   * Gabled roof: ridge along local x. `l` length, `w` span, `rise` height.
   * Slopes use `roofMat`; the two gable triangles use `wallMat` (omit to leave open).
   */
  gable(roofMat: string, wallMat: string | null, l: number, w: number, rise: number, x = 0, y = 0, z = 0, rotY = 0, overhang = 0.4): void {
    const hl = l / 2 + overhang;
    const hw = w / 2 + overhang;
    const drop = (overhang * rise) / (w / 2);
    const slope = Math.hypot(hw, rise + drop);
    const t = tileOf(roofMat);
    const pos: number[] = [];
    const uv: number[] = [];
    const quad = (a: number[], b: number[], c: number[], d: number[], uw: number, vh: number) => {
      pos.push(...a, ...b, ...c, ...a, ...c, ...d);
      uv.push(0, 0, uw, 0, uw, vh, 0, 0, uw, vh, 0, vh);
    };
    // +z slope and -z slope (counter-clockwise seen from outside)
    quad([-hl, -drop, hw], [hl, -drop, hw], [hl, rise, 0], [-hl, rise, 0], (2 * hl) / t, slope / t);
    quad([hl, -drop, -hw], [-hl, -drop, -hw], [-hl, rise, 0], [hl, rise, 0], (2 * hl) / t, slope / t);
    // thin underside so the roof reads from below
    quad([hl, -drop, hw], [-hl, -drop, hw], [-hl, rise - 0.15, 0], [hl, rise - 0.15, 0], 1, 1);
    quad([-hl, -drop, -hw], [hl, -drop, -hw], [hl, rise - 0.15, 0], [-hl, rise - 0.15, 0], 1, 1);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    g.computeVertexNormals();
    const local = new THREE.Matrix4().makeRotationY(rotY).setPosition(x, y, z);
    this.add(roofMat, g, local);
    if (wallMat) {
      const tw = tileOf(wallMat);
      const p2: number[] = [];
      const u2: number[] = [];
      for (const s of [1, -1]) {
        const ex = (s * l) / 2;
        const tri = s > 0 ? [[ex, 0, w / 2], [ex, 0, -w / 2], [ex, rise, 0]] : [[ex, 0, -w / 2], [ex, 0, w / 2], [ex, rise, 0]];
        for (const v of tri) {
          p2.push(v[0], v[1], v[2]);
          u2.push((v[2] + w / 2) / tw, v[1] / tw);
        }
      }
      const g2 = new THREE.BufferGeometry();
      g2.setAttribute("position", new THREE.Float32BufferAttribute(p2, 3));
      g2.setAttribute("uv", new THREE.Float32BufferAttribute(u2, 2));
      g2.computeVertexNormals();
      this.add(wallMat, g2, local);
    }
  }

  /** Vertical cylinder / prism, base at y. */
  cyl(mat: string, rTop: number, rBot: number, h: number, sides: number, x = 0, y = 0, z = 0, rotY = 0, open = false): void {
    const g = new THREE.CylinderGeometry(rTop, rBot, h, sides, 1, open);
    const t = tileOf(mat);
    const uv = g.attributes.uv as THREE.BufferAttribute;
    const circ = 2 * Math.PI * Math.max(rTop, rBot);
    const sideVerts = (sides + 1) * 2;
    for (let i = 0; i < sideVerts; i++) uv.setXY(i, (uv.getX(i) * circ) / t, (uv.getY(i) * h) / t);
    this.add(mat, g, new THREE.Matrix4().makeRotationY(rotY).setPosition(x, y + h / 2, z));
  }

  cone(mat: string, r: number, h: number, sides: number, x = 0, y = 0, z = 0, rotY = 0): void {
    this.cyl(mat, 0.001, r, h, sides, x, y, z, rotY, true);
  }

  /** Four-sided pyramid/hip over a rectangle, base at y. */
  pyramid(mat: string, w: number, d: number, h: number, x = 0, y = 0, z = 0, rotY = 0): void {
    const g = new THREE.ConeGeometry(Math.SQRT1_2, h, 4, 1, true);
    g.rotateY(Math.PI / 4);
    g.scale(w, 1, d);
    const t = tileOf(mat);
    const uv = g.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * (w + d) * 2) / t, (uv.getY(i) * Math.hypot(h, w / 2)) / t);
    this.add(mat, g, new THREE.Matrix4().makeRotationY(rotY).setPosition(x, y + h / 2, z));
  }

  /** Hipped roof over a rectangle (ridge along x), base at y. */
  hip(mat: string, l: number, w: number, rise: number, x = 0, y = 0, z = 0, rotY = 0, overhang = 0.4): void {
    const hl = l / 2 + overhang;
    const hw = w / 2 + overhang;
    const r = Math.max(0, l / 2 - w / 2);
    const t = tileOf(mat);
    const pos: number[] = [];
    const uv: number[] = [];
    const tri = (a: number[], b: number[], c: number[]) => {
      pos.push(...a, ...b, ...c);
      uv.push(0, 0, Math.hypot(b[0] - a[0], b[2] - a[2]) / t, 0, 0.5, Math.hypot(rise, hw) / t);
    };
    const A = [-hl, 0, hw], B = [hl, 0, hw], C = [hl, 0, -hw], D = [-hl, 0, -hw];
    const R1 = [-r, rise, 0], R2 = [r, rise, 0];
    tri(A, B, R2); tri(A, R2, R1);
    tri(C, D, R1); tri(C, R1, R2);
    tri(B, C, R2);
    tri(D, A, R1);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    g.computeVertexNormals();
    this.add(mat, g, new THREE.Matrix4().makeRotationY(rotY).setPosition(x, y, z));
  }

  /** Extruded 2D shape (in the local x–y plane), extruded along z by `depth`, centred on z. */
  extrude(mat: string, shape: THREE.Shape, depth: number, x = 0, y = 0, z = 0, rotY = 0): void {
    const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 6 });
    g.translate(0, 0, -depth / 2);
    const t = tileOf(mat);
    const uv = g.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / t, uv.getY(i) / t);
    this.add(mat, g, new THREE.Matrix4().makeRotationY(rotY).setPosition(x, y, z));
  }

  /** Wall slab between two points with independent base heights (follows terrain). */
  slab(mat: string, ax: number, az: number, bx: number, bz: number, yBase: number, yTop: number, thick: number): void {
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 0.01) return;
    const rot = -Math.atan2(bz - az, bx - ax);
    this.box(mat, len + thick * 0.5, yTop - yBase, thick, (ax + bx) / 2, yBase, (az + bz) / 2, rot);
  }

  isEmpty(): boolean {
    return this.parts.size === 0;
  }

  materialNames(): string[] {
    return [...this.parts.keys()];
  }

  /** Merged geometry per material name. */
  merged(): Map<string, THREE.BufferGeometry> {
    const out = new Map<string, THREE.BufferGeometry>();
    for (const [name, list] of this.parts) {
      const g = mergeGeometries(list, false);
      if (g) out.set(name, g);
      for (const l of list) l.dispose();
    }
    this.parts.clear();
    return out;
  }
}
