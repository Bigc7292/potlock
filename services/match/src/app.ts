import http from "node:http";
import { Server, matchMaker, type Presence, type MatchMakerDriver } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import cors from "cors";
import express from "express";
import { MODE_GILT_ROUND, type TableListing, type TableMetadata } from "@potlock/shared";
import { GiltRoundRoom } from "./GiltRoundRoom.js";

function isTableMetadata(v: unknown): v is TableMetadata {
  return typeof v === "object" && v !== null && "ante" in v && "phase" in v;
}

/** Built game client this server hands out, plus the lobby address it links back to. */
export interface StaticGame {
  dir: string;
  lobbyUrl: string;
}

/** Build the HTTP + Colyseus server. Presence/driver are Redis on multi-node hosts, in-memory otherwise. */
export function createMatchServer(opts: { presence?: Presence; driver?: MatchMakerDriver; staticGame?: StaticGame }): {
  app: express.Express;
  gameServer: Server;
} {
  const app = express();
  app.use(cors());
  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });
  // Lobby list: open and live Gilt Round tables, read from the matchmaker (Redis-backed).
  app.get("/tables", async (_req, res) => {
    const rooms = await matchMaker.query({ name: MODE_GILT_ROUND });
    const tables: TableListing[] = rooms
      .filter((r) => isTableMetadata(r.metadata))
      .map((r) => {
        const meta = r.metadata as TableMetadata;
        return { roomId: r.roomId, locked: r.locked, ...meta };
      })
      .sort((a, b) => Number(a.phase !== "waiting") - Number(b.phase !== "waiting") || a.ante - b.ante);
    res.json({ tables });
  });
  if (opts.staticGame) {
    const { dir, lobbyUrl } = opts.staticGame;
    // Replaces the empty dev file so one client build works on any host.
    app.get("/runtime-config.js", (_req, res) => {
      res.type("application/javascript").set("Cache-Control", "no-store");
      res.send(`window.POTLOCK_CONFIG = ${JSON.stringify({ lobbyUrl })};\n`);
    });
    app.use(express.static(dir));
  }

  const httpServer = http.createServer(app);
  const gameServer = new Server({
    transport: new WebSocketTransport({ server: httpServer }),
    ...(opts.presence ? { presence: opts.presence } : {}),
    ...(opts.driver ? { driver: opts.driver } : {}),
  });
  gameServer.define(MODE_GILT_ROUND, GiltRoundRoom);
  return { app, gameServer };
}
