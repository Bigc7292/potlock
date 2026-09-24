import { DRYDOCK_09, eyePosition, viewDirection, type LanceView, type PlayerView, type Snapshot, type WeaponId } from "@potlock/shared";
import { Hud } from "./hud.js";
import { World } from "./world.js";

/**
 * Dev-only art preview (`/?preview=1`): renders Drydock 09 with staged dummy players and
 * no server, so the look can be checked and screenshotted. Never shipped in production
 * builds (main.ts only imports it behind import.meta.env.DEV).
 */

interface CamPose {
  name: string;
  eye: { x: number; y: number; z: number };
  yaw: number;
  pitch: number;
}

/** Yaw that looks from a to b (yaw 0 = -Z). */
function yawTo(a: { x: number; z: number }, b: { x: number; z: number }): number {
  return Math.atan2(-(b.x - a.x), -(b.z - a.z));
}

const P = (name: string, x: number, y: number, z: number, tx: number, tz: number, pitch = -0.05): CamPose => ({
  name,
  eye: { x, y, z },
  yaw: yawTo({ x, z }, { x: tx, z: tz }),
  pitch,
});

export const POSES: CamPose[] = [
  P("lane-east", 16, 1.6, 1.5, -10, 0, -0.04),
  P("lane-west", -18, 1.6, -1, 10, 1, -0.02),
  P("shed", -20, 1.6, 12, 5, 6, 0.02),
  P("booth-top", 20, 7.6, 12, -5, -2, -0.2),
  P("hoist-top", -20, 7.6, -12, 6, 4, -0.18),
  P("dock-edge", 4, 1.6, -14.2, 22, -30, 0.08),
  P("crane", -6, 1.6, 10, 18, -38, 0.22),
  P("catwalk", -12, 4.6, 6, 6, 4, -0.1),
  P("pedestal", 5, 1.6, 4.5, 0, 0, -0.2),
  P("container-top", -8.5, 6.8, 10.2, 10, -6, -0.15),
  P("west-gable", 10, 1.6, 2, -24, 0, 0.12),
  P("east-stack", -10, 1.6, -3, 24, 4, 0.12),
];

function dummy(userId: string, x: number, z: number, yaw: number, weapon: WeaponId = "kestrel", extra: Partial<PlayerView> = {}): PlayerView {
  return {
    userId,
    x,
    y: 0,
    z,
    yaw,
    pitch: 0,
    hp: 100,
    alive: true,
    invulnerable: false,
    weapon,
    ammo: 8,
    reloading: false,
    charging: false,
    ackSeq: 0,
    vy: 0,
    grounded: true,
    ...extra,
  };
}

