export type Vec3 = { x: number; y: number; z: number };

export interface Aabb {
  min: Vec3;
  max: Vec3;
}

export function vec3(x: number, y: number, z: number): Vec3 {
  return { x, y, z };
}

export function distance(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

export function distanceXZ(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

/** Unit view direction. Yaw 0 looks down -Z (Three.js camera default); pitch up is positive. */
export function viewDirection(yaw: number, pitch: number): Vec3 {
  const cp = Math.cos(pitch);
  return { x: -Math.sin(yaw) * cp, y: Math.sin(pitch), z: -Math.cos(yaw) * cp };
}

/** Slab test. Returns the entry distance along `dir` (0 if the origin is inside), or null. */
export function rayAabb(origin: Vec3, dir: Vec3, box: Aabb, maxDist: number): number | null {
  let tMin = 0;
  let tMax = maxDist;
  const axes = ["x", "y", "z"] as const;
  for (const axis of axes) {
    const o = origin[axis];
    const d = dir[axis];
    const lo = box.min[axis];
    const hi = box.max[axis];
    if (Math.abs(d) < 1e-9) {
      if (o < lo || o > hi) return null;
      continue;
    }
    let t1 = (lo - o) / d;
    let t2 = (hi - o) / d;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tMin = Math.max(tMin, t1);
    tMax = Math.min(tMax, t2);
    if (tMin > tMax) return null;
  }
  return tMin;
}

export function aabbOverlap(a: Aabb, b: Aabb): boolean {
  return (
    a.min.x < b.max.x &&
    a.max.x > b.min.x &&
    a.min.y < b.max.y &&
    a.max.y > b.min.y &&
    a.min.z < b.max.z &&
    a.max.z > b.min.z
  );
}
