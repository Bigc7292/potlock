import { randomUUID } from "node:crypto";
import {
  GILT_ROUND,
  MODE_GILT_ROUND,
  type EndReason,
  type EscrowPort,
  type GameEvent,
  type MatchLogPort,
  type MatchOutcome,
  type MatchResult,
  type Phase,
  type SeatView,
  type SettleReceipt,
} from "@potlock/shared";

/** Legal phase transitions. Anything else is a bug and throws. */
export const PHASE_TRANSITIONS: Readonly<Record<Phase, readonly Phase[]>> = {
  waiting: ["locked"],
  locked: ["countdown", "waiting", "ended"],
  countdown: ["live", "ended"],
  live: ["ended"],
  ended: [],
};

export interface Seat {
  userId: string;
  name: string;
  seat: number;
  ready: boolean;
  /** Took part in the locked pot. */
  inMatch: boolean;
  connected: boolean;
  forfeited: boolean;
  score: number;
}

export interface TableHooks {
  broadcast(event: GameEvent): void;
  /** Remove players from the room (unready players when the pot locks). */
  kick(userIds: string[], reason: string): void;
  phaseChanged(phase: Phase, participants: Seat[]): void;
  log(message: string): void;
}

export interface TableDeps {
  escrow: EscrowPort;
  matchLog: MatchLogPort;
  now: () => number;
  newMatchId?: () => string;
}

export type JoinResult = { ok: true; seat: Seat } | { ok: false; reason: string };

/**
 * One Gilt Round table: seats, ready, pot lock, phases and end-of-match settlement.
 *
 * Pure game-rule logic with injected money ports and clock, so it can be tested
 * deterministically without sockets. The Colyseus room drives it with `update(now)` every tick.
 * Phases: waiting -> locked (pot being held) -> countdown (5s freeze) -> live -> ended.
 */
export class GiltRoundTable {
  readonly ante: number;
  readonly roomId: string;
  phase: Phase = "waiting";
  hostId: string | null = null;
  matchId: string | null = null;
  pot = 0;
  autoLockAt: number | null = null;
  countdownEndsAt: number | null = null;
  liveEndsAt: number | null = null;
  result: MatchResult | null = null;
  /** Resolves when the current async money operation (lock or settlement) finishes. */
  pending: Promise<void> = Promise.resolve();

  private readonly seats = new Map<string, Seat>();

  private transition(next: Phase): void {
    if (!PHASE_TRANSITIONS[this.phase].includes(next)) {
      throw new Error(`illegal phase transition ${this.phase} -> ${next}`);
    }
    this.phase = next;
  }
  private potHeld = false;
  private settling = false;

  constructor(
    roomId: string,
    ante: number,
    private readonly deps: TableDeps,
    private readonly hooks: TableHooks,
  ) {
    this.roomId = roomId;
    this.ante = ante;
  }

  // ---------- Queries ----------

  get seatList(): Seat[] {
    return [...this.seats.values()].sort((a, b) => a.seat - b.seat);
  }

  getSeat(userId: string): Seat | undefined {
    return this.seats.get(userId);
  }

  get participants(): Seat[] {
    return this.seatList.filter((s) => s.inMatch);
  }

  /** Players still competing for the pot. */
  get activePlayers(): Seat[] {
    return this.participants.filter((s) => !s.forfeited);
  }

  get readyCount(): number {
    return this.seatList.filter((s) => s.ready).length;
  }

  get isSettled(): boolean {
    return !this.potHeld && !this.settling;
  }

  seatViews(): SeatView[] {
    return this.seatList.map((s) => ({
      userId: s.userId,
      name: s.name,
      seat: s.seat,
      ready: s.ready,
      isHost: s.userId === this.hostId,
      connected: s.connected,
      forfeited: s.forfeited,
      score: s.score,
    }));
  }

  // ---------- Seating ----------

  join(userId: string, name: string): JoinResult {
    if (this.phase !== "waiting") return { ok: false, reason: "This table has already locked its pot." };
    if (this.seats.has(userId)) return { ok: false, reason: "You are already seated at this table." };
    if (this.seats.size >= GILT_ROUND.maxPlayers) return { ok: false, reason: "This table is full." };
    const taken = new Set(this.seatList.map((s) => s.seat));
    let seatNo = 0;
    while (taken.has(seatNo)) seatNo++;
    const seat: Seat = {
      userId,
      name,
      seat: seatNo,
      ready: false,
      inMatch: false,
      connected: true,
      forfeited: false,
      score: 0,
    };
    this.seats.set(userId, seat);
    if (!this.hostId) this.hostId = userId;
    return { ok: true, seat };
  }

  leave(userId: string): void {
    const seat = this.seats.get(userId);
    if (!seat) return;
    seat.connected = false;

    if (this.phase === "waiting" || !seat.inMatch) {
      this.seats.delete(userId);
      if (this.hostId === userId) this.hostId = this.seatList[0]?.userId ?? null;
      this.refreshAutoLock();
      return;
    }
    if (this.phase === "ended") return;

    // Disconnect after the pot locked is a forfeit. Score stays on the board.
    if (!seat.forfeited) {
      seat.forfeited = true;
      this.hooks.broadcast({ type: "notice", text: `${seat.name} left and forfeits.` });
    }
    this.checkLastStanding();
  }

