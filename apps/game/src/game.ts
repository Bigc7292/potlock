import {
  DRYDOCK_09,
  MOVEMENT,
  eyePosition,
  stepBody,
  viewDirection,
  type BodyState,
  type GameEvent,
  type InputCommand,
  type PlayerView,
  type Snapshot,
} from "@potlock/shared";
import { Hud } from "./hud.js";
import { InputController, type IntentOverride } from "./input.js";
import type { Connection } from "./net.js";
import { World } from "./world.js";

const INTERP_DELAY_MS = 100;
const MAX_CMD_DT = MOVEMENT.maxCommandDt;

interface TimedSnapshot {
  s: Snapshot;
  at: number;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpAngle(a: number, b: number, t: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

/**
 * Client match loop: samples input, predicts the local player with the shared movement code,
 * reconciles against authoritative snapshots, interpolates everyone else, and renders.
 * It never decides hits, scores or money; it only sends InputCommands.
 */
export class GameClient {
  readonly world: World;
  readonly hud = new Hud();
  readonly input: InputController;
  private readonly buffer: TimedSnapshot[] = [];
  private latest: Snapshot | null = null;
  private body: BodyState | null = null;
  private pending: InputCommand[] = [];
  private seq = 0;
  private offset = { x: 0, y: 0, z: 0 };
  private lastFrame = performance.now();
  private lastPhase: Snapshot["phase"] | null = null;
  private deadSince: number | null = null;

  constructor(
    private readonly conn: Connection,
    private readonly me: string,
    world: World,
  ) {
    this.world = world;
    this.input = new InputController(this.world.canvas);
    conn.onSnapshot((s) => this.onSnapshot(s));
    conn.onEvent((e) => this.onEvent(e));
    this.world.renderer.setAnimationLoop(() => this.frame());
  }

  private seatOf = (id: string): number => this.latest?.seats.find((s) => s.userId === id)?.seat ?? 0;
  private nameOf = (id: string): string => this.latest?.seats.find((s) => s.userId === id)?.name ?? "player";

  private myView(s: Snapshot | null = this.latest): PlayerView | undefined {
    return s?.players.find((p) => p.userId === this.me);
  }

  private onSnapshot(s: Snapshot): void {
    this.latest = s;
    this.buffer.push({ s, at: performance.now() });
    while (this.buffer.length > 40) this.buffer.shift();

    if (s.phase !== this.lastPhase) {
      if (s.phase === "countdown") {
        const mine = this.myView(s);
        if (mine) this.input.setView(mine.yaw, 0);
      }
      if (s.phase === "ended" && document.pointerLockElement) void document.exitPointerLock();
      this.lastPhase = s.phase;
    }

    const mine = this.myView(s);
    if (!mine) {
      this.body = null;
      return;
    }
    const prev = this.body ? { x: this.body.x, y: this.body.y, z: this.body.z } : null;
    const body: BodyState = { x: mine.x, y: mine.y, z: mine.z, vy: mine.vy, grounded: mine.grounded };
    this.pending = this.pending.filter((c) => c.seq > mine.ackSeq);
    if (s.phase === "live" && mine.alive) {
      for (const c of this.pending) stepBody(body, c, c.dt, DRYDOCK_09.boxes);
    }
    if (prev) {
      const dx = prev.x - body.x;
      const dy = prev.y - body.y;
      const dz = prev.z - body.z;
      if (Math.hypot(dx, dy, dz) < 2) {
        this.offset.x += dx;
        this.offset.y += dy;
        this.offset.z += dz;
      } else {
        this.offset = { x: 0, y: 0, z: 0 };
      }
    }
    this.body = body;
    this.deadSince = mine.alive ? null : (this.deadSince ?? performance.now());
  }

  private onEvent(e: GameEvent): void {
    const now = performance.now();
    if (e.type === "shot") {
      this.world.shot(e, e.shooterId === this.me, now);
      if (e.shooterId === this.me && e.hitId && e.damage > 0) this.hud.hit(e.weapon === "lance");
      if (e.hitId === this.me && e.damage > 0) {
        this.hud.hurt(this.bearingTo(e.from));
        this.world.hurt(now);
      }
    } else if (e.type === "elim") {
      const victim = this.latest?.players.find((p) => p.userId === e.victimId);
      const at = e.victimId === this.me && this.body ? this.body : victim ? { x: victim.x, y: victim.y, z: victim.z } : null;
      this.world.elimination(at, e.weapon, e.killerId === this.me || e.victimId === this.me, now);
      this.hud.killFeed({
        killer: this.nameOf(e.killerId),
        victim: this.nameOf(e.victimId),
        killerSeat: this.seatOf(e.killerId),
        victimSeat: this.seatOf(e.victimId),
        lance: e.weapon === "lance",
        mine: e.killerId === this.me || e.victimId === this.me,
      });
    } else if (e.type === "lancePickup") {
      this.hud.notice(`${this.nameOf(e.holderId)} took the Auric Lance`, true);
    } else if (e.type === "notice") {
      this.hud.notice(e.text, false);
    }
  }

  /** Screen bearing (radians, 0 = ahead, positive = to the right) from the local player to a point. */
  private bearingTo(p: { x: number; z: number }): number | null {
    if (!this.body) return null;
    const dx = p.x - this.body.x;
    const dz = p.z - this.body.z;
    const yaw = this.input.yaw;
    const fwd = -Math.sin(yaw) * dx - Math.cos(yaw) * dz;
    const right = Math.cos(yaw) * dx - Math.sin(yaw) * dz;
    return Math.atan2(right, fwd);
  }

  private frame(): void {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    const s = this.latest;
    const mine = this.myView();
    const playing = s !== null && (s.phase === "countdown" || s.phase === "live") && mine !== undefined;

    if (playing && s && mine) this.sendInput(dt, s.phase === "live" && mine.alive, mine);

    // Decay reconciliation error smoothly instead of snapping the camera.
    const decay = Math.exp(-dt * 12);
    this.offset.x *= decay;
    this.offset.y *= decay;
    this.offset.z *= decay;

    this.renderRemotes(now);
    if (s) this.world.setLance(s.lance, now / 1000);

    if (playing && this.body && mine) {
      const eye = eyePosition({ x: this.body.x + this.offset.x, y: this.body.y + this.offset.y, z: this.body.z + this.offset.z });
      this.world.render(eye, this.input.yaw, this.input.pitch, mine.weapon, mine.alive, now, {
        reloading: mine.reloading,
        charging: mine.charging,
        grounded: this.body.grounded,
        vy: this.body.vy,
      });
      const respawnIn = mine.alive || this.deadSince === null ? null : Math.max(0, 2500 - (now - this.deadSince));
      if (s) this.hud.update(s, this.me, mine, this.input.locked, respawnIn, this.nameOf);
      this.hud.show(s?.phase === "live");
    } else {
      // Waiting at the table: slow orbit over Drydock 09.
      const t = now / 12000;
      this.world.render({ x: Math.sin(t) * 30, y: 18, z: Math.cos(t) * 22 }, t + Math.PI, -0.55, "kestrel", false, now);
      this.hud.show(false);
    }
  }

  private sendInput(dt: number, canMove: boolean, mine: PlayerView): void {
    const intent = this.input.sample();
    let remaining = dt;
    let first = true;
    while (remaining > 1e-4) {
      const chunk = Math.min(MAX_CMD_DT, remaining);
      remaining -= chunk;
      const cmd: InputCommand = {
        seq: ++this.seq,
        dt: chunk,
        forward: intent.forward,
        strafe: intent.strafe,
        yaw: intent.yaw,
        pitch: intent.pitch,
        jump: intent.jump && first,
        walk: intent.walk,
        fire: intent.fire && first,
        reload: intent.reload && first,
        pickup: intent.pickup && first,
      };
      first = false;
      if (canMove && this.body) stepBody(this.body, cmd, chunk, DRYDOCK_09.boxes);
      this.pending.push(cmd);
      this.conn.send("input", cmd);
    }
    if (this.pending.length > 240) this.pending.splice(0, this.pending.length - 240);
    // Kestrel kicks on press; the Lance kicks when its beam event arrives after the charge.
    if (intent.fire && canMove && !mine.reloading && mine.weapon === "kestrel" && mine.ammo > 0) {
      this.world.localFire(performance.now(), mine.weapon);
    }
  }

  private renderRemotes(now: number): void {
    const s = this.latest;
    if (!s) return;
    this.world.syncAvatars(s.players, this.me, this.seatOf, this.nameOf);
    const renderAt = now - INTERP_DELAY_MS;
    let a: TimedSnapshot | undefined;
    let b: TimedSnapshot | undefined;
    for (let i = this.buffer.length - 1; i > 0; i--) {
      const hi = this.buffer[i];
      const lo = this.buffer[i - 1];
      if (hi && lo && lo.at <= renderAt && hi.at >= renderAt) {
        a = lo;
        b = hi;
        break;
      }
    }
    const t = a && b ? (renderAt - a.at) / Math.max(1, b.at - a.at) : 1;
    for (const p of s.players) {
      if (p.userId === this.me) {
        const eye = this.body ? eyePosition(this.body) : null;
        this.world.setTelegraph(p.userId, p.charging ? eye : null, p.charging ? viewDirection(this.input.yaw, this.input.pitch) : null);
        continue;
      }
      const pa = a?.s.players.find((x) => x.userId === p.userId);
      const pb = b?.s.players.find((x) => x.userId === p.userId);
      const pos =
        pa && pb && pa.alive && pb.alive
          ? { x: lerp(pa.x, pb.x, t), y: lerp(pa.y, pb.y, t), z: lerp(pa.z, pb.z, t), yaw: lerpAngle(pa.yaw, pb.yaw, t) }
          : { x: p.x, y: p.y, z: p.z, yaw: p.yaw };
      const view = pb ?? p;
      this.world.placeAvatar(p.userId, pos, view.alive, view.invulnerable, view.weapon, p.charging);
      const eye = eyePosition(pos);
      this.world.setTelegraph(p.userId, p.charging ? eye : null, p.charging ? viewDirection(p.yaw, p.pitch) : null);
    }
  }

  /** Dev-only automation surface used by the two-browser e2e check. Input still flows through commands. */
  debugApi(): {
    me: string;
    snapshot: () => Snapshot | null;
    position: () => { x: number; y: number; z: number } | null;
    setOverride: (o: IntentOverride | null) => void;
    pulse: (kind: "fire" | "pickup") => void;
  } {
    return {
      me: this.me,
      snapshot: () => this.latest,
      position: () => (this.body ? { x: this.body.x, y: this.body.y, z: this.body.z } : null),
      setOverride: (o) => {
        this.input.override = o;
      },
      pulse: (kind) => this.input.pulse(kind),
    };
  }
}
