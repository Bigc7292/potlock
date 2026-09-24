import type { Aabb, Vec3 } from "../geometry.js";

/**
 * Drydock 09: a small original industrial quay built from boxes.
 *
 * Layers: quay floor (y=0), catwalks and the lane bridge (y=3), two power positions (y=6):
 * the Signal Booth (north-east) and the Hoist Cab (south-west).
 * The open lane is the long exposed strip along X through the middle (|z| < 4),
 * with the Auric Lance pedestal at its centre. The map is point-symmetric around the origin.
 */

export type MapBoxKind =
  | "floor"
  | "wall"
  | "container"
  | "crate"
  | "catwalk"
  | "stair"
  | "rail"
  | "tower"
  | "pillar"
  | "bollard";

export interface MapBox extends Aabb {
  kind: MapBoxKind;
}

export interface SpawnPoint {
  position: Vec3;
  yaw: number;
}

export interface ArenaMap {
  id: string;
  name: string;
  boxes: MapBox[];
  spawns: SpawnPoint[];
  lancePedestal: Vec3;
  bounds: Aabb;
}

function box(kind: MapBoxKind, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): MapBox {
  return {
    kind,
    min: { x: Math.min(x0, x1), y: Math.min(y0, y1), z: Math.min(z0, z1) },
    max: { x: Math.max(x0, x1), y: Math.max(y0, y1), z: Math.max(z0, z1) },
  };
}

/** Point mirror through the origin on the XZ plane. */
function mirror(b: MapBox): MapBox {
  return {
    kind: b.kind,
    min: { x: -b.max.x, y: b.min.y, z: -b.max.z },
    max: { x: -b.min.x, y: b.max.y, z: -b.min.z },
  };
}

/** Solid stair blocks rising along +x or -x from `x0`. Each step is 0.5 high, 0.6 deep. */
function stairs(x0: number, dirX: 1 | -1, z0: number, z1: number, baseY: number, steps: number): MapBox[] {
  const out: MapBox[] = [];
  for (let k = 0; k < steps; k++) {
    const a = x0 + dirX * 0.6 * k;
    const b = x0 + dirX * 0.6 * (k + 1);
    out.push(box("stair", a, baseY, z0, b, baseY + 0.5 * (k + 1), z1));
  }
  return out;
}

const HALF_X = 24;
const HALF_Z = 16;
const WALL_H = 10;

/** One half of the quay (north and east); the other half is its mirror. */
const half: MapBox[] = [
  // Ground cover: shipping containers and crates on the north quay.
  box("container", -12, 0, 9, -6, 2.6, 11.4),
  box("container", -11, 2.6, 9.2, -6.5, 5.2, 11.2),
  box("container", -4, 0, 11, 2, 2.6, 13.4),
  box("crate", 4, 0, 5.6, 5.2, 1.2, 6.8),
  box("crate", -8.5, 0, 5.4, -7.3, 1.2, 6.6),
  box("crate", 16, 0, 3, 17.2, 1.2, 4.2),
  box("crate", -20, 0, 6, -18.8, 1.2, 7.2),
  // Bollards along the lane edge: low cover, the lane stays exposed.
  box("bollard", -10.3, 0, 1.7, -9.7, 0.8, 2.3),
  box("bollard", 7.7, 0, 3.2, 8.3, 0.8, 3.8),
  // North catwalk (top at y=3) with a lane-side rail, a gap where the bridge meets it.
  box("catwalk", -18, 2.7, 5, 6, 3, 7),
  box("rail", -18, 3, 5, -1.5, 3.9, 5.15),
  box("rail", 1.5, 3, 5, 6, 3.9, 5.15),
  box("pillar", -14.2, 0, 6.8, -13.8, 2.7, 7),
  box("pillar", -4.2, 0, 6.8, -3.8, 2.7, 7),
  box("pillar", 3.8, 0, 6.8, 4.2, 2.7, 7),
  ...stairs(-21.6, 1, 5, 7, 0, 6),
  // Signal Booth: a power position on the north-east corner (top at y=6).
  box("tower", 14, 0, 8, 22, 6, 15),
  box("rail", 14, 6, 8, 22, 7.1, 8.2),
  box("rail", 14, 6, 10.6, 14.2, 7.1, 15),
  box("rail", 20.5, 6, 11, 21.7, 7.4, 12.2),
  ...stairs(6.8, 1, 8, 10, 0, 12),
];

/** Pieces on the axis of symmetry (not mirrored). */
const centre: MapBox[] = [
  box("floor", -HALF_X, -1, -HALF_Z, HALF_X, 0, HALF_Z),
  box("wall", -HALF_X - 1, 0, -HALF_Z - 1, HALF_X + 1, WALL_H, -HALF_Z),
  box("wall", -HALF_X - 1, 0, HALF_Z, HALF_X + 1, WALL_H, HALF_Z + 1),
  box("wall", -HALF_X - 1, 0, -HALF_Z, -HALF_X, WALL_H, HALF_Z),
  box("wall", HALF_X, 0, -HALF_Z, HALF_X + 1, WALL_H, HALF_Z),
  // Lane bridge joining the two catwalks (top at y=3).
  box("catwalk", -1.5, 2.7, -5, 1.5, 3, 5),
  box("rail", -1.5, 3, -5, -1.35, 3.9, 5),
  box("rail", 1.35, 3, -5, 1.5, 3.9, 5),
];

/** Yaw that looks from `p` towards the map centre. */
export function yawTowardsCentre(p: Vec3): number {
  return Math.atan2(p.x, p.z);
}

// The first pair faces off across the open lane; later pairs sit in the quay corners.
const spawnHalf: SpawnPoint[] = [
  { x: 10, y: 0, z: 6 },
  { x: -20, y: 0, z: 12 },
  { x: -6.5, y: 0, z: 14.5 },
].map((position) => ({ position, yaw: yawTowardsCentre(position) }));

function mirrorSpawn(s: SpawnPoint): SpawnPoint {
  const position = { x: -s.position.x, y: s.position.y, z: -s.position.z };
  return { position, yaw: yawTowardsCentre(position) };
}

export const DRYDOCK_09: ArenaMap = {
  id: "drydock_09",
  name: "Drydock 09",
  boxes: [...centre, ...half, ...half.map(mirror)],
  // Interleave so the first two spawns face each other across the map.
  spawns: spawnHalf.flatMap((s) => [s, mirrorSpawn(s)]),
  lancePedestal: { x: 0, y: 0, z: 0 },
  bounds: { min: { x: -HALF_X, y: -1, z: -HALF_Z }, max: { x: HALF_X, y: WALL_H, z: HALF_Z } },
};
