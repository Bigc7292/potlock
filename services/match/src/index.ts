import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { RedisDriver } from "@colyseus/redis-driver";
import { RedisPresence } from "@colyseus/redis-presence";
import { PrismaEscrow, PrismaMatchLog } from "@potlock/db";
import { createMatchServer, type StaticGame } from "./app.js";
import { configureMatchDeps } from "./deps.js";

// MATCH_PORT locally; hosts such as Railway and Render hand out PORT.
const port = Number(process.env.MATCH_PORT ?? process.env.PORT ?? 2567);
// Redis is optional: without it a single node keeps rooms and the table list in memory.
const redisUrl = process.env.REDIS_URL;
const tokenSecret = process.env.MATCH_TOKEN_SECRET;
if (!tokenSecret || tokenSecret.length < 16) throw new Error("MATCH_TOKEN_SECRET must be set (16+ characters, see .env.example)");
if (process.env.NODE_ENV === "production" && tokenSecret.startsWith("dev-only")) {
  throw new Error("MATCH_TOKEN_SECRET still has the dev placeholder; set a real secret in production");
}

// Serve the built game client (pnpm build:match) when it exists, so players need one address for play.
const gameDist = resolve(process.env.GAME_DIST_DIR ?? resolve(dirname(fileURLToPath(import.meta.url)), "../../../apps/game/dist"));
const staticGame: StaticGame | undefined = existsSync(resolve(gameDist, "index.html"))
  ? { dir: gameDist, lobbyUrl: process.env.LOBBY_URL ?? "http://localhost:3000" }
  : undefined;

configureMatchDeps({
  escrow: new PrismaEscrow(),
  matchLog: new PrismaMatchLog(),
  tokenSecret,
  now: () => Date.now(),
});

const { gameServer } = createMatchServer({
  ...(redisUrl ? { presence: new RedisPresence(redisUrl), driver: new RedisDriver(redisUrl) } : {}),
  ...(staticGame ? { staticGame } : {}),
});

await gameServer.listen(port);
console.log(`[match] Gilt Round rooms listening on :${port} (${redisUrl ? "Redis" : "in-memory"} presence)`);
if (staticGame) console.log(`[match] serving game client from ${staticGame.dir}`);
