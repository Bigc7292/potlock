import type { PrismaClient } from "@prisma/client";
import {
  RAKE_BPS,
  computeEvenSplit,
  type EscrowError,
  type EscrowPort,
  type EscrowResult,
  type HoldReceipt,
  type Payout,
  type SettleReceipt,
} from "@potlock/shared";
import { prisma as defaultPrisma } from "./client.js";
import { InsufficientFundsError, postTransaction, type Tx } from "./ledger.js";

class EscrowFailure extends Error {
  constructor(readonly escrowError: EscrowError) {
    super(escrowError.code);
  }
}

function fail(error: EscrowError): never {
  throw new EscrowFailure(error);
}

/**
 * EscrowPort over the Postgres double-entry ledger. Each pot has its own POT_ESCROW account:
 * hold moves antes from wallets into it, and settlement empties it. The Match row must exist
 * (MatchLogPort.open) before hold is called.
 */
export class PrismaEscrow implements EscrowPort {
  constructor(private readonly db: PrismaClient = defaultPrisma) {}

  async hold(matchId: string, playerIds: readonly string[], ante: number): Promise<EscrowResult<HoldReceipt>> {
    return this.run(async (tx) => {
      if (!Number.isSafeInteger(ante) || ante <= 0) fail({ code: "INVALID_REQUEST", message: "ante must be a positive integer" });
      const unique = [...new Set(playerIds)];
      if (unique.length !== playerIds.length || unique.length < 1) {
        fail({ code: "INVALID_REQUEST", message: "players must be unique and non-empty" });
      }
      const wallets = await tx.account.findMany({ where: { kind: "USER_WALLET", userId: { in: unique } } });
      const missing = unique.filter((id) => !wallets.some((w) => w.userId === id));
      if (missing.length > 0) fail({ code: "UNKNOWN_PLAYER", userIds: missing });
      const short = wallets.filter((w) => w.balance < ante).map((w) => w.userId ?? "");
      if (short.length > 0) fail({ code: "INSUFFICIENT_FUNDS", userIds: short });

      const total = ante * unique.length;
      const potAccount = await tx.account.create({ data: { kind: "POT_ESCROW" } });
      await tx.pot.create({ data: { matchId, accountId: potAccount.id, ante, total, rakeBps: RAKE_BPS } });
      try {
        await postTransaction(tx, {
          kind: "POT_HOLD",
          matchId,
          memo: `Ante ${ante} PC into pot`,
          legs: [
            ...wallets.map((w) => ({ accountId: w.id, amount: -ante })),
            { accountId: potAccount.id, amount: total },
          ],
        });
      } catch (err) {
        if (err instanceof InsufficientFundsError) {
          const who = wallets.find((w) => w.id === err.accountId)?.userId ?? "";
          fail({ code: "INSUFFICIENT_FUNDS", userIds: [who] });
        }
        throw err;
      }
      return { matchId, ante, potTotal: total };
    });
  }

  releaseToWinner(matchId: string, winnerId: string): Promise<EscrowResult<SettleReceipt>> {
    return this.settle(matchId, "RELEASED", async (_tx, pot, participants) => {
      if (!participants.has(winnerId)) fail({ code: "UNKNOWN_PLAYER", userIds: [winnerId] });
      return [{ userId: winnerId, amount: pot.total }];
    });
  }

  splitEven(matchId: string, playerIds: readonly string[]): Promise<EscrowResult<SettleReceipt>> {
    return this.settle(matchId, "SPLIT", async (_tx, pot, participants) => {
      const unknown = playerIds.filter((id) => !participants.has(id));
      if (unknown.length > 0) fail({ code: "UNKNOWN_PLAYER", userIds: unknown });
      if (playerIds.length === 0 || new Set(playerIds).size !== playerIds.length) {
        fail({ code: "INVALID_REQUEST", message: "split needs unique players" });
      }
      return computeEvenSplit(pot.total, playerIds);
    });
  }

  refundAll(matchId: string): Promise<EscrowResult<SettleReceipt>> {
    return this.settle(matchId, "REFUNDED", async (_tx, _pot, participants) =>
      [...participants.entries()].map(([userId, amount]) => ({ userId, amount })),
    );
  }

  private async settle(
    matchId: string,
    status: "RELEASED" | "SPLIT" | "REFUNDED",
    plan: (tx: Tx, pot: { total: number; accountId: string }, participants: Map<string, number>) => Promise<Payout[]>,
  ): Promise<EscrowResult<SettleReceipt>> {
    return this.run(async (tx) => {
      // Claim the pot first: only one settlement can move it out of HELD.
      const claimed = await tx.pot.updateMany({
        where: { matchId, status: "HELD" },
        data: { status, settledAt: new Date() },
      });
      if (claimed.count !== 1) fail({ code: "POT_NOT_HELD", matchId });
      const pot = await tx.pot.findUniqueOrThrow({ where: { matchId } });
      const participants = await this.participants(tx, matchId);
      const payouts = (await plan(tx, pot, participants)).filter((p) => p.amount > 0);
      const paid = payouts.reduce((acc, p) => acc + p.amount, 0);
      if (paid !== pot.total) fail({ code: "INTERNAL", message: `payouts ${paid} do not empty pot ${pot.total}` });

      const wallets = await tx.account.findMany({
        where: { kind: "USER_WALLET", userId: { in: payouts.map((p) => p.userId) } },
      });
      const kind = status === "RELEASED" ? "POT_PAYOUT" : status === "SPLIT" ? "POT_SPLIT" : "POT_REFUND";
      const memo = status === "RELEASED" ? "Pot paid to winner" : status === "SPLIT" ? "Pot split on a tie" : "Pot refunded";
      await postTransaction(tx, {
        kind,
        matchId,
        memo,
        legs: [
          { accountId: pot.accountId, amount: -pot.total },
          ...payouts.map((p) => {
            const wallet = wallets.find((w) => w.userId === p.userId);
            if (!wallet) fail({ code: "UNKNOWN_PLAYER", userIds: [p.userId] });
            return { accountId: wallet.id, amount: p.amount };
          }),
        ],
      });
      return { matchId, potTotal: pot.total, payouts };
    });
  }

  /** userId -> ante paid, read back from the POT_HOLD ledger entries. */
  private async participants(tx: Tx, matchId: string): Promise<Map<string, number>> {
    const entries = await tx.ledgerEntry.findMany({
      where: { transaction: { matchId, kind: "POT_HOLD" }, amount: { lt: 0 } },
      include: { account: { select: { userId: true } } },
      orderBy: { id: "asc" },
    });
    const out = new Map<string, number>();
    for (const e of entries) {
      if (e.account.userId) out.set(e.account.userId, (out.get(e.account.userId) ?? 0) - e.amount);
    }
    return out;
  }

  private async run<T>(fn: (tx: Tx) => Promise<T>): Promise<EscrowResult<T>> {
    try {
      const value = await this.db.$transaction(fn, { isolationLevel: "ReadCommitted", timeout: 15000 });
      return { ok: true, value };
    } catch (err) {
      if (err instanceof EscrowFailure) return { ok: false, error: err.escrowError };
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: { code: "INTERNAL", message } };
    }
  }
}
