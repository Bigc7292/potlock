import { RedisDriver } from "@colyseus/redis-driver";
import { RedisPresence } from "@colyseus/redis-presence";
import { PrismaEscrow, PrismaMatchLog } from "@potlock/db";
import { createMatchServer } from "./app.js";
import { configureMatchDeps } from "./deps.js";

const port = Number(process.env.MATCH_PORT ?? 2567);
const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
const tokenSecret = process.env.MATCH_TOKEN_SECRET;
if (!tokenSecret) throw new Error("MATCH_TOKEN_SECRET is not set (see .env.example)");

configureMatchDeps({
  escrow: new PrismaEscrow(),
  matchLog: new PrismaMatchLog(),
  tokenSecret,
  now: () => Date.now(),
});

const { gameServer } = createMatchServer({
  presence: new RedisPresence(redisUrl),
  driver: new RedisDriver(redisUrl),
});

await gameServer.listen(port);
console.log(`[match] Gilt Round rooms listening on :${port}`);
