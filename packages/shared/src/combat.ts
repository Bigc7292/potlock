import { KESTREL_SIDEARM, MOVEMENT } from "./constants.js";
import type { Aabb, Vec3 } from "./geometry.js";
import { rayAabb } from "./geometry.js";
import { bodyAabb } from "./movement.js";

export function eyePosition(p: { x: number; y: number; z: number }): Vec3 {
  return { x: p.x, y: p.y + MOVEMENT.eyeHeight, z: p.z };
}

/** Kestrel damage after mild falloff: full to falloffStart, then down to minDamageFactor at falloffEnd. */
export function kestrelDamage(distance: number): number {
  const { damage, falloffStart, falloffEnd, minDamageFactor } = KESTREL_SIDEARM;
  if (distance <= falloffStart) return damage;
  const t = Math.min(1, (distance - falloffStart) / (falloffEnd - falloffStart));
  return Math.round(damage * (1 - t * (1 - minDamageFactor)));
}

/** Distance to the first piece of level geometry along the ray, or maxDist if none. */
export function firstMapHit(origin: Vec3, dir: Vec3, maxDist: number, solids: readonly Aabb[]): number {
  let best = maxDist;
  for (const box of solids) {
    const t = rayAabb(origin, dir, box, best);
    if (t !== null && t < best) best = t;
  }
  return best;
}

/** Ray against a standing player's hitbox. */
export function rayPlayer(origin: Vec3, dir: Vec3, p: { x: number; y: number; z: number }, maxDist: number): number | null {
  return rayAabb(origin, dir, bodyAabb(p.x, p.y, p.z), maxDist);
}
