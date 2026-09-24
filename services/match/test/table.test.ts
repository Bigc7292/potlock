import { describe, expect, it } from "vitest";
import { GILT_ROUND, type GameEvent, type Phase } from "@potlock/shared";
import { GiltRoundTable, type Seat } from "../src/table/GiltRoundTable.js";
import { MemoryEscrow, MemoryMatchLog } from "../src/testing/memoryPorts.js";

function setup(balances: Record<string, number>, ante = 25) {
  let now = 1_000_000;
  const escrow = new MemoryEscrow(balances);
  const matchLog = new MemoryMatchLog();
  const events: GameEvent[] = [];
  const kicked: string[] = [];
  const phases: Phase[] = [];
  let n = 0;
  const table = new GiltRoundTable(
    "room1",
    ante,
    { escrow, matchLog, now: () => now, newMatchId: () => `m${++n}` },
    {
      broadcast: (e) => events.push(e),
      kick: (ids) => kicked.push(...ids),
      phaseChanged: (p: Phase, _s: Seat[]) => phases.push(p),
      log: () => undefined,
    },
  );
  return {
    table,
    escrow,
    matchLog,
    events,
    kicked,
    phases,
    advance(ms: number) {
      now += ms;
      table.update(now);
    },
  };
}

async function seatAndLock(t: ReturnType<typeof setup>, ids: string[]) {
  for (const id of ids) t.table.join(id, id.toUpperCase());
  for (const id of ids) t.table.setReady(id, true);
  expect(t.table.requestLock(ids[0] as string).ok).toBe(true);
  await t.table.pending;
}

async function toLive(t: ReturnType<typeof setup>, ids: string[]) {
  await seatAndLock(t, ids);
  expect(t.table.phase).toBe("countdown");
  t.advance(GILT_ROUND.countdownMs);
  expect(t.table.phase).toBe("live");
}

describe("Gilt Round table: seating and lock", () => {
  it("seats up to six, first player hosts, rejects a seventh and duplicates", () => {
    const t = setup({});
    for (let i = 0; i < 6; i++) expect(t.table.join(`p${i}`, `P${i}`).ok).toBe(true);
    expect(t.table.join("p6", "P6").ok).toBe(false);
    expect(t.table.join("p0", "P0").ok).toBe(false);
    expect(t.table.hostId).toBe("p0");
    t.table.leave("p0");
    expect(t.table.hostId).toBe("p1");
  });

  it("only the host can lock and only with two ready players", () => {
    const t = setup({ a: 100, b: 100 });
    t.table.join("a", "A");
    t.table.join("b", "B");
    t.table.setReady("a", true);
    expect(t.table.requestLock("a").ok).toBe(false);
    t.table.setReady("b", true);
    expect(t.table.requestLock("b").ok).toBe(false);
    expect(t.table.requestLock("a").ok).toBe(true);
    expect(t.table.phase).toBe("locked");
  });

  it("lock debits every seated player the ante and holds the pot", async () => {
    const t = setup({ a: 2000, b: 2000 });
    await seatAndLock(t, ["a", "b"]);
    expect(t.escrow.balance("a")).toBe(1975);
    expect(t.escrow.balance("b")).toBe(1975);
    expect(t.table.pot).toBe(50);
    expect(t.table.phase).toBe("countdown");
    expect(t.events.some((e) => e.type === "potLocked")).toBe(true);
  });

  it("lock fails atomically when one player cannot cover the ante; nobody is charged", async () => {
    const t = setup({ a: 2000, b: 10 });
    await seatAndLock(t, ["a", "b"]);
    expect(t.table.phase).toBe("waiting");
    expect(t.escrow.balance("a")).toBe(2000);
    expect(t.escrow.balance("b")).toBe(10);
    const failed = t.events.find((e) => e.type === "lockFailed");
    expect(failed && failed.type === "lockFailed" && failed.message).toContain("B");
    expect(t.table.getSeat("b")?.ready).toBe(false);
    expect([...t.matchLog.matches.values()][0]?.status).toBe("CANCELLED");
  });

  it("auto-locks 20s after two players are ready and unseats anyone not ready", async () => {
    const t = setup({ a: 100, b: 100, c: 100 });
    t.table.join("a", "A");
    t.table.join("b", "B");
    t.table.join("c", "C");
    t.table.setReady("a", true);
    t.table.setReady("b", true);
    t.advance(GILT_ROUND.autoLockMs - 1);
    expect(t.table.phase).toBe("waiting");
    t.advance(1);
    expect(t.table.phase).toBe("locked");
    await t.table.pending;
    expect(t.kicked).toEqual(["c"]);
    expect(t.escrow.balance("c")).toBe(100);
    expect(t.table.pot).toBe(50);
  });

  it("auto-lock timer resets when ready players drop below two", () => {
    const t = setup({ a: 100, b: 100 });
    t.table.join("a", "A");
    t.table.join("b", "B");
    t.table.setReady("a", true);
    t.table.setReady("b", true);
    t.advance(10_000);
    t.table.setReady("b", false);
    expect(t.table.autoLockAt).toBeNull();
    t.advance(30_000);
    expect(t.table.phase).toBe("waiting");
  });

  it("refunds everyone if the room is torn down before the match goes live", async () => {
    const t = setup({ a: 100, b: 100 });
    await seatAndLock(t, ["a", "b"]);
    expect(t.escrow.balance("a")).toBe(75);
    await t.table.abort();
    expect(t.escrow.balance("a")).toBe(100);
    expect(t.escrow.balance("b")).toBe(100);
    const result = t.events.find((e) => e.type === "result");
    expect(result?.type === "result" && result.result.reason).toBe("abandoned");
  });
});

