/** Room name for the only mode that ships in v1. */
export const MODE_GILT_ROUND = "gilt_round" as const;
export type ModeId = typeof MODE_GILT_ROUND;

/** Authoritative simulation and snapshot rate. */
export const TICK_HZ = 20;
export const TICK_MS = 1000 / TICK_HZ;

/** Pot Credits (PC): play-money integers only. */
export const CURRENCY_NAME = "Pot Credits";
export const CURRENCY_CODE = "PC";
export const STARTER_GRANT_PC = 2000;
export const ANTE_PRESETS = [25, 100, 500] as const;
export type AntePreset = (typeof ANTE_PRESETS)[number];
/** Rake is stored but never charged in v1. */
export const RAKE_BPS = 0;

export function isAntePreset(value: number): value is AntePreset {
  return (ANTE_PRESETS as readonly number[]).includes(value);
}

export const GILT_ROUND = {
  minPlayers: 2,
  maxPlayers: 6,
  scoreToWin: 3,
  matchDurationMs: 4 * 60 * 1000,
  countdownMs: 5000,
  autoLockMs: 20000,
  respawnMs: 2500,
  respawnInvulnMs: 800,
  maxHp: 100,
} as const;

export const KESTREL_SIDEARM = {
  name: "Kestrel Sidearm",
  damage: 18,
  magSize: 8,
  reloadMs: 1400,
  fireCooldownMs: 220,
  /** Full damage up to here (metres), then linear falloff. */
  falloffStart: 7.5,
  falloffEnd: 30,
  minDamageFactor: 0.6,
  range: 80,
} as const;

export const AURIC_LANCE = {
  name: "Auric Lance",
  damage: 999,
  chargeMs: 350,
  respawnMs: 25000,
  pickupRadius: 1.8,
  range: 120,
} as const;

export const MOVEMENT = {
  runSpeed: 6.5,
  walkSpeed: 3.2,
  gravity: 20,
  jumpSpeed: 7,
  stepHeight: 0.55,
  radius: 0.4,
  height: 1.8,
  eyeHeight: 1.6,
  /** Longest single integration step; larger dt is split into substeps. */
  maxSubstep: 1 / 120,
  /** Longest dt the server accepts for one input command. */
  maxCommandDt: 0.05,
} as const;
