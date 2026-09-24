/**
 * EscrowPort is the only way a match moves money.
 *
 * v1 is backed by the Postgres double-entry ledger (packages/db). A chain adapter can
 * implement the same four methods later without touching the room tick.
 */
export interface Payout {
  userId: string;
  amount: number;
}

export type EscrowError =
  | { code: "INSUFFICIENT_FUNDS"; userIds: string[] }
  | { code: "UNKNOWN_PLAYER"; userIds: string[] }
  | { code: "INVALID_REQUEST"; message: string }
  | { code: "POT_NOT_HELD"; matchId: string }
  | { code: "INTERNAL"; message: string };

export type EscrowResult<T> = { ok: true; value: T } | { ok: false; error: EscrowError };

export interface HoldReceipt {
  matchId: string;
  ante: number;
  potTotal: number;
}

export interface SettleReceipt {
  matchId: string;
  potTotal: number;
  payouts: Payout[];
}

export interface EscrowPort {
  /** Debit `ante` from every player into the match pot, all or nothing. */
  hold(matchId: string, playerIds: readonly string[], ante: number): Promise<EscrowResult<HoldReceipt>>;
  /** Pay the entire held pot to one player. */
  releaseToWinner(matchId: string, winnerId: string): Promise<EscrowResult<SettleReceipt>>;
  /** Split the held pot evenly; any indivisible remainder goes 1 PC each in the given order. */
  splitEven(matchId: string, playerIds: readonly string[]): Promise<EscrowResult<SettleReceipt>>;
  /** Return every player's ante (match never started). */
  refundAll(matchId: string): Promise<EscrowResult<SettleReceipt>>;
}

/** Deterministic even split used by every EscrowPort implementation. */
export function computeEvenSplit(potTotal: number, playerIds: readonly string[]): Payout[] {
  if (playerIds.length === 0) return [];
  const share = Math.floor(potTotal / playerIds.length);
  let remainder = potTotal - share * playerIds.length;
  return playerIds.map((userId) => {
    const extra = remainder > 0 ? 1 : 0;
    remainder -= extra;
    return { userId, amount: share + extra };
  });
}

export type MatchOutcome = "WIN" | "LOSS" | "SPLIT" | "FORFEIT" | "REFUNDED";

export interface MatchPlayerRecord {
  userId: string;
  seat: number;
  score: number;
  outcome: MatchOutcome;
}

/** Match bookkeeping (not money). Kept separate so the escrow stays swappable. */
export interface MatchLogPort {
  open(input: {
    matchId: string;
    roomId: string;
    mode: string;
    ante: number;
    players: { userId: string; seat: number }[];
  }): Promise<void>;
  markLive(matchId: string): Promise<void>;
  finish(input: {
    matchId: string;
    winnerUserId: string | null;
    players: MatchPlayerRecord[];
  }): Promise<void>;
  cancel(matchId: string, players: { userId: string }[]): Promise<void>;
}
