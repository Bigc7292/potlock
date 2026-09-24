import { describe, expect, it } from "vitest";
import {
  AURIC_LANCE,
  DRYDOCK_09,
  GILT_ROUND,
  KESTREL_SIDEARM,
  MOVEMENT,
  kestrelDamage,
  type GameEvent,
  type InputCommand,
} from "@potlock/shared";
import { GameSim } from "../src/sim/GameSim.js";

/** Two players facing each other across the open lane (spawns 0 and 1). */
function setup() {
  const events: GameEvent[] = [];
  const elims: [string, string][] = [];
  const sim = new GameSim({ event: (e) => events.push(e), elimination: (k, v) => elims.push([k, v]) });
  let now = 10_000;
  sim.spawnAll(
    [
      { userId: "a", seat: 0 },
      { userId: "b", seat: 1 },
    ],
    now,
  );
  sim.start(now);
  const seq: Record<string, number> = { a: 0, b: 0 };

  function aimAt(from: string, to: string): { yaw: number; pitch: number } {
    const p = sim.getPlayer(from)!.body;
    const q = sim.getPlayer(to)!.body;
    const dx = q.x - p.x;
    const dz = q.z - p.z;
    const dy = q.y + 1.2 - (p.y + MOVEMENT.eyeHeight);
    return { yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)) };
  }

  function cmd(user: string, over: Partial<InputCommand> = {}): InputCommand {
    const p = sim.getPlayer(user)!;
    seq[user] = (seq[user] ?? 0) + 1;
    return {
      seq: seq[user] as number,
      dt: 0.05,
      forward: 0,
      strafe: 0,
      yaw: p.yaw,
      pitch: p.pitch,
      jump: false,
      walk: false,
      fire: false,
      reload: false,
      pickup: false,
      ...over,
    };
  }

  function tick(ms = 50) {
    now += ms;
    sim.update(now, ms / 1000);
  }

  function killWithKestrel(from: string, to: string) {
    for (let i = 0; i < 20 && t_alive(to); i++) {
      if (sim.getPlayer(from)!.ammo === 0) tick(KESTREL_SIDEARM.reloadMs);
      shoot(from, to);
    }
  }

  function t_alive(user: string): boolean {
    return sim.getPlayer(user)?.alive ?? false;
  }

  function shoot(from: string, to: string) {
    sim.queueInput(from, cmd(from, { ...aimAt(from, to), fire: true }));
    tick(KESTREL_SIDEARM.fireCooldownMs);
  }

  return { sim, events, elims, tick, shoot, killWithKestrel, cmd, aimAt, get now() { return now; } };
}

