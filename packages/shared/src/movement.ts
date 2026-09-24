import { MOVEMENT } from "./constants.js";
import type { Aabb } from "./geometry.js";
import { aabbOverlap } from "./geometry.js";

/**
 * Shared, deterministic character movement. The match server runs it authoritatively;
 * the game client runs the same code to predict its own player between snapshots.
 */
export interface BodyState {
  x: number;
  y: number;
  z: number;
  vy: number;
  grounded: boolean;
}

export interface MoveIntent {
  /** -1..1, positive is forward. */
  forward: number;
  /** -1..1, positive is right. */
  strafe: number;
  yaw: number;
  jump: boolean;
  walk: boolean;
}

export const NO_MOVE: MoveIntent = { forward: 0, strafe: 0, yaw: 0, jump: false, walk: false };

export function bodyAabb(x: number, y: number, z: number): Aabb {
  const r = MOVEMENT.radius;
  return { min: { x: x - r, y, z: z - r }, max: { x: x + r, y: y + MOVEMENT.height, z: z + r } };
}

function collides(x: number, y: number, z: number, solids: readonly Aabb[]): Aabb | null {
  const me = bodyAabb(x, y, z);
  for (const s of solids) {
    if (aabbOverlap(me, s)) return s;
  }
  return null;
}

function clampUnit(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(-1, Math.min(1, v));
}

function moveHorizontal(s: BodyState, axis: "x" | "z", delta: number, solids: readonly Aabb[]): void {
  if (delta === 0) return;
  const nx = axis === "x" ? s.x + delta : s.x;
  const nz = axis === "z" ? s.z + delta : s.z;
  const hit = collides(nx, s.y, nz, solids);
  if (!hit) {
    s.x = nx;
    s.z = nz;
    return;
  }
  // Step up low obstacles (stairs, kerbs) while on the ground.
  const rise = hit.max.y - s.y;
  if (s.grounded && rise > 0 && rise <= MOVEMENT.stepHeight + 1e-6 && !collides(nx, hit.max.y + 1e-4, nz, solids)) {
    s.x = nx;
    s.z = nz;
    s.y = hit.max.y + 1e-4;
  }
  // Otherwise the move on this axis is blocked; slide on the other axis.
}

function moveVertical(s: BodyState, delta: number, solids: readonly Aabb[]): void {
  const ny = s.y + delta;
  const hit = collides(s.x, ny, s.z, solids);
  if (!hit) {
    s.y = ny;
    s.grounded = false;
    return;
  }
  if (delta < 0) {
    s.y = hit.max.y;
    s.grounded = true;
  } else {
    s.y = hit.min.y - MOVEMENT.height - 1e-4;
  }
  s.vy = 0;
}

function substep(s: BodyState, intent: MoveIntent, dt: number, solids: readonly Aabb[]): void {
  let f = clampUnit(intent.forward);
  let r = clampUnit(intent.strafe);
  const len = Math.hypot(f, r);
  if (len > 1) {
    f /= len;
    r /= len;
  }
  const speed = intent.walk ? MOVEMENT.walkSpeed : MOVEMENT.runSpeed;
  const sin = Math.sin(intent.yaw);
  const cos = Math.cos(intent.yaw);
  // Forward is (-sin, -cos), right is (cos, -sin) on XZ.
  const vx = (-sin * f + cos * r) * speed;
  const vz = (-cos * f - sin * r) * speed;

  if (intent.jump && s.grounded) {
    s.vy = MOVEMENT.jumpSpeed;
    s.grounded = false;
  }
  s.vy -= MOVEMENT.gravity * dt;

  moveHorizontal(s, "x", vx * dt, solids);
  moveHorizontal(s, "z", vz * dt, solids);
  moveVertical(s, s.vy * dt, solids);
}

/** Advance a body by `dt` seconds. Mutates and returns `s`. */
export function stepBody(s: BodyState, intent: MoveIntent, dt: number, solids: readonly Aabb[]): BodyState {
  if (!(dt > 0)) return s;
  const steps = Math.max(1, Math.ceil(dt / MOVEMENT.maxSubstep - 1e-9));
  const h = dt / steps;
  for (let i = 0; i < steps; i++) {
    // Jump is an edge: only the first substep may start one.
    substep(s, i === 0 ? intent : { ...intent, jump: false }, h, solids);
  }
  return s;
}
