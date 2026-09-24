import http from "node:http";
import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { RedisPresence } from "@colyseus/redis-presence";
import { RedisDriver } from "@colyseus/redis-driver";
import cors from "cors";
import express from "express";
import { HelloRoom } from "./HelloRoom.js";

const port = Number(process.env.MATCH_PORT ?? 2567);
const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";

const app = express();
app.use(cors());
app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

const httpServer = http.createServer(app);
const gameServer = new Server({
  transport: new WebSocketTransport({ server: httpServer }),
  presence: new RedisPresence(redisUrl),
  driver: new RedisDriver(redisUrl),
});

gameServer.define("hello", HelloRoom);

await gameServer.listen(port);
console.log(`[match] listening on :${port}`);
