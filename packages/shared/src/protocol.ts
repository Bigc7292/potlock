import type { Vec3 } from "./geometry.js";

/** Table and match phases, in order. */
export type Phase = "waiting" | "locked" | "countdown" | "live" | "ended";

export type WeaponId = "kestrel" | "lance";

// ---------- Room join ----------

/** Options passed to `client.create/join("gilt_round", ...)`. */
export interface JoinOptions {
  /** Signed match token minted by apps/web. The room never trusts a raw user id. */
  token: string;
  /** Only read on create. Must be one of ANTE_PRESETS. */
  ante?: number;
}

/** Metadata published for the lobby list (Colyseus room listing). */
export interface TableMetadata {
  ante: number;
  phase: Phase;
  hostName: string;
  seated: number;
  maxSeats: number;
}

export interface TableListing extends TableMetadata {
  roomId: string;
  locked: boolean;
}

// ---------- Client -> server ----------

/** One frame of player input. Sent at display rate; the server validates and integrates it. */
export interface InputCommand {
  seq: number;
  /** Seconds covered by this command (clamped by the server). */
  dt: number;
  forward: number;
  strafe: number;
  yaw: number;
  pitch: number;
  jump: boolean;
  walk: boolean;
  /** Trigger pressed this frame (edge). */
  fire: boolean;
  reload: boolean;
  pickup: boolean;
}

export interface ClientMessages {
  ready: { ready: boolean };
  lock: Record<string, never>;
  input: InputCommand;
}
export type ClientMessageType = keyof ClientMessages;

// ---------- Server -> client ----------

export interface SeatView {
  userId: string;
  name: string;
  seat: number;
  ready: boolean;
  isHost: boolean;
  /** False once the player disconnects after the pot locked (forfeit). */
  connected: boolean;
  forfeited: boolean;
  score: number;
}

export interface PlayerView {
  userId: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  hp: number;
  alive: boolean;
  invulnerable: boolean;
  weapon: WeaponId;
  ammo: number;
  reloading: boolean;
  charging: boolean;
  /** Last input seq the server applied for this player (for client reconciliation). */
  ackSeq: number;
  vy: number;
  grounded: boolean;
}

export type LanceView =
  | { state: "cooldown"; availableAt: number }
  | { state: "pedestal"; position: Vec3 }
  | { state: "held"; holderId: string }
  | { state: "dropped"; position: Vec3 };

export interface Snapshot {
  tick: number;
  serverTime: number;
  phase: Phase;
  ante: number;
  pot: number;
  seats: SeatView[];
  players: PlayerView[];
  lance: LanceView;
  /** Epoch ms for the current phase timer, or null. */
  autoLockAt: number | null;
  countdownEndsAt: number | null;
  liveEndsAt: number | null;
}

export type EndReason = "score" | "timeout" | "forfeit" | "abandoned";

export interface MatchResult {
  matchId: string;
  reason: EndReason;
  potTotal: number;
  winnerIds: string[];
  payouts: { userId: string; name: string; amount: number }[];
  standings: { userId: string; name: string; score: number; forfeited: boolean }[];
}

export type GameEvent =
  | { type: "shot"; shooterId: string; weapon: WeaponId; from: Vec3; to: Vec3; hitId: string | null; damage: number }
  | { type: "lanceCharge"; holderId: string }
  | { type: "lancePickup"; holderId: string }
  | { type: "elim"; killerId: string; victimId: string; weapon: WeaponId }
  | { type: "respawn"; userId: string }
  | { type: "lockFailed"; message: string }
  | { type: "potLocked"; pot: number; ante: number; matchId: string }
  | { type: "notice"; text: string }
  | { type: "result"; result: MatchResult };

export interface Welcome {
  userId: string;
  name: string;
  roomId: string;
}

export interface ServerMessages {
  welcome: Welcome;
  snap: Snapshot;
  event: GameEvent;
}
export type ServerMessageType = keyof ServerMessages;

// ---------- Match token ----------

export interface MatchTokenClaims {
  sub: string;
  name: string;
}
