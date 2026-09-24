import {
  AURIC_LANCE,
  DRYDOCK_09,
  GILT_ROUND,
  KESTREL_SIDEARM,
  MOVEMENT,
  NO_MOVE,
  distance,
  eyePosition,
  firstMapHit,
  kestrelDamage,
  rayPlayer,
  stepBody,
  viewDirection,
  type ArenaMap,
  type BodyState,
  type GameEvent,
  type InputCommand,
  type LanceView,
  type PlayerView,
  type Vec3,
  type WeaponId,
} from "@potlock/shared";

interface SimPlayer {
  userId: string;
  seat: number;
  body: BodyState;
  yaw: number;
  pitch: number;
  hp: number;
  alive: boolean;
  respawnAt: number;
  invulnUntil: number;
  weapon: WeaponId;
  ammo: number;
  reloadUntil: number;
  nextFireAt: number;
  /** Auric Lance charge release time, or 0. */
  chargeUntil: number;
  queue: InputCommand[];
  ackSeq: number;
  /** Seconds of movement this player may still consume (anti speed-hack budget). */
  budget: number;
  lastInputAt: number;
}

type LanceState =
  | { state: "cooldown"; availableAt: number }
  | { state: "pedestal" }
  | { state: "held"; holderId: string }
  | { state: "dropped"; position: Vec3 };

export interface SimHooks {
  event(e: GameEvent): void;
  elimination(killerId: string, victimId: string): void;
}

const MAX_QUEUE = 30;
const MAX_BUDGET_S = 0.25;
/** If a client stops sending input (hidden tab), the server keeps gravity running for it. */
const IDLE_AFTER_MS = 250;

/**
 * Authoritative Gilt Round combat for one room: movement, Kestrel Sidearm hitscan,
 * Auric Lance pickup/charge/beam, damage, respawns. Pure logic with an injected clock,
 * stepped by the room at 20 Hz. Clients only ever supply InputCommands.
 */
export class GameSim {
  readonly map: ArenaMap;
  private readonly players = new Map<string, SimPlayer>();
  private lance: LanceState = { state: "cooldown", availableAt: Number.POSITIVE_INFINITY };
  /** True during the countdown freeze and after the match ends. */
  frozen = true;

  constructor(
    private readonly hooks: SimHooks,
    map: ArenaMap = DRYDOCK_09,
  ) {
    this.map = map;
  }

  get playerIds(): string[] {
    return [...this.players.keys()];
  }

  getPlayer(userId: string): Readonly<SimPlayer> | undefined {
    return this.players.get(userId);
  }

  /** Place every participant on a spawn (by seat) for the countdown freeze. */
  spawnAll(participants: { userId: string; seat: number }[], now: number): void {
    this.players.clear();
    const spawns = this.map.spawns;
    participants.forEach((p, i) => {
      const spawn = spawns[i % spawns.length] ?? spawns[0];
      if (!spawn) return;
      this.players.set(p.userId, {
        userId: p.userId,
        seat: p.seat,
        body: { x: spawn.position.x, y: spawn.position.y, z: spawn.position.z, vy: 0, grounded: true },
        yaw: spawn.yaw,
        pitch: 0,
        hp: GILT_ROUND.maxHp,
        alive: true,
        respawnAt: 0,
        invulnUntil: 0,
        weapon: "kestrel",
        ammo: KESTREL_SIDEARM.magSize,
        reloadUntil: 0,
        nextFireAt: 0,
        chargeUntil: 0,
        queue: [],
        ackSeq: 0,
        budget: 0,
        lastInputAt: now,
      });
    });
  }

  /** Match goes live: unfreeze and schedule the first Auric Lance. */
  start(now: number): void {
    this.frozen = false;
    this.lance = { state: "cooldown", availableAt: now + AURIC_LANCE.respawnMs };
  }

  stop(): void {
    this.frozen = true;
  }

  /** A forfeiting player leaves the arena; a held lance drops where they stood. */
  remove(userId: string): void {
    const p = this.players.get(userId);
    if (!p) return;
    if (this.lance.state === "held" && this.lance.holderId === userId) {
      this.lance = { state: "dropped", position: { x: p.body.x, y: p.body.y, z: p.body.z } };
    }
    this.players.delete(userId);
  }