  setReady(userId: string, ready: boolean): void {
    const seat = this.seats.get(userId);
    if (!seat || this.phase !== "waiting") return;
    seat.ready = ready;
    this.refreshAutoLock();
  }

  requestLock(userId: string): { ok: boolean; reason?: string } {
    if (this.phase !== "waiting") return { ok: false, reason: "The pot is already locked." };
    if (userId !== this.hostId) return { ok: false, reason: "Only the host can lock the pot." };
    if (this.readyCount < GILT_ROUND.minPlayers) {
      return { ok: false, reason: `Need at least ${GILT_ROUND.minPlayers} ready players.` };
    }
    this.startLock();
    return { ok: true };
  }

  // ---------- Match flow ----------

  /** Advance timers. Call every tick. */
  update(now: number = this.deps.now()): void {
    if (this.phase === "waiting" && this.autoLockAt !== null && now >= this.autoLockAt) {
      this.startLock();
    } else if (this.phase === "countdown" && this.countdownEndsAt !== null && now >= this.countdownEndsAt) {
      this.goLive(now);
    } else if (this.phase === "live" && this.liveEndsAt !== null && now >= this.liveEndsAt) {
      this.endByTimeout();
    }
  }

  /** Called by the simulation when one player eliminates another. */
  recordElimination(killerId: string, victimId: string): void {
    if (this.phase !== "live" || killerId === victimId) return;
    const killer = this.seats.get(killerId);
    if (!killer?.inMatch || killer.forfeited) return;
    killer.score += 1;
    if (killer.score >= GILT_ROUND.scoreToWin) this.end("score", [killer]);
  }

  /** Room is being disposed. Any pot still held is refunded. */
  async abort(): Promise<void> {
    await this.pending;
    if (this.potHeld && !this.settling && this.phase !== "ended") {
      this.end("abandoned", []);
      await this.pending;
    }
  }

  private refreshAutoLock(): void {
    if (this.phase !== "waiting") return;
    if (this.readyCount >= GILT_ROUND.minPlayers) {
      this.autoLockAt ??= this.deps.now() + GILT_ROUND.autoLockMs;
    } else {
      this.autoLockAt = null;
    }
  }

  private startLock(): void {
    if (this.phase !== "waiting") return;
    const ready = this.seatList.filter((s) => s.ready);
    if (ready.length < GILT_ROUND.minPlayers) {
      this.autoLockAt = null;
      return;
    }
    this.transition("locked");
    this.autoLockAt = null;
    const matchId = this.deps.newMatchId?.() ?? randomUUID();
    this.matchId = matchId;
    for (const s of ready) s.inMatch = true;

    const unready = this.seatList.filter((s) => !s.ready);
    if (unready.length > 0) {
      for (const s of unready) this.seats.delete(s.userId);
      this.hooks.kick(
        unready.map((s) => s.userId),
        "The pot locked without you. Ready up at another table.",
      );
    }
    if (this.hostId && !this.seats.has(this.hostId)) this.hostId = ready[0]?.userId ?? null;
    this.hooks.phaseChanged("locked", ready);

    this.pending = this.lockPot(matchId, ready);
  }

  private async lockPot(matchId: string, players: Seat[]): Promise<void> {
    const { escrow, matchLog } = this.deps;
    try {
      await matchLog.open({
        matchId,
        roomId: this.roomId,
        mode: MODE_GILT_ROUND,
        ante: this.ante,
        players: players.map((p) => ({ userId: p.userId, seat: p.seat })),
      });
    } catch (err) {
      this.hooks.log(`match log open failed: ${String(err)}`);
      this.failLock("The table could not start a match. Nobody was charged.", players, []);
      return;
    }
    const held = await escrow.hold(
      matchId,
      players.map((p) => p.userId),
      this.ante,
    );
    if (!held.ok) {
      const short = held.error.code === "INSUFFICIENT_FUNDS" ? held.error.userIds : [];
      const names = short.map((id) => this.seats.get(id)?.name ?? "a player");
      const message =
        short.length > 0
          ? `Lock failed: ${names.join(", ")} cannot cover the ${this.ante} PC ante. Nobody was charged.`
          : "Lock failed. Nobody was charged.";
      if (held.error.code !== "INSUFFICIENT_FUNDS") this.hooks.log(`hold failed: ${JSON.stringify(held.error)}`);
      await matchLog.cancel(matchId, []).catch((err: unknown) => this.hooks.log(`cancel failed: ${String(err)}`));
      this.failLock(message, players, short);
      return;
    }

    this.potHeld = true;
    this.pot = held.value.potTotal;
    this.hooks.broadcast({ type: "potLocked", pot: this.pot, ante: this.ante, matchId });
    // Anyone who left while the hold was in flight has already forfeited.
    if (this.checkLastStanding()) return;
    this.transition("countdown");
    this.countdownEndsAt = this.deps.now() + GILT_ROUND.countdownMs;
    this.hooks.phaseChanged("countdown", this.participants);
  }