describe("Kestrel Sidearm", () => {
  it("hits across the open lane with falloff damage and eliminates when HP runs out", () => {
    const t = setup();
    const a = t.sim.getPlayer("a")!.body;
    const b = t.sim.getPlayer("b")!.body;
    const perShot = kestrelDamage(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z));
    const needed = Math.ceil(GILT_ROUND.maxHp / perShot);
    t.shoot("a", "b");
    expect(t.sim.getPlayer("b")?.hp).toBe(GILT_ROUND.maxHp - perShot);
    for (let i = 1; i < needed - 1; i++) t.shoot("a", "b");
    expect(t.sim.getPlayer("b")?.alive).toBe(true);
    t.shoot("a", "b");
    expect(t.sim.getPlayer("b")?.alive).toBe(false);
    expect(t.elims).toEqual([["a", "b"]]);
  });

  it("does full damage up close", () => {
    expect(kestrelDamage(3)).toBe(KESTREL_SIDEARM.damage);
    expect(kestrelDamage(100)).toBe(Math.round(KESTREL_SIDEARM.damage * KESTREL_SIDEARM.minDamageFactor));
  });

  it("damage falls off with distance but never below 60%", () => {
    const t = setup();
    const a = t.sim.getPlayer("a")!.body;
    const b = t.sim.getPlayer("b")!.body;
    const dist = Math.hypot(a.x - b.x, a.z - b.z);
    expect(dist).toBeGreaterThan(KESTREL_SIDEARM.falloffStart);
    t.shoot("a", "b");
    const shot = t.events.find((e) => e.type === "shot");
    expect(shot?.type === "shot" && shot.damage).toBeLessThanOrEqual(KESTREL_SIDEARM.damage);
    expect(shot?.type === "shot" && shot.damage).toBeGreaterThanOrEqual(Math.round(KESTREL_SIDEARM.damage * 0.6));
  });

  it("empties the 8-round mag, then reloads for 1.4s", () => {
    const t = setup();
    for (let i = 0; i < KESTREL_SIDEARM.magSize; i++) {
      t.sim.queueInput("a", t.cmd("a", { yaw: 0, pitch: 1.2, fire: true }));
      t.tick(KESTREL_SIDEARM.fireCooldownMs);
    }
    expect(t.sim.getPlayer("a")?.ammo).toBe(0);
    t.sim.queueInput("a", t.cmd("a", { fire: true }));
    t.tick(50);
    expect(t.events.filter((e) => e.type === "shot")).toHaveLength(8);
    t.tick(KESTREL_SIDEARM.reloadMs);
    expect(t.sim.getPlayer("a")?.ammo).toBe(KESTREL_SIDEARM.magSize);
  });

  it("walls stop shots", () => {
    const t = setup();
    // Aim straight into the floor-level north wall direction from a.
    t.sim.queueInput("a", t.cmd("a", { yaw: Math.PI, pitch: 0, fire: true }));
    t.tick(50);
    const shot = t.events.find((e) => e.type === "shot");
    expect(shot?.type === "shot" && shot.hitId).toBeNull();
  });
});

describe("respawn", () => {
  it("brings the victim back after 2.5s far from the killer with 0.8s of invulnerability", () => {
    const t = setup();
    t.killWithKestrel("a", "b");
    expect(t.sim.getPlayer("b")?.alive).toBe(false);
    t.tick(GILT_ROUND.respawnMs);
    const b = t.sim.getPlayer("b")!;
    expect(b.alive).toBe(true);
    expect(b.hp).toBe(100);
    const a = t.sim.getPlayer("a")!.body;
    const dists = DRYDOCK_09.spawns.map((s) => Math.hypot(s.position.x - a.x, s.position.z - a.z));
    expect(Math.hypot(b.body.x - a.x, b.body.z - a.z)).toBeCloseTo(Math.max(...dists), 3);
    expect(t.sim.snapshotPlayers(t.now).find((p) => p.userId === "b")?.invulnerable).toBe(true);
    t.tick(GILT_ROUND.respawnInvulnMs + 10);
    expect(t.sim.snapshotPlayers(t.now).find((p) => p.userId === "b")?.invulnerable).toBe(false);
  });
});