  queueInput(userId: string, cmd: InputCommand): void {
    const p = this.players.get(userId);
    if (!p || cmd.seq <= p.ackSeq) return;
    if (p.queue.length >= MAX_QUEUE) p.queue.shift();
    p.queue.push(cmd);
  }

  update(now: number, dtSeconds: number): void {
    for (const p of this.players.values()) this.processInputs(p, now, dtSeconds);
    for (const p of this.players.values()) this.updateTimers(p, now);
    this.updateLance(now);
  }

  snapshotPlayers(now: number): PlayerView[] {
    return [...this.players.values()].map((p) => ({
      userId: p.userId,
      x: round(p.body.x),
      y: round(p.body.y),
      z: round(p.body.z),
      vy: round(p.body.vy),
      grounded: p.body.grounded,
      yaw: round(p.yaw),
      pitch: round(p.pitch),
      hp: p.hp,
      alive: p.alive,
      invulnerable: now < p.invulnUntil,
      weapon: p.weapon,
      ammo: p.ammo,
      reloading: p.reloadUntil > now,
      charging: p.chargeUntil > 0,
      ackSeq: p.ackSeq,
    }));
  }

  lanceView(): LanceView {
    const l = this.lance;
    if (l.state === "pedestal") return { state: "pedestal", position: this.map.lancePedestal };
    return l;
  }

  // ---------- internals ----------

  private processInputs(p: SimPlayer, now: number, dt: number): void {
    p.budget = Math.min(MAX_BUDGET_S, p.budget + dt);
    const cmds = p.queue.splice(0, p.queue.length);
    if (cmds.length > 0) p.lastInputAt = now;
    for (const cmd of cmds) {
      p.ackSeq = cmd.seq;
      p.yaw = cmd.yaw;
      p.pitch = cmd.pitch;
      if (this.frozen || !p.alive) continue;
      const step = Math.min(cmd.dt, MOVEMENT.maxCommandDt, p.budget);
      p.budget -= step;
      stepBody(p.body, cmd, step, this.map.boxes);
      if (cmd.reload) this.startReload(p, now);
      if (cmd.pickup) this.tryPickup(p);
      if (cmd.fire) this.tryFire(p, now);
    }
    // Hidden tab or stalled client: keep physics honest so nobody hangs in mid-air.
    if (!this.frozen && p.alive && cmds.length === 0 && now - p.lastInputAt > IDLE_AFTER_MS) {
      stepBody(p.body, { ...NO_MOVE, yaw: p.yaw }, dt, this.map.boxes);
    }
  }

  private updateTimers(p: SimPlayer, now: number): void {
    if (p.reloadUntil > 0 && now >= p.reloadUntil) {
      p.reloadUntil = 0;
      p.ammo = KESTREL_SIDEARM.magSize;
    }
    if (p.alive && p.chargeUntil > 0 && now >= p.chargeUntil) {
      p.chargeUntil = 0;
      this.fireLance(p, now);
    }
    if (p.alive && p.body.y < -10) this.kill(p, null, "kestrel", now);
    if (!p.alive && !this.frozen && now >= p.respawnAt) this.respawn(p, now);
  }

  private updateLance(now: number): void {
    if (this.frozen) return;
    if (this.lance.state === "cooldown" && now >= this.lance.availableAt) {
      this.lance = { state: "pedestal" };
      this.hooks.event({ type: "notice", text: "The Auric Lance is on the pedestal." });
    }
  }

  private startReload(p: SimPlayer, now: number): void {
    if (p.weapon !== "kestrel" || p.reloadUntil > 0 || p.ammo >= KESTREL_SIDEARM.magSize) return;
    p.reloadUntil = now + KESTREL_SIDEARM.reloadMs;
  }

  private tryPickup(p: SimPlayer): void {
    const l = this.lance;
    const at = l.state === "pedestal" ? this.map.lancePedestal : l.state === "dropped" ? l.position : null;
    if (!at || p.weapon === "lance") return;
    const dx = p.body.x - at.x;
    const dz = p.body.z - at.z;
    if (Math.hypot(dx, dz) > AURIC_LANCE.pickupRadius || Math.abs(p.body.y - at.y) > 2) return;
    this.lance = { state: "held", holderId: p.userId };
    p.weapon = "lance";
    p.reloadUntil = 0;
    this.hooks.event({ type: "lancePickup", holderId: p.userId });
  }

