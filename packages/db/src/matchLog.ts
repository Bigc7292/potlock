import type { PrismaClient } from "@prisma/client";
import type { MatchLogPort, MatchPlayerRecord } from "@potlock/shared";
import { prisma as defaultPrisma } from "./client.js";

/** Match bookkeeping for history pages. Holds no money. */
export class PrismaMatchLog implements MatchLogPort {
  constructor(private readonly db: PrismaClient = defaultPrisma) {}

  async open(input: {
    matchId: string;
    roomId: string;
    mode: string;
    ante: number;
    players: { userId: string; seat: number }[];
  }): Promise<void> {
    await this.db.match.create({
      data: {
        id: input.matchId,
        roomId: input.roomId,
        mode: input.mode,
        ante: input.ante,
        players: { create: input.players.map((p) => ({ userId: p.userId, seat: p.seat })) },
      },
    });
  }

  async markLive(matchId: string): Promise<void> {
    await this.db.match.update({ where: { id: matchId }, data: { status: "LIVE", startedAt: new Date() } });
  }

  async finish(input: { matchId: string; winnerUserId: string | null; players: MatchPlayerRecord[] }): Promise<void> {
    await this.db.$transaction([
      this.db.match.update({
        where: { id: input.matchId },
        data: { status: "ENDED", endedAt: new Date(), winnerUserId: input.winnerUserId },
      }),
      ...input.players.map((p) =>
        this.db.matchPlayer.update({
          where: { matchId_userId: { matchId: input.matchId, userId: p.userId } },
          data: { score: p.score, outcome: p.outcome },
        }),
      ),
    ]);
  }

  async cancel(matchId: string, players: { userId: string }[]): Promise<void> {
    await this.db.$transaction([
      this.db.match.update({ where: { id: matchId }, data: { status: "CANCELLED", endedAt: new Date() } }),
      ...players.map((p) =>
        this.db.matchPlayer.update({
          where: { matchId_userId: { matchId, userId: p.userId } },
          data: { outcome: "REFUNDED" },
        }),
      ),
    ]);
  }
}
