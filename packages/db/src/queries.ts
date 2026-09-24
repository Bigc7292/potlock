import type { LedgerKind } from "@prisma/client";
import { prisma } from "./client.js";

export interface WalletSummary {
  userId: string;
  handle: string;
  isGuest: boolean;
  balance: number;
}

export interface LedgerLine {
  id: string;
  kind: LedgerKind;
  memo: string;
  matchId: string | null;
  amount: number;
  balanceAfter: number;
  createdAt: Date;
}

export async function getWalletSummary(userId: string): Promise<WalletSummary | null> {
  const user = await prisma.user.findUnique({ where: { id: userId }, include: { account: true } });
  if (!user?.account) return null;
  return { userId: user.id, handle: user.handle, isGuest: user.isGuest, balance: user.account.balance };
}

export async function getLedgerHistory(userId: string, limit = 25): Promise<LedgerLine[]> {
  const entries = await prisma.ledgerEntry.findMany({
    where: { account: { userId } },
    include: { transaction: true },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit,
  });
  return entries.map((e) => ({
    id: e.id,
    kind: e.transaction.kind,
    memo: e.transaction.memo,
    matchId: e.transaction.matchId,
    amount: e.amount,
    balanceAfter: e.balanceAfter,
    createdAt: e.createdAt,
  }));
}

export interface LedgerAudit {
  /** Sum of every account balance; always 0 for a healthy double-entry ledger. */
  totalBalance: number;
  /** Accounts whose cached balance differs from the sum of their entries. */
  mismatchedAccounts: string[];
  /** Transactions whose entries do not sum to zero. */
  unbalancedTransactions: string[];
}

export async function auditLedger(): Promise<LedgerAudit> {
  const accounts = await prisma.account.findMany({ select: { id: true, balance: true } });
  const sums = await prisma.ledgerEntry.groupBy({ by: ["accountId"], _sum: { amount: true } });
  const txSums = await prisma.ledgerEntry.groupBy({ by: ["transactionId"], _sum: { amount: true } });
  const byAccount = new Map(sums.map((s) => [s.accountId, s._sum.amount ?? 0]));
  return {
    totalBalance: accounts.reduce((acc, a) => acc + a.balance, 0),
    mismatchedAccounts: accounts.filter((a) => (byAccount.get(a.id) ?? 0) !== a.balance).map((a) => a.id),
    unbalancedTransactions: txSums.filter((t) => (t._sum.amount ?? 0) !== 0).map((t) => t.transactionId),
  };
}