  private tryFire(p: SimPlayer, now: number): void {
    if (now < p.nextFireAt) return;
    if (p.weapon === "lance") {
      if (p.chargeUntil > 0) return;
      p.chargeUntil = now + AURIC_LANCE.chargeMs;
      p.nextFireAt = p.chargeUntil;
      this.hooks.event({ type: "lanceCharge", holderId: p.userId });
      return;
    }
    if (p.reloadUntil > 0) return;
    if (p.ammo <= 0) {
      this.startReload(p, now);
      return;
    }
    p.ammo -= 1;
    p.nextFireAt = now + KESTREL_SIDEARM.fireCooldownMs;
    this.hitscan(p, "kestrel", KESTREL_SIDEARM.range, now);
    if (p.ammo === 0) this.startReload(p, now);
  }

  /** The beam fires along the holder's aim at release time, so a strafing target can dodge it. */
  private fireLance(p: SimPlayer, now: number): void {
    this.hitscan(p, "lance", AURIC_LANCE.range, now);
    p.weapon = "kestrel";
    this.lance = { state: "cooldown", availableAt: now + AURIC_LANCE.respawnMs };
  }

  private hitscan(shooter: SimPlayer, weapon: WeaponId, range: number, now: number): void {
    const from = eyePosition(shooter.body);
    const dir = viewDirection(shooter.yaw, shooter.pitch);
    let best = firstMapHit(from, dir, range, this.map.boxes);
    let target: SimPlayer | null = null;
    for (const other of this.players.values()) {
      if (other === shooter || !other.alive) continue;
      const t = rayPlayer(from, dir, other.body, best);
      if (t !== null && t < best) {
        best = t;
        target = other;
      }
    }
    const to = { x: from.x + dir.x * best, y: from.y + dir.y * best, z: from.z + dir.z * best };
    let damage = 0;
    if (target && now >= target.invulnUntil) {
      damage = weapon === "lance" ? AURIC_LANCE.damage : kestrelDamage(best);
    }
    this.hooks.event({
      type: "shot",
      shooterId: shooter.userId,
      weapon,
      from: roundVec(from),
      to: roundVec(to),
      hitId: target?.userId ?? null,
      damage,
    });
    if (target && damage > 0) {
      target.hp = Math.max(0, target.hp - damage);
      if (target.hp === 0) this.kill(target, shooter, weapon, now);
    }
  }

  private kill(victim: SimPlayer, killer: SimPlayer | null, weapon: WeaponId, now: number): void {
    victim.alive = false;
    victim.hp = 0;
    victim.respawnAt = now + GILT_ROUND.respawnMs;
    victim.chargeUntil = 0;
    victim.reloadUntil = 0;
    if (this.lance.state === "held" && this.lance.holderId === victim.userId) {
      this.lance = { state: "dropped", position: { x: victim.body.x, y: victim.body.y, z: victim.body.z } };
    }
    victim.weapon = "kestrel";
    if (killer) {
      this.hooks.event({ type: "elim", killerId: killer.userId, victimId: victim.userId, weapon });
      this.hooks.elimination(killer.userId, victim.userId);
    }
  }

  private respawn(p: SimPlayer, now: number): void {
    // Far from whoever is alive (the killer is usually the closest threat).
    const threats = [...this.players.values()].filter((o) => o !== p && o.alive).map((o) => o.body);
    let best = this.map.spawns[0];
    let bestScore = -1;
    for (const s of this.map.spawns) {
      const score = threats.length === 0 ? 0 : Math.min(...threats.map((t) => distance(t, s.position)));
      if (score > bestScore) {
        bestScore = score;
        best = s;
      }
    }
    if (!best) return;
    p.body = { x: best.position.x, y: best.position.y, z: best.position.z, vy: 0, grounded: true };
    p.yaw = best.yaw;
    p.pitch = 0;
    p.hp = GILT_ROUND.maxHp;
    p.alive = true;
    p.invulnUntil = now + GILT_ROUND.respawnInvulnMs;
    p.ammo = KESTREL_SIDEARM.magSize;
    p.weapon = "kestrel";
    p.nextFireAt = 0;
    this.hooks.event({ type: "respawn", userId: p.userId });
  }
}

function round(v: number): number {
  return Math.round(v * 1000) / 1000;
}

function roundVec(v: Vec3): Vec3 {
  return { x: round(v.x), y: round(v.y), z: round(v.z) };
}
