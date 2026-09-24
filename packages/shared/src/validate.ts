import { MOVEMENT } from "./constants.js";
import type { InputCommand } from "./protocol.js";

/** Runtime guards for untrusted client payloads. They return null for anything malformed. */

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function num(v: unknown, min: number, max: number): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  return Math.max(min, Math.min(max, v));
}

function bool(v: unknown): boolean | null {
  return typeof v === "boolean" ? v : null;
}

export function parseInputCommand(raw: unknown): InputCommand | null {
  if (!isRecord(raw)) return null;
  const seq = num(raw.seq, 0, Number.MAX_SAFE_INTEGER);
  const dt = num(raw.dt, 0, MOVEMENT.maxCommandDt);
  const forward = num(raw.forward, -1, 1);
  const strafe = num(raw.strafe, -1, 1);
  const yaw = num(raw.yaw, -1e6, 1e6);
  const pitch = num(raw.pitch, -Math.PI / 2 + 0.01, Math.PI / 2 - 0.01);
  const jump = bool(raw.jump);
  const walk = bool(raw.walk);
  const fire = bool(raw.fire);
  const reload = bool(raw.reload);
  const pickup = bool(raw.pickup);
  if (
    seq === null ||
    dt === null ||
    forward === null ||
    strafe === null ||
    yaw === null ||
    pitch === null ||
    jump === null ||
    walk === null ||
    fire === null ||
    reload === null ||
    pickup === null
  ) {
    return null;
  }
  return { seq: Math.floor(seq), dt, forward, strafe, yaw, pitch, jump, walk, fire, reload, pickup };
}

export function parseReady(raw: unknown): { ready: boolean } | null {
  if (!isRecord(raw)) return null;
  const ready = bool(raw.ready);
  return ready === null ? null : { ready };
}
