import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { STARTER_GRANT_PC } from "@potlock/shared";
import {
  PrismaEscrow,
  PrismaMatchLog,
  auditLedger,
  createUserWithGrant,
  getLedgerHistory,
  getWalletSummary,
  prisma,
  postTransaction,
} from "../src/index.js";

const escrow = new PrismaEscrow();
const matchLog = new PrismaMatchLog();
let counter = 0;

async function user(balance = STARTER_GRANT_PC): Promise<string> {
  const u = await createUserWithGrant({ handle: `t${Date.now().toString(36)}${counter++}` });
  if (balance !== STARTER_GRANT_PC) {
    // Move the excess to a sink account through the ledger (never set a balance directly).
    const wallet = await prisma.account.findUniqueOrThrow({ where: { userId: u.id } });
    const sink = await prisma.account.create({ data: { kind: "POT_ESCROW" } });
    await prisma.$transaction((tx) =>
      postTransaction(tx, {
        kind: "POT_HOLD",
        memo: "test drain",
        legs: [
          { accountId: wallet.id, amount: -(STARTER_GRANT_PC - balance) },
          { accountId: sink.id, amount: STARTER_GRANT_PC - balance },
        ],
      }),
    );
  }
  return u.id;
}

async function balance(userId: string): Promise<number> {
  return (await getWalletSummary(userId))?.balance ?? -1;
}

async function openMatch(players: string[], ante = 25): Promise<string> {
  const matchId = `match_${Date.now().toString(36)}_${counter++}`;
  await matchLog.open({
    matchId,
    roomId: "room",
    mode: "gilt_round",
    ante,
    players: players.map((userId, seat) => ({ userId, seat })),
  });
  return matchId;
}

async function expectBalancedLedger(): Promise<void> {
  const audit = await auditLedger();
  expect(audit.totalBalance).toBe(0);
  expect(audit.mismatchedAccounts).toEqual([]);
  expect(audit.unbalancedTransactions).toEqual([]);
}

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(() => {
  counter++;
});

describe("ledger", () => {
  it("new users get the 2,000 PC starter grant through a balanced ledger transaction", async () => {
    const id = await user();
    expect(await balance(id)).toBe(2000);
    const history = await getLedgerHistory(id);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ kind: "STARTER_GRANT", amount: 2000, balanceAfter: 2000 });
    await expectBalancedLedger();
  });

  it("rejects unbalanced transactions", async () => {
    const a = await prisma.account.create({ data: { kind: "POT_ESCROW" } });
    const b = await prisma.account.create({ data: { kind: "POT_ESCROW" } });
    await expect(
      prisma.$transaction((tx) =>
        postTransaction(tx, {
          kind: "POT_HOLD",
          memo: "bad",
          legs: [
            { accountId: a.id, amount: 5 },
            { accountId: b.id, amount: 5 },
          ],
        }),
      ),
    ).rejects.toThrow(/unbalanced/);
  });
});