  private failLock(message: string, players: Seat[], shortUserIds: string[]): void {
    this.transition("waiting");
    this.matchId = null;
    for (const p of players) {
      p.inMatch = false;
      if (shortUserIds.includes(p.userId)) p.ready = false;
    }
    // Players who disconnected during the attempt are simply unseated.
    for (const p of players) {
      if (!p.connected) this.seats.delete(p.userId);
    }
    if (this.hostId && !this.seats.has(this.hostId)) this.hostId = this.seatList[0]?.userId ?? null;
    this.hooks.broadcast({ type: "lockFailed", message });
    this.hooks.phaseChanged("waiting", []);
    // Auto-lock does not retry on its own; the next ready change restarts the timer.
    this.autoLockAt = null;
  }

  private goLive(now: number): void {
    this.transition("live");
    this.countdownEndsAt = null;
    this.liveEndsAt = now + GILT_ROUND.matchDurationMs;
    this.hooks.phaseChanged("live", this.participants);
    const matchId = this.matchId;
    if (matchId) {
      this.deps.matchLog.markLive(matchId).catch((err: unknown) => this.hooks.log(`markLive failed: ${String(err)}`));
    }
  }

  /** Ends the match if at most one player is still in it. Returns true if it ended. */
  private checkLastStanding(): boolean {
    if (!this.potHeld || this.phase === "ended" || this.settling) return false;
    const active = this.activePlayers;
    if (active.length === 1) {
      this.end("forfeit", active);
      return true;
    }
    if (active.length === 0) {
      this.end("abandoned", []);
      return true;
    }
    return false;
  }

  private endByTimeout(): void {
    const active = this.activePlayers;
    const top = Math.max(...active.map((s) => s.score));
    this.end(
      "timeout",
      active.filter((s) => s.score === top),
    );
  }

  /** Winners empty means refund (nobody left to pay). One winner takes all; several split. */
  private end(reason: EndReason, winners: Seat[]): void {
    if (this.phase === "ended" || this.settling) return;
    this.transition("ended");
    this.liveEndsAt = null;
    this.countdownEndsAt = null;
    this.settling = true;
    this.hooks.phaseChanged("ended", this.participants);
    const previous = this.pending;
    this.pending = previous.then(() => this.settle(reason, winners));
  }

  private async settle(reason: EndReason, winners: Seat[]): Promise<void> {
    const matchId = this.matchId;
    if (!matchId || !this.potHeld) {
      this.settling = false;
      return;
    }
    const { escrow, matchLog } = this.deps;
    const winnerIds = winners.map((w) => w.userId);
    let receipt: SettleReceipt | null = null;
    const settled =
      winnerIds.length === 0
        ? await escrow.refundAll(matchId)
        : winnerIds.length === 1
          ? await escrow.releaseToWinner(matchId, winnerIds[0] as string)
          : await escrow.splitEven(matchId, winnerIds);
    if (settled.ok) {
      receipt = settled.value;
      this.potHeld = false;
    } else {
      this.hooks.log(`settlement failed for ${matchId}: ${JSON.stringify(settled.error)}`);
      this.hooks.broadcast({ type: "notice", text: "Payout is delayed; the pot is still held safely." });
    }

    const outcomeFor = (s: Seat): MatchOutcome => {
      if (winnerIds.length === 0) return "REFUNDED";
      if (winnerIds.includes(s.userId)) return winnerIds.length === 1 ? "WIN" : "SPLIT";
      return s.forfeited ? "FORFEIT" : "LOSS";
    };
    try {
      if (winnerIds.length === 0) {
        await matchLog.cancel(matchId, this.participants);
      } else {
        await matchLog.finish({
          matchId,
          winnerUserId: winnerIds.length === 1 ? (winnerIds[0] ?? null) : null,
          players: this.participants.map((s) => ({
            userId: s.userId,
            seat: s.seat,
            score: s.score,
            outcome: outcomeFor(s),
          })),
        });
      }
    } catch (err) {
      this.hooks.log(`match log finish failed: ${String(err)}`);
    }

    const nameOf = (id: string): string => this.seats.get(id)?.name ?? "player";
    this.result = {
      matchId,
      reason,
      potTotal: this.pot,
      winnerIds,
      payouts: (receipt?.payouts ?? []).map((p) => ({ userId: p.userId, name: nameOf(p.userId), amount: p.amount })),
      standings: [...this.participants]
        .sort((a, b) => b.score - a.score || a.seat - b.seat)
        .map((s) => ({ userId: s.userId, name: s.name, score: s.score, forfeited: s.forfeited })),
    };
    this.settling = false;
    this.hooks.broadcast({ type: "result", result: this.result });
  }
}
