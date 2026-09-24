import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";

/**
 * Collects static geometry per material and merges it into one mesh per material, so a
 * whole kitbashed quay costs roughly one draw call per material. Pieces can be tinted
 * (vertex colour, linear) and get world-space UVs in metres (box projection) so shared
 * tileable textures keep a constant texel density on any size of box.
 */

export interface PieceOptions {
  /** sRGB hex tint multiplied into the material colour. */
  tint?: number;
  /** "world": box-project UVs in metres (default). "keep": keep the primitive's own UVs. */
  uv?: "world" | "keep";
  /** Brightness multiplier on the tint (emissive-like variation, dirt). */
  shade?: number;
}

const KEEP = new Set(["position", "normal", "uv"]);
const tmpColor = new THREE.Color();
const a = new THREE.Vector3();
const b = new THREE.Vector3();
const c = new THREE.Vector3();

function worldUV(g: THREE.BufferGeometry): void {
  const pos = g.getAttribute("position") as THREE.BufferAttribute;
  const uv = g.getAttribute("uv") as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i += 3) {
    a.fromBufferAttribute(pos, i);
    b.fromBufferAttribute(pos, i + 1);
    c.fromBufferAttribute(pos, i + 2);
    const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
    const ax = Math.abs(n.x);
    const ay = Math.abs(n.y);
    const az = Math.abs(n.z);
    for (let k = 0; k < 3; k++) {
      const p = k === 0 ? a : k === 1 ? b : c;
      if (ay >= ax && ay >= az) uv.setXY(i + k, p.x, p.z);
      else if (ax >= az) uv.setXY(i + k, p.z * Math.sign(n.x || 1), p.y);
      else uv.setXY(i + k, -p.x * Math.sign(n.z || 1), p.y);
    }
  }
  uv.needsUpdate = true;
}

export class StaticBatch<K extends string> {
  private readonly parts = new Map<K, THREE.BufferGeometry[]>();
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly s = new THREE.Vector3();
  private readonly p = new THREE.Vector3();
  private readonly e = new THREE.Euler();