describe("PrismaEscrow", () => {
  it("hold debits every player the ante into the pot", async () => {
    const [a, b] = [await user(), await user()];
    const matchId = await openMatch([a, b]);
    const held = await escrow.hold(matchId, [a, b], 25);
    expect(held).toEqual({ ok: true, value: { matchId, ante: 25, potTotal: 50 } });
    expect(await balance(a)).toBe(1975);
    expect(await balance(b)).toBe(1975);
    const pot = await prisma.pot.findUniqueOrThrow({ where: { matchId }, include: { account: true } });
    expect(pot).toMatchObject({ status: "HELD", total: 50, rakeBps: 0 });
    expect(pot.account.balance).toBe(50);
    await expectBalancedLedger();
  });

  it("hold is all-or-nothing: one short player means nobody is charged and no pot exists", async () => {
    const [a, b] = [await user(), await user(10)];
    const matchId = await openMatch([a, b]);
    const held = await escrow.hold(matchId, [a, b], 25);
    expect(held).toEqual({ ok: false, error: { code: "INSUFFICIENT_FUNDS", userIds: [b] } });
    expect(await balance(a)).toBe(2000);
    expect(await balance(b)).toBe(10);
    expect(await prisma.pot.findUnique({ where: { matchId } })).toBeNull();
    await expectBalancedLedger();
  });

  it("concurrent holds cannot overdraw a wallet", async () => {
    const [a, b, c] = [await user(30), await user(), await user()];
    const m1 = await openMatch([a, b]);
    const m2 = await openMatch([a, c]);
    const results = await Promise.all([escrow.hold(m1, [a, b], 25), escrow.hold(m2, [a, c], 25)]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(await balance(a)).toBe(5);
    const others = (await balance(b)) + (await balance(c));
    expect(others).toBe(2000 + 1975);
    await expectBalancedLedger();
  });

  it("releaseToWinner pays the whole pot once; a second settlement is refused", async () => {
    const [a, b] = [await user(), await user()];
    const matchId = await openMatch([a, b]);
    await escrow.hold(matchId, [a, b], 25);
    const paid = await escrow.releaseToWinner(matchId, a);
    expect(paid).toEqual({ ok: true, value: { matchId, potTotal: 50, payouts: [{ userId: a, amount: 50 }] } });
    expect(await balance(a)).toBe(2025);
    expect(await balance(b)).toBe(1975);
    expect(await escrow.releaseToWinner(matchId, a)).toEqual({ ok: false, error: { code: "POT_NOT_HELD", matchId } });
    expect(await escrow.refundAll(matchId)).toMatchObject({ ok: false });
    expect(await balance(a)).toBe(2025);
    const history = await getLedgerHistory(a);
    expect(history.map((h) => h.kind)).toEqual(["POT_PAYOUT", "POT_HOLD", "STARTER_GRANT"]);
    await expectBalancedLedger();
  });

  it("refuses to pay someone who is not in the pot and keeps it held", async () => {
    const [a, b, outsider] = [await user(), await user(), await user()];
    const matchId = await openMatch([a, b]);
    await escrow.hold(matchId, [a, b], 25);
    expect(await escrow.releaseToWinner(matchId, outsider)).toMatchObject({ ok: false, error: { code: "UNKNOWN_PLAYER" } });
    expect((await prisma.pot.findUniqueOrThrow({ where: { matchId } })).status).toBe("HELD");
    expect(await balance(outsider)).toBe(2000);
    await expectBalancedLedger();
  });

  it("splitEven gives the indivisible remainder 1 PC at a time in the given order", async () => {
    const [a, b, c] = [await user(), await user(), await user()];
    const matchId = await openMatch([a, b, c]);
    await escrow.hold(matchId, [a, b, c], 25);
    const split = await escrow.splitEven(matchId, [b, a]);
    expect(split).toMatchObject({ ok: true, value: { payouts: [{ userId: b, amount: 38 }, { userId: a, amount: 37 }] } });
    expect(await balance(a)).toBe(2012);
    expect(await balance(b)).toBe(2013);
    expect(await balance(c)).toBe(1975);
    await expectBalancedLedger();
  });

  it("refundAll returns each ante", async () => {
    const [a, b] = [await user(), await user()];
    const matchId = await openMatch([a, b], 100);
    await escrow.hold(matchId, [a, b], 100);
    expect(await balance(a)).toBe(1900);
    await escrow.refundAll(matchId);
    expect(await balance(a)).toBe(2000);
    expect(await balance(b)).toBe(2000);
    expect((await prisma.pot.findUniqueOrThrow({ where: { matchId } })).status).toBe("REFUNDED");
    await expectBalancedLedger();
  });

  it("match log records scores and outcomes", async () => {
    const [a, b] = [await user(), await user()];
    const matchId = await openMatch([a, b]);
    await escrow.hold(matchId, [a, b], 25);
    await matchLog.markLive(matchId);
    await escrow.releaseToWinner(matchId, b);
    await matchLog.finish({
      matchId,
      winnerUserId: b,
      players: [
        { userId: a, seat: 0, score: 1, outcome: "LOSS" },
        { userId: b, seat: 1, score: 3, outcome: "WIN" },
      ],
    });
    const match = await prisma.match.findUniqueOrThrow({ where: { id: matchId }, include: { players: true } });
    expect(match.status).toBe("ENDED");
    expect(match.winnerUserId).toBe(b);
    expect(match.players.find((p) => p.userId === b)).toMatchObject({ score: 3, outcome: "WIN" });
  });
});
