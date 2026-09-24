import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { potlockPrisma?: PrismaClient };

/** One PrismaClient per process (Next dev reloads would otherwise open many). */
export const prisma: PrismaClient = globalForPrisma.potlockPrisma ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") globalForPrisma.potlockPrisma = prisma;

export type { PrismaClient };