export function startPreview(): void {
  const world = new World(document.body);
  const params = new URLSearchParams(window.location.search);
  let pose = Number(params.get("cam") ?? 0) % POSES.length;
  let lanceState: LanceView["state"] = "pedestal";
  const players: PlayerView[] = [
    dummy("a", -4, 1.2, 1.2),
    dummy("b", 3, -2.5, -2.1),
    dummy("c", -9, 7.5, 0.4),
    dummy("d", 12, -6, -1.6, "lance"),
    dummy("e", -14, -10, 2.8),
  ];
  const seats = ["a", "b", "c", "d", "e"];
  const names = ["Harlow", "Vesna", "Okafor", "Quill", "Mireille"];
  const nameOf = (id: string): string => names[seats.indexOf(id)] ?? "You";
  world.syncAvatars(players, "me", (id) => seats.indexOf(id) + 1, nameOf);
  const hud = new Hud();
  const withHud = params.has("hud");
  const withFx = params.has("fx");
  const me: PlayerView = dummy("me", 0, 0, 0, "kestrel", { hp: 64, ammo: 5 });
  const snapshot = (now: number): Snapshot => ({
    tick: 0,
    serverTime: now,
    phase: "live",
    ante: 25,
    pot: 150,
    seats: [{ userId: "me", name: "You", seat: 0, ready: true, isHost: true, score: 2, connected: true, forfeited: false }, ...seats.map((id, i) => ({ userId: id, name: nameOf(id), seat: i + 1, ready: true, isHost: false, score: i % 3, connected: true, forfeited: false }))],
    players: [me, ...players],
    lance: { state: "held", holderId: "d" },
    autoLockAt: null,
    countdownEndsAt: null,
    liveEndsAt: now + 131000,
  });
  if (withHud) {
    hud.killFeed({ killer: "Vesna", victim: "Okafor", killerSeat: 2, victimSeat: 3, lance: false, mine: false });
    hud.killFeed({ killer: "Quill", victim: "Harlow", killerSeat: 4, victimSeat: 1, lance: true, mine: false });
    hud.killFeed({ killer: "You", victim: "Mireille", killerSeat: 0, victimSeat: 5, lance: false, mine: true });
  }
  let fxAt = 0;

  const api = {
    poses: POSES.map((p) => p.name),
    setCam: (i: number) => {
      pose = ((i % POSES.length) + POSES.length) % POSES.length;
    },
    setLance: (s: LanceView["state"]) => {
      lanceState = s;
    },
    fire: () => world.localFire(performance.now(), "kestrel"),
    stats: () => world.stats(),
    ready: false,
  };
  (window as unknown as { __preview: typeof api }).__preview = api;
  window.addEventListener("keydown", (e) => {
    if (e.code === "BracketRight") api.setCam(pose + 1);
    if (e.code === "BracketLeft") api.setCam(pose - 1);
  });

  let frames = 0;
  world.renderer.setAnimationLoop(() => {
    const now = performance.now();
    const t = now / 1000;
    for (const p of players) {
      const walk = p.userId === "a" || p.userId === "c";
      const pos = walk ? { x: p.x + Math.sin(t * 0.6) * 1.5, y: p.y, z: p.z, yaw: p.yaw } : { x: p.x, y: p.y, z: p.z, yaw: p.yaw };
      const charging = p.userId === "d" && withFx && t % 2 < 0.4;
      world.placeAvatar(p.userId, pos, p.alive, p.userId === "e" && Math.floor(t) % 3 === 0, p.weapon, charging);
      world.setTelegraph(p.userId, charging ? eyePosition(p) : null, charging ? viewDirection(p.yaw + 0.3, 0) : null);
    }
    if (withFx && now > fxAt) {
      fxAt = now + 220;
      const c0 = POSES[pose] ?? POSES[0]!;
      const a = players[Math.floor(Math.random() * 3)]!;
      const target = { x: a.x + (Math.random() - 0.5) * 6, y: 0.6 + Math.random() * 2, z: a.z + 8 * Math.sign(-a.z || 1) };
      world.shot({ from: eyePosition(a), to: target, weapon: "kestrel", hitId: null, damage: 0 }, false, now);
      if (Math.random() < 0.3) world.shot({ from: c0.eye, to: eyePosition(players[1]!), weapon: "kestrel", hitId: "b", damage: 18 }, true, now);
      if (Math.random() < 0.05) world.shot({ from: eyePosition(players[3]!), to: { x: -20, y: 1.2, z: 3 }, weapon: "lance", hitId: null, damage: 0 }, false, now);
      if (Math.random() < 0.3) world.localFire(now, "kestrel");
    }
    if (withHud) {
      hud.show(true);
      hud.update(snapshot(now), "me", me, true, null, nameOf);
    }
    const ped = DRYDOCK_09.lancePedestal;
    const lance: LanceView =
      lanceState === "pedestal" ? { state: "pedestal", position: ped } : lanceState === "held" ? { state: "held", holderId: "d" } : { state: "cooldown", availableAt: 0 };
    world.setLance(lance, t);
    const c = POSES[pose] ?? POSES[0]!;
    world.render(c.eye, c.yaw, c.pitch, "kestrel", true, now);
    if (++frames > 20) api.ready = true;
  });
}