describe("Gilt Round table: match end and payout", () => {
  it("first to 3 eliminations takes the whole pot", async () => {
    const t = setup({ a: 2000, b: 2000 });
    await toLive(t, ["a", "b"]);
    t.table.recordElimination("a", "b");
    t.table.recordElimination("b", "a");
    t.table.recordElimination("a", "b");
    expect(t.table.phase).toBe("live");
    t.table.recordElimination("a", "b");
    expect(t.table.phase).toBe("ended");
    await t.table.pending;
    expect(t.escrow.balance("a")).toBe(2025);
    expect(t.escrow.balance("b")).toBe(1975);
    expect(t.table.result?.winnerIds).toEqual(["a"]);
    expect(t.table.result?.payouts).toEqual([{ userId: "a", name: "A", amount: 50 }]);
    const m = t.matchLog.matches.get("m1");
    expect(m?.winnerUserId).toBe("a");
    expect(m?.players.find((p) => p.userId === "b")?.outcome).toBe("LOSS");
  });

  it("ignores eliminations before live and after the end", async () => {
    const t = setup({ a: 100, b: 100 });
    await seatAndLock(t, ["a", "b"]);
    t.table.recordElimination("a", "b");
    expect(t.table.getSeat("a")?.score).toBe(0);
    t.advance(GILT_ROUND.countdownMs);
    for (let i = 0; i < 5; i++) t.table.recordElimination("a", "b");
    await t.table.pending;
    expect(t.table.getSeat("a")?.score).toBe(3);
    expect(t.escrow.balance("a")).toBe(125);
  });

  it("disconnect after lock is a forfeit; the last player standing wins", async () => {
    const t = setup({ a: 100, b: 100 });
    await toLive(t, ["a", "b"]);
    t.table.recordElimination("b", "a");
    t.table.leave("b");
    await t.table.pending;
    expect(t.table.phase).toBe("ended");
    expect(t.table.result?.reason).toBe("forfeit");
    expect(t.escrow.balance("a")).toBe(125);
    expect(t.escrow.balance("b")).toBe(75);
    expect(t.matchLog.matches.get("m1")?.players.find((p) => p.userId === "b")?.outcome).toBe("FORFEIT");
  });

  it("forfeit during countdown also pays the remaining player", async () => {
    const t = setup({ a: 100, b: 100 });
    await seatAndLock(t, ["a", "b"]);
    t.table.leave("a");
    await t.table.pending;
    expect(t.table.result?.winnerIds).toEqual(["b"]);
    expect(t.escrow.balance("b")).toBe(125);
  });

  it("forfeit while the hold is still in flight settles once the pot is held", async () => {
    const t = setup({ a: 100, b: 100, c: 100 });
    t.escrow.delayMs = 5;
    for (const id of ["a", "b", "c"]) t.table.join(id, id);
    for (const id of ["a", "b", "c"]) t.table.setReady(id, true);
    t.table.requestLock("a");
    t.table.leave("b");
    t.table.leave("c");
    await t.table.pending;
    await t.table.pending;
    expect(t.table.result?.winnerIds).toEqual(["a"]);
    expect(t.escrow.balance("a")).toBe(150);
  });

  it("with three players, one forfeit leaves the match running", async () => {
    const t = setup({ a: 100, b: 100, c: 100 });
    await toLive(t, ["a", "b", "c"]);
    t.table.leave("c");
    expect(t.table.phase).toBe("live");
    for (let i = 0; i < 3; i++) t.table.recordElimination("b", "a");
    await t.table.pending;
    expect(t.escrow.balance("b")).toBe(150);
    expect(t.escrow.balance("c")).toBe(75);
  });

  it("4:00 timeout pays the highest score", async () => {
    const t = setup({ a: 100, b: 100, c: 100 });
    await toLive(t, ["a", "b", "c"]);
    t.table.recordElimination("c", "a");
    t.table.recordElimination("c", "b");
    t.table.recordElimination("a", "b");
    t.advance(GILT_ROUND.matchDurationMs);
    await t.table.pending;
    expect(t.table.result?.reason).toBe("timeout");
    expect(t.escrow.balance("c")).toBe(150);
  });

  it("true tie at the timeout splits the pot evenly between the tied players", async () => {
    const t = setup({ a: 100, b: 100, c: 100 });
    await toLive(t, ["a", "b", "c"]);
    t.table.recordElimination("a", "c");
    t.table.recordElimination("b", "c");
    t.advance(GILT_ROUND.matchDurationMs);
    await t.table.pending;
    expect(t.table.result?.winnerIds).toEqual(["a", "b"]);
    // 75 PC between two: 38 to the lower seat, 37 to the other.
    expect(t.escrow.balance("a")).toBe(75 + 38);
    expect(t.escrow.balance("b")).toBe(75 + 37);
    expect(t.escrow.balance("c")).toBe(75);
    expect(t.matchLog.matches.get("m1")?.players.find((p) => p.userId === "a")?.outcome).toBe("SPLIT");
  });

  it("scoreless timeout is a full tie and returns each ante", async () => {
    const t = setup({ a: 100, b: 100 });
    await toLive(t, ["a", "b"]);
    t.advance(GILT_ROUND.matchDurationMs);
    await t.table.pending;
    expect(t.escrow.balance("a")).toBe(100);
    expect(t.escrow.balance("b")).toBe(100);
  });

  it("settles exactly once even if end conditions race", async () => {
    const t = setup({ a: 100, b: 100 });
    await toLive(t, ["a", "b"]);
    t.table.recordElimination("a", "b");
    t.table.recordElimination("a", "b");
    t.table.recordElimination("a", "b");
    t.table.leave("a");
    t.advance(GILT_ROUND.matchDurationMs);
    await t.table.pending;
    await t.table.abort();
    expect(t.escrow.balance("a")).toBe(125);
    expect(t.escrow.balance("b")).toBe(75);
    expect(t.events.filter((e) => e.type === "result")).toHaveLength(1);
  });
});

describe("Gilt Round table: phase machine", () => {
  it("walks waiting -> locked -> countdown -> live -> ended in order", async () => {
    const t = setup({ a: 100, b: 100 });
    await toLive(t, ["a", "b"]);
    for (let i = 0; i < 3; i++) t.table.recordElimination("a", "b");
    await t.table.pending;
    expect(t.phases).toEqual(["locked", "countdown", "live", "ended"]);
  });
});
