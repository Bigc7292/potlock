import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Client, type Room } from "colyseus.js";
import { matchMaker } from "@colyseus/core";
import type { GameEvent, MatchResult, Snapshot, TableListing } from "@potlock/shared";
import { createMatchServer } from "../src/app.js";
import { signMatchToken } from "../src/auth.js";
import { configureMatchDeps } from "../src/deps.js";
import { MemoryEscrow, MemoryMatchLog } from "../src/testing/memoryPorts.js";

const SECRET = "test-secret-at-least-16";
const PORT = 25670 + Math.floor(Math.random() * 1000);
const { gameServer } = createMatchServer({});
let escrow: MemoryEscrow;

interface Joined {
  room: Room;
  snaps: Snapshot[];
  events: GameEvent[];
}

function track(room: Room): Joined {
  const joined: Joined = { room, snaps: [], events: [] };
  room.onMessage("snap", (s: Snapshot) => joined.snaps.push(s));
  room.onMessage("event", (e: GameEvent) => joined.events.push(e));
  room.onMessage("welcome", () => undefined);
  return joined;
}

async function until(check: () => boolean, ms = 4000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > ms) throw new Error("timed out waiting for condition");
    await new Promise((r) => setTimeout(r, 20));
  }
}

async function token(sub: string): Promise<string> {
  return signMatchToken({ sub, name: sub.toUpperCase() }, SECRET);
}

const client = new Client(`ws://localhost:${PORT}`);

beforeAll(async () => {
  await gameServer.listen(PORT);
});

afterAll(async () => {
  await gameServer.gracefullyShutdown(false);
});

beforeEach(() => {
  escrow = new MemoryEscrow({ alice: 2000, bob: 2000, carol: 10 });
  configureMatchDeps({ escrow, matchLog: new MemoryMatchLog(), tokenSecret: SECRET, now: () => Date.now() });
});

describe("gilt_round room", () => {
  it("rejects a join without a valid match token", async () => {
    await expect(client.create("gilt_round", { token: "forged", ante: 25 })).rejects.toThrow();
  });

  it("two players sit, ready, lock the pot and the leaver forfeits it to the other", async () => {
    const a = track(await client.create("gilt_round", { token: await token("alice"), ante: 25 }));
    const b = track(await client.joinById(a.room.roomId, { token: await token("bob") }));

    await until(() => (a.snaps.at(-1)?.seats.length ?? 0) === 2);
    const listing = (await matchMaker.query({ name: "gilt_round" }))[0];
    expect(listing?.metadata).toMatchObject({ ante: 25, phase: "waiting", seated: 2 });

    a.room.send("ready", { ready: true });
    b.room.send("ready", { ready: true });
    await until(() => a.snaps.at(-1)?.seats.every((s) => s.ready) ?? false);
    b.room.send("lock", {});
    await until(() => b.events.some((e) => e.type === "notice"));
    a.room.send("lock", {});

    await until(() => a.snaps.at(-1)?.phase === "countdown");
    expect(a.snaps.at(-1)?.pot).toBe(50);
    expect(escrow.balance("alice")).toBe(1975);
    expect(escrow.balance("bob")).toBe(1975);

    await b.room.leave(true);
    await until(() => a.events.some((e) => e.type === "result"));
    const result = a.events.find((e): e is { type: "result"; result: MatchResult } => e.type === "result")?.result;
    expect(result?.reason).toBe("forfeit");
    expect(result?.winnerIds).toEqual(["alice"]);
    expect(escrow.balance("alice")).toBe(2025);
    expect(escrow.balance("bob")).toBe(1975);
    await a.room.leave(true);
  });

  it("a failed lock charges nobody and reopens the table", async () => {
    const a = track(await client.create("gilt_round", { token: await token("alice"), ante: 25 }));
    const c = track(await client.joinById(a.room.roomId, { token: await token("carol") }));
    a.room.send("ready", { ready: true });
    c.room.send("ready", { ready: true });
    await until(() => a.snaps.at(-1)?.seats.every((s) => s.ready) ?? false);
    a.room.send("lock", {});
    await until(() => a.events.some((e) => e.type === "lockFailed"));
    expect(a.snaps.at(-1)?.phase).toBe("waiting");
    expect(escrow.balance("alice")).toBe(2000);
    expect(escrow.balance("carol")).toBe(10);
    await a.room.leave(true);
    await c.room.leave(true);
  });

  it("the same account cannot take two seats", async () => {
    const a = track(await client.create("gilt_round", { token: await token("alice"), ante: 100 }));
    await expect(client.joinById(a.room.roomId, { token: await token("alice") })).rejects.toThrow();
    await a.room.leave(true);
  });

  it("serves the lobby table list over HTTP", async () => {
    const a = track(await client.create("gilt_round", { token: await token("bob"), ante: 500 }));
    await until(() => a.snaps.length > 0);
    const res = await fetch(`http://localhost:${PORT}/tables`);
    const body = (await res.json()) as { tables: TableListing[] };
    expect(body.tables.find((t) => t.roomId === a.room.roomId)).toMatchObject({ ante: 500, hostName: "BOB", seated: 1 });
    await a.room.leave(true);
  });
});
