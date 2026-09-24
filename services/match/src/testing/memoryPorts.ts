import {
  computeEvenSplit,
  type EscrowPort,
  type EscrowResult,
  type HoldReceipt,
  type MatchLogPort,
  type MatchPlayerRecord,
  type Payout,
  type SettleReceipt,
} from "@potlock/shared";

interface MemoryPot {
  ante: number;
  total: number;
  players: string[];
  status: "HELD" | "RELEASED" | "SPLIT" | "REFUNDED";
}

/** In-memory EscrowPort with the same rules as the ledger adapter. For tests only. */
export class MemoryEscrow implements EscrowPort {
  readonly balances = new Map<string, number>();
  readonly pots = new Map<string, MemoryPot>();
  /** Optional artificial latency so tests can interleave events with an in-flight hold. */
  delayMs = 0;

  constructor(initial: Record<string, number> = {}) {
    for (const [id, bal] of Object.entries(initial)) this.balances.set(id, bal);
  }

  balance(userId: string): number {
    return this.balances.get(userId) ?? 0;
  }

  private async wait(): Promise<void> {
    if (this.delayMs > 0) await new Promise((r) => setTimeout(r, this.delayMs));
  }

  async hold(matchId: string, playerIds: readonly string[], ante: number): Promise<EscrowResult<HoldReceipt>> {
    await this.wait();
    const unknown = playerIds.filter((id) => !this.balances.has(id));
    if (unknown.length > 0) return { ok: false, error: { code: "UNKNOWN_PLAYER", userIds: unknown } };
    const short = playerIds.filter((id) => this.balance(id) < ante);
    if (short.length > 0) return { ok: false, error: { code: "INSUFFICIENT_FUNDS", userIds: short } };
    for (const id of playerIds) this.balances.set(id, this.balance(id) - ante);
    const total = ante * playerIds.length;
    this.pots.set(matchId, { ante, total, players: [...playerIds], status: "HELD" });
    return { ok: true, value: { matchId, ante, potTotal: total } };
  }

  async releaseToWinner(matchId: string, winnerId: string): Promise<EscrowResult<SettleReceipt>> {
    return this.settle(matchId, "RELEASED", (pot) => [{ userId: winnerId, amount: pot.total }]);
  }

  async splitEven(matchId: string, playerIds: readonly string[]): Promise<EscrowResult<SettleReceipt>> {
    return this.settle(matchId, "SPLIT", (pot) => computeEvenSplit(pot.total, playerIds));
  }

  async refundAll(matchId: string): Promise<EscrowResult<SettleReceipt>> {
    return this.settle(matchId, "REFUNDED", (pot) => pot.players.map((userId) => ({ userId, amount: pot.ante })));
  }

  private async settle(
    matchId: string,
    status: MemoryPot["status"],
    plan: (pot: MemoryPot) => Payout[],
  ): Promise<EscrowResult<SettleReceipt>> {
    await this.wait();
    const pot = this.pots.get(matchId);
    if (!pot || pot.status !== "HELD") return { ok: false, error: { code: "POT_NOT_HELD", matchId } };
    const payouts = plan(pot);
    const unknown = payouts.filter((p) => !pot.players.includes(p.userId)).map((p) => p.userId);
    if (unknown.length > 0) return { ok: false, error: { code: "UNKNOWN_PLAYER", userIds: unknown } };
    pot.status = status;
    for (const p of payouts) this.balances.set(p.userId, this.balance(p.userId) + p.amount);
    return { ok: true, value: { matchId, potTotal: pot.total, payouts } };
  }
}

export interface MemoryMatch {
  ante: number;
  status: "LOCKED" | "LIVE" | "ENDED" | "CANCELLED";
  winnerUserId: string | null;
  players: MatchPlayerRecord[];
}

export class MemoryMatchLog implements MatchLogPort {
  readonly matches = new Map<string, MemoryMatch>();

  async open(input: { matchId: string; ante: number; players: { userId: string; seat: number }[] }): Promise<void> {
    this.matches.set(input.matchId, {
      ante: input.ante,
      status: "LOCKED",
      winnerUserId: null,
      players: input.players.map((p) => ({ ...p, score: 0, outcome: "LOSS" })),
    });
  }

  async markLive(matchId: string): Promise<void> {
    const m = this.matches.get(matchId);
    if (m) m.status = "LIVE";
  }

  async finish(input: { matchId: string; winnerUserId: string | null; players: MatchPlayerRecord[] }): Promise<void> {
    const m = this.matches.get(input.matchId);
    if (!m) return;
    m.status = "ENDED";
    m.winnerUserId = input.winnerUserId;
    m.players = input.players;
  }

  async cancel(matchId: string): Promise<void> {
    const m = this.matches.get(matchId);
    if (m) m.status = "CANCELLED";
  }
}
