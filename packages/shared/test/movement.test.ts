import { describe, expect, it } from "vitest";
import {
  DRYDOCK_09,
  MOVEMENT,
  aabbOverlap,
  bodyAabb,
  computeEvenSplit,
  rayAabb,
  stepBody,
  viewDirection,
  type BodyState,
  type MoveIntent,
} from "../src/index.js";

const solids = DRYDOCK_09.boxes;
const idle: MoveIntent = { forward: 0, strafe: 0, yaw: 0, jump: false, walk: false };

function body(x: number, y: number, z: number): BodyState {
  return { x, y, z, vy: 0, grounded: false };
}

function run(s: BodyState, intent: MoveIntent, seconds: number): BodyState {
  for (let t = 0; t < seconds; t += 1 / 60) stepBody(s, intent, 1 / 60, solids);
  return s;
}

describe("Drydock 09 layout", () => {
  it("has six spawns clear of geometry and inside the walls", () => {
    expect(DRYDOCK_09.spawns).toHaveLength(6);
    for (const s of DRYDOCK_09.spawns) {
      const b = bodyAabb(s.position.x, s.position.y + 0.01, s.position.z);
      expect(solids.some((box) => aabbOverlap(b, box))).toBe(false);
      expect(Math.abs(s.position.x)).toBeLessThan(24);
      expect(Math.abs(s.position.z)).toBeLessThan(16);
    }
  });

  it("has three walkable layers: quay, catwalks and the power positions", () => {
    const tops = new Set(solids.filter((b) => b.kind === "catwalk" || b.kind === "tower").map((b) => b.max.y));
    expect(tops).toEqual(new Set([3, 6]));
  });
});

describe("shared movement", () => {
  it("settles on the quay floor", () => {
    const s = run(body(0, 1, -10), idle, 1);
    expect(s.y).toBeCloseTo(0, 3);
    expect(s.grounded).toBe(true);
  });

  it("runs forward at run speed and walks slower", () => {
    const run1 = run(body(0, 0, -10), { ...idle, forward: 1, yaw: Math.PI / 2 }, 1);
    // yaw pi/2 faces -X
    expect(run1.x).toBeCloseTo(-MOVEMENT.runSpeed, 0);
    const walk1 = run(body(0, 0, -10), { ...idle, forward: 1, yaw: Math.PI / 2, walk: true }, 1);
    expect(walk1.x).toBeCloseTo(-MOVEMENT.walkSpeed, 0);
  });

  it("is stopped by the perimeter wall", () => {
    const s = run(body(20, 0, -10), { ...idle, strafe: 1 }, 3);
    expect(s.x).toBeLessThanOrEqual(24 - MOVEMENT.radius + 1e-3);
  });

  it("jumps and lands", () => {
    const s = body(0, 0, -10);
    run(s, idle, 0.2);
    stepBody(s, { ...idle, jump: true }, 1 / 60, solids);
    let peak = 0;
    for (let i = 0; i < 90; i++) {
      stepBody(s, idle, 1 / 60, solids);
      peak = Math.max(peak, s.y);
    }
    expect(peak).toBeGreaterThan(1);
    expect(s.y).toBeCloseTo(0, 3);
  });

  it("climbs the west stairs onto the north catwalk", () => {
    // Stairs rise along +x from x=-21.6 at z 5..7; the catwalk top is y=3.
    const s = run(body(-22.8, 0, 6), { ...idle, strafe: 1 }, 1.4);
    expect(s.y).toBeCloseTo(3, 1);
    expect(s.x).toBeGreaterThan(-18);
  });

  it("is deterministic for the same inputs (server and client prediction agree)", () => {
    const intent = { ...idle, forward: 1, strafe: 0.4, yaw: 0.7 };
    const a = run(body(5, 0, -8), intent, 2);
    const b = run(body(5, 0, -8), intent, 2);
    expect(a).toEqual(b);
  });
});

describe("hitscan helpers", () => {
  it("ray hits a box ahead and misses one behind", () => {
    const box = { min: { x: -1, y: 0, z: -11 }, max: { x: 1, y: 2, z: -9 } };
    const dir = viewDirection(0, 0);
    expect(rayAabb({ x: 0, y: 1, z: 0 }, dir, box, 50)).toBeCloseTo(9, 5);
    expect(rayAabb({ x: 0, y: 1, z: 0 }, viewDirection(Math.PI, 0), box, 50)).toBeNull();
  });
});

describe("even split", () => {
  it("hands out the remainder one credit at a time in order", () => {
    expect(computeEvenSplit(75, ["a", "b"])).toEqual([
      { userId: "a", amount: 38 },
      { userId: "b", amount: 37 },
    ]);
    expect(computeEvenSplit(100, ["a", "b", "c"]).map((p) => p.amount)).toEqual([34, 33, 33]);
  });
});