  /** Adds a geometry (not consumed) transformed by `matrix`. */
  add(key: K, geom: THREE.BufferGeometry, matrix: THREE.Matrix4, o: PieceOptions = {}): void {
    const g = geom.index ? geom.toNonIndexed() : geom.clone();
    for (const name of Object.keys(g.attributes)) if (!KEEP.has(name)) g.deleteAttribute(name);
    g.morphAttributes = {};
    g.clearGroups();
    g.applyMatrix4(matrix);
    if (!g.getAttribute("uv")) g.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array(g.getAttribute("position").count * 2), 2));
    if (!g.getAttribute("normal")) g.computeVertexNormals();
    if ((o.uv ?? "world") === "world") worldUV(g);
    tmpColor.set(o.tint ?? 0xffffff).multiplyScalar(o.shade ?? 1);
    const n = g.getAttribute("position").count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      col[i * 3] = tmpColor.r;
      col[i * 3 + 1] = tmpColor.g;
      col[i * 3 + 2] = tmpColor.b;
    }
    g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    let list = this.parts.get(key);
    if (!list) this.parts.set(key, (list = []));
    list.push(g);
  }

  /** Axis-aligned (optionally Y-rotated) box by centre and size. */
  box(key: K, cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, o: PieceOptions & { rotY?: number; bevel?: number } = {}): void {
    const geom = o.bevel ? new RoundedBoxGeometry(sx, sy, sz, 1, o.bevel) : new THREE.BoxGeometry(sx, sy, sz);
    this.m.compose(this.p.set(cx, cy, cz), this.q.setFromEuler(this.e.set(0, o.rotY ?? 0, 0)), this.s.set(1, 1, 1));
    this.add(key, geom, this.m, o);
    geom.dispose();
  }

  /** Box between world min/max corners. */
  aabb(key: K, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, o: PieceOptions & { bevel?: number } = {}): void {
    this.box(key, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0), o);
  }

  /** A square-section beam from p0 to p1. */
  beam(key: K, p0: THREE.Vector3Tuple, p1: THREE.Vector3Tuple, w: number, o: PieceOptions = {}, h = w): void {
    const from = new THREE.Vector3(...p0);
    const to = new THREE.Vector3(...p1);
    const len = from.distanceTo(to);
    const geom = new THREE.BoxGeometry(w, h, len);
    const dir = to.clone().sub(from).normalize();
    this.q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
    this.m.compose(from.add(to).multiplyScalar(0.5), this.q, this.s.set(1, 1, 1));
    this.add(key, geom, this.m, o);
    geom.dispose();
  }

  /** Cylinder (or tube if `p1` given) along Y by default. */
  cyl(key: K, x: number, y: number, z: number, rTop: number, rBot: number, h: number, o: PieceOptions & { seg?: number; rotX?: number; rotZ?: number; rotY?: number; open?: boolean } = {}): void {
    const geom = new THREE.CylinderGeometry(rTop, rBot, h, o.seg ?? 12, 1, o.open ?? false);
    this.m.compose(this.p.set(x, y, z), this.q.setFromEuler(this.e.set(o.rotX ?? 0, o.rotY ?? 0, o.rotZ ?? 0)), this.s.set(1, 1, 1));
    this.add(key, geom, this.m, { uv: "keep", ...o });
    geom.dispose();
  }

  /** Round tube from p0 to p1 (pipes, rails, cables). */
  pipe(key: K, p0: THREE.Vector3Tuple, p1: THREE.Vector3Tuple, r: number, o: PieceOptions & { seg?: number } = {}): void {
    const from = new THREE.Vector3(...p0);
    const to = new THREE.Vector3(...p1);
    const geom = new THREE.CylinderGeometry(r, r, from.distanceTo(to), o.seg ?? 10, 1, true);
    this.q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize());
    this.m.compose(from.add(to).multiplyScalar(0.5), this.q, this.s.set(1, 1, 1));
    this.add(key, geom, this.m, { uv: "keep", ...o });
    geom.dispose();
  }

  /** Sagging cable through a catenary-ish curve. */
  cable(key: K, p0: THREE.Vector3Tuple, p1: THREE.Vector3Tuple, sag: number, r: number, o: PieceOptions = {}): void {
    const from = new THREE.Vector3(...p0);
    const to = new THREE.Vector3(...p1);
    const mid = from.clone().lerp(to, 0.5);
    mid.y -= sag;
    const curve = new THREE.QuadraticBezierCurve3(from, mid, to);
    const geom = new THREE.TubeGeometry(curve, 12, r, 5, false);
    this.add(key, geom, this.m.identity(), { uv: "keep", ...o });
    geom.dispose();
  }

  torus(key: K, x: number, y: number, z: number, r: number, tube: number, o: PieceOptions & { rotX?: number; rotY?: number; seg?: number; arc?: number } = {}): void {
    const geom = new THREE.TorusGeometry(r, tube, 6, o.seg ?? 16, o.arc ?? Math.PI * 2);
    this.m.compose(this.p.set(x, y, z), this.q.setFromEuler(this.e.set(o.rotX ?? 0, o.rotY ?? 0, 0)), this.s.set(1, 1, 1));
    this.add(key, geom, this.m, { uv: "keep", ...o });
    geom.dispose();
  }

  /** Merges everything: one mesh per key, using the supplied materials. */
  build(materials: Record<K, THREE.Material>, shadows: (key: K) => { cast: boolean; receive: boolean }): THREE.Mesh[] {
    const out: THREE.Mesh[] = [];
    for (const [key, list] of this.parts) {
      if (list.length === 0) continue;
      const merged = mergeGeometries(list, false);
      for (const g of list) g.dispose();
      if (!merged) continue;
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, materials[key]);
      const sh = shadows(key);
      mesh.castShadow = sh.cast;
      mesh.receiveShadow = sh.receive;
      mesh.matrixAutoUpdate = false;
      mesh.name = `batch:${key}`;
      out.push(mesh);
    }
    this.parts.clear();
    return out;
  }
}