describe("Auric Lance", () => {
  function walkToPedestal(t: ReturnType<typeof setup>, user: string) {
    const ped = DRYDOCK_09.lancePedestal;
    for (let i = 0; i < 200; i++) {
      const p = t.sim.getPlayer(user)!.body;
      const dx = ped.x - p.x;
      const dz = ped.z - p.z;
      if (Math.hypot(dx, dz) < 0.5) break;
      t.sim.queueInput(user, t.cmd(user, { forward: 1, yaw: Math.atan2(-dx, -dz) }));
      t.tick(50);
    }
  }

  it("appears on the pedestal 25s into the match and is picked up with E", () => {
    const t = setup();
    expect(t.sim.lanceView().state).toBe("cooldown");
    t.tick(AURIC_LANCE.respawnMs);
    expect(t.sim.lanceView().state).toBe("pedestal");
    t.sim.queueInput("a", t.cmd("a", { pickup: true }));
    t.tick(50);
    expect(t.sim.lanceView().state).toBe("pedestal");
    walkToPedestal(t, "a");
    t.sim.queueInput("a", t.cmd("a", { pickup: true }));
    t.tick(50);
    expect(t.sim.lanceView()).toEqual({ state: "held", holderId: "a" });
    expect(t.sim.getPlayer("a")?.weapon).toBe("lance");
  });

  it("charges for 0.35s, then one beam eliminates and the lance is spent", () => {
    const t = setup();
    t.tick(AURIC_LANCE.respawnMs);
    walkToPedestal(t, "a");
    t.sim.queueInput("a", t.cmd("a", { pickup: true }));
    t.tick(50);
    t.sim.queueInput("a", t.cmd("a", { ...t.aimAt("a", "b"), fire: true }));
    t.tick(50);
    expect(t.events.some((e) => e.type === "lanceCharge")).toBe(true);
    expect(t.sim.getPlayer("b")?.alive).toBe(true);
    t.tick(AURIC_LANCE.chargeMs);
    expect(t.sim.getPlayer("b")?.alive).toBe(false);
    expect(t.elims).toEqual([["a", "b"]]);
    expect(t.sim.getPlayer("a")?.weapon).toBe("kestrel");
    expect(t.sim.lanceView().state).toBe("cooldown");
  });

  it("fires along the aim at release, so a target that moves out of it survives", () => {
    const t = setup();
    t.tick(AURIC_LANCE.respawnMs);
    walkToPedestal(t, "a");
    t.sim.queueInput("a", t.cmd("a", { pickup: true }));
    t.tick(50);
    t.sim.queueInput("a", t.cmd("a", { ...t.aimAt("a", "b"), fire: true }));
    t.tick(50);
    // b strafes hard during the telegraph; a keeps the old aim.
    for (let i = 0; i < 7; i++) {
      t.sim.queueInput("b", t.cmd("b", { strafe: 1 }));
      t.tick(50);
    }
    expect(t.sim.getPlayer("b")?.alive).toBe(true);
    expect(t.sim.lanceView().state).toBe("cooldown");
  });

  it("drops where the holder dies", () => {
    const t = setup();
    t.tick(AURIC_LANCE.respawnMs);
    walkToPedestal(t, "a");
    t.sim.queueInput("a", t.cmd("a", { pickup: true }));
    t.tick(50);
    t.killWithKestrel("b", "a");
    expect(t.sim.getPlayer("a")?.alive).toBe(false);
    expect(t.sim.lanceView().state).toBe("dropped");
  });
});

describe("authority", () => {
  it("does not move anyone during the countdown freeze", () => {
    const t = setup();
    t.sim.stop();
    const before = { ...t.sim.getPlayer("a")!.body };
    for (let i = 0; i < 10; i++) {
      t.sim.queueInput("a", t.cmd("a", { forward: 1 }));
      t.tick(50);
    }
    expect(t.sim.getPlayer("a")!.body.x).toBe(before.x);
  });

  it("caps movement to real time even if a client floods commands", () => {
    const t = setup();
    const start = { ...t.sim.getPlayer("a")!.body };
    for (let i = 0; i < 20; i++) {
      for (let j = 0; j < 10; j++) t.sim.queueInput("a", t.cmd("a", { forward: 1, yaw: Math.PI / 2 }));
      t.tick(50);
    }
    const moved = Math.hypot(t.sim.getPlayer("a")!.body.x - start.x, t.sim.getPlayer("a")!.body.z - start.z);
    // 1 second of ticks at run speed, plus the small starting budget.
    expect(moved).toBeLessThan(MOVEMENT.runSpeed * 1.3);
  });

  it("ignores replayed input sequence numbers", () => {
    const t = setup();
    const c = t.cmd("a", { forward: 1 });
    t.sim.queueInput("a", c);
    t.tick(50);
    const x = t.sim.getPlayer("a")!.body.x;
    t.sim.queueInput("a", c);
    t.tick(50);
    expect(t.sim.getPlayer("a")!.body.x).toBe(x);
  });
});
