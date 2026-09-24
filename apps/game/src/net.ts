import { Client, type Room } from "colyseus.js";
import {
  MODE_GILT_ROUND,
  type ClientMessages,
  type GameEvent,
  type JoinOptions,
  type ServerMessages,
  type Snapshot,
  type Welcome,
} from "@potlock/shared";
import { MATCH_WS_URL } from "./env.js";

export interface Connection {
  room: Room;
  send<K extends keyof ClientMessages>(type: K, message: ClientMessages[K]): void;
  onSnapshot(fn: (s: Snapshot) => void): void;
  onEvent(fn: (e: GameEvent) => void): void;
  onWelcome(fn: (w: Welcome) => void): void;
  onClose(fn: (code: number) => void): void;
}

export type TableTarget = { kind: "create"; ante: number } | { kind: "join"; roomId: string };

/** Typed wrapper over the Colyseus room: the client only ever sends input messages. */
export async function connect(target: TableTarget, token: string): Promise<Connection> {
  const client = new Client(MATCH_WS_URL);
  const options: JoinOptions = target.kind === "create" ? { token, ante: target.ante } : { token };
  const room = target.kind === "create" ? await client.create(MODE_GILT_ROUND, options) : await client.joinById(target.roomId, options);

  const on = <K extends keyof ServerMessages>(type: K, fn: (m: ServerMessages[K]) => void) => {
    room.onMessage(type, (m: ServerMessages[K]) => fn(m));
  };
  const handlers = {
    snap: [] as ((s: Snapshot) => void)[],
    event: [] as ((e: GameEvent) => void)[],
    welcome: [] as ((w: Welcome) => void)[],
  };
  on("snap", (s) => handlers.snap.forEach((fn) => fn(s)));
  on("event", (e) => handlers.event.forEach((fn) => fn(e)));
  on("welcome", (w) => handlers.welcome.forEach((fn) => fn(w)));

  return {
    room,
    send: (type, message) => room.send(type, message),
    onSnapshot: (fn) => handlers.snap.push(fn),
    onEvent: (fn) => handlers.event.push(fn),
    onWelcome: (fn) => handlers.welcome.push(fn),
    onClose: (fn) => room.onLeave((code) => fn(code)),
  };
}
