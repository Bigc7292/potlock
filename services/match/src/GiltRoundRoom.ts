import { Room, ServerError, type Client } from "@colyseus/core";
import {
  ANTE_PRESETS,
  GILT_ROUND,
  TICK_MS,
  isAntePreset,
  parseReady,
  type GameEvent,
  type JoinOptions,
  type Phase,
  type ServerMessages,
  type Snapshot,
  type TableMetadata,
} from "@potlock/shared";
import { verifyMatchToken } from "./auth.js";
import { matchDeps } from "./deps.js";
import { GiltRoundTable, type Seat } from "./table/GiltRoundTable.js";

interface AuthData {
  userId: string;
  name: string;
}

type PotlockClient = Client<unknown, AuthData>;

/**
 * One Gilt Round table = one Colyseus room. The room is thin glue: it authenticates players,
 * validates messages, drives the table at 20 Hz and broadcasts snapshots. Rules live in
 * GiltRoundTable; money moves only through the EscrowPort the table was given.
 */
export class GiltRoundRoom extends Room {
  override maxClients = GILT_ROUND.maxPlayers;
  override autoDispose = true;

  private table!: GiltRoundTable;
  private tick = 0;
  private lastMetadata = "";

  override onCreate(options: Partial<JoinOptions>): void {
    const deps = matchDeps();
    const ante = typeof options.ante === "number" && isAntePreset(options.ante) ? options.ante : ANTE_PRESETS[0];
    this.table = new GiltRoundTable(
      this.roomId,
      ante,
      { escrow: deps.escrow, matchLog: deps.matchLog, now: deps.now },
      {
        broadcast: (event) => this.broadcastEvent(event),
        kick: (userIds, reason) => this.kickPlayers(userIds, reason),
        phaseChanged: (phase, participants) => this.onPhaseChanged(phase, participants),
        log: (message) => console.warn(`[gilt_round ${this.roomId}] ${message}`),
      },
    );

    this.onMessage("ready", (client: PotlockClient, raw: unknown) => {
      const msg = parseReady(raw);
      const auth = client.auth;
      if (msg && auth) this.table.setReady(auth.userId, msg.ready);
    });
    this.onMessage("lock", (client: PotlockClient) => {
      const auth = client.auth;
      if (!auth) return;
      const res = this.table.requestLock(auth.userId);
      if (!res.ok && res.reason) this.sendTo(client, "event", { type: "notice", text: res.reason });
    });
    this.onMessage("*", () => undefined);

    this.setSimulationInterval(() => this.step(), TICK_MS);
    this.publishMetadata();
  }

  override async onAuth(client: PotlockClient, options: Partial<JoinOptions>): Promise<AuthData> {
    const claims = await verifyMatchToken(options.token, matchDeps().tokenSecret);
    if (!claims) throw new ServerError(401, "Sign in again: your match pass expired.");
    if (this.clients.some((c) => (c as PotlockClient).auth?.userId === claims.sub)) {
      throw new ServerError(409, "You are already at this table in another window.");
    }
    return { userId: claims.sub, name: claims.name };
  }

  override onJoin(client: PotlockClient): void {
    const auth = client.auth;
    if (!auth) throw new ServerError(401, "not authenticated");
    const res = this.table.join(auth.userId, auth.name);
    if (!res.ok) throw new ServerError(409, res.reason);
    this.sendTo(client, "welcome", { userId: auth.userId, name: auth.name, roomId: this.roomId });
    this.sendTo(client, "snap", this.snapshot());
    this.publishMetadata();
  }

  override onLeave(client: PotlockClient): void {
    const auth = client.auth;
    if (auth) this.table.leave(auth.userId);
    this.publishMetadata();
  }

  override async onDispose(): Promise<void> {
    // A pot that is still held when the room goes away is refunded.
    await this.table.abort();
  }

  private step(): void {
    const now = matchDeps().now();
    this.table.update(now);
    this.tick++;
    this.broadcastTyped("snap", this.snapshot());
    this.publishMetadata();
  }

  private snapshot(): Snapshot {
    const t = this.table;
    return {
      tick: this.tick,
      serverTime: matchDeps().now(),
      phase: t.phase,
      ante: t.ante,
      pot: t.pot,
      seats: t.seatViews(),
      players: [],
      lance: { state: "cooldown", availableAt: 0 },
      autoLockAt: t.autoLockAt,
      countdownEndsAt: t.countdownEndsAt,
      liveEndsAt: t.liveEndsAt,
    };
  }

  private onPhaseChanged(phase: Phase, _participants: Seat[]): void {
    // Once the pot locks, nobody new can join; the room stays until settlement finishes.
    if (phase !== "waiting") {
      void this.lock();
      this.autoDispose = false;
    } else {
      void this.unlock();
    }
    if (phase === "ended") {
      void this.table.pending.then(() => {
        this.autoDispose = true;
        if (this.clients.length === 0) void this.disconnect();
      });
    }
    this.publishMetadata();
  }

  private kickPlayers(userIds: string[], reason: string): void {
    for (const c of this.clients) {
      const client = c as PotlockClient;
      if (client.auth && userIds.includes(client.auth.userId)) {
        this.sendTo(client, "event", { type: "notice", text: reason });
        client.leave(4000, reason);
      }
    }
  }

  private broadcastEvent(event: GameEvent): void {
    this.broadcastTyped("event", event);
  }

  private sendTo<K extends keyof ServerMessages>(client: Client, type: K, message: ServerMessages[K]): void {
    client.send(type, message);
  }

  private broadcastTyped<K extends keyof ServerMessages>(type: K, message: ServerMessages[K]): void {
    this.broadcast(type, message);
  }

  private publishMetadata(): void {
    const host = this.table.hostId ? this.table.getSeat(this.table.hostId) : undefined;
    const meta: TableMetadata = {
      ante: this.table.ante,
      phase: this.table.phase,
      hostName: host?.name ?? "",
      seated: this.table.seatList.length,
      maxSeats: GILT_ROUND.maxPlayers,
    };
    const key = JSON.stringify(meta);
    if (key === this.lastMetadata) return;
    this.lastMetadata = key;
    void this.setMetadata(meta);
  }
}
