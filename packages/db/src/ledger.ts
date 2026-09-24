import type { LedgerKind, Prisma } from "@prisma/client";

/** Interactive-transaction client type. */
export type Tx = Prisma.TransactionClient;

export interface Leg {
  accountId: string;
  /** Signed PC: negative debits, positive credits. */
  amount: number;
}

export class InsufficientFundsError extends Error {
  constructor(readonly accountId: string) {
    super(`account ${accountId} cannot cover the debit`);
  }
}

export const MINT_KEY = "mint";

/** The system mint funds starter grants; it is the only account allowed below zero. */
export async function mintAccountId(tx: Tx): Promise<string> {
  const mint = await tx.account.upsert({
    where: { systemKey: MINT_KEY },
    update: {},
    create: { kind: "SYSTEM_MINT", systemKey: MINT_KEY },
  });
  return mint.id;
}

/**
 * Post one balanced ledger transaction. Every balance change in Potlock goes through here:
 * the legs must sum to zero, debits are guarded so no wallet or pot goes negative, and each
 * leg writes a LedgerEntry with the resulting balance. Call inside `prisma.$transaction`.
 */
export async function postTransaction(
  tx: Tx,
  input: { kind: LedgerKind; memo: string; matchId?: string; legs: Leg[] },
): Promise<string> {
  const { legs } = input;
  if (legs.length < 2) throw new Error("a ledger transaction needs at least two legs");
  for (const leg of legs) {
    if (!Number.isSafeInteger(leg.amount) || leg.amount === 0) throw new Error("leg amounts must be non-zero integers");
  }
  const sum = legs.reduce((acc, l) => acc + l.amount, 0);
  if (sum !== 0) throw new Error(`unbalanced ledger transaction (sum ${sum})`);

  const record = await tx.ledgerTransaction.create({
    data: { kind: input.kind, memo: input.memo, matchId: input.matchId ?? null },
  });

  // Lock rows in a stable order to avoid deadlocks between concurrent transactions.
  const ordered = [...legs].sort((a, b) => (a.accountId < b.accountId ? -1 : a.accountId > b.accountId ? 1 : 0));
  for (const leg of ordered) {
    const account = await tx.account.findUniqueOrThrow({ where: { id: leg.accountId }, select: { kind: true } });
    if (leg.amount < 0 && account.kind !== "SYSTEM_MINT") {
      const debited = await tx.account.updateMany({
        where: { id: leg.accountId, balance: { gte: -leg.amount } },
        data: { balance: { increment: leg.amount } },
      });
      if (debited.count !== 1) throw new InsufficientFundsError(leg.accountId);
    } else {
      await tx.account.update({ where: { id: leg.accountId }, data: { balance: { increment: leg.amount } } });
    }
    const after = await tx.account.findUniqueOrThrow({ where: { id: leg.accountId }, select: { balance: true } });
    await tx.ledgerEntry.create({
      data: { transactionId: record.id, accountId: leg.accountId, amount: leg.amount, balanceAfter: after.balance },
    });
  }
  return record.id;
}
