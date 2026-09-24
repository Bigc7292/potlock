import bcrypt from "bcryptjs";
import { STARTER_GRANT_PC } from "@potlock/shared";
import { prisma } from "./client.js";
import { mintAccountId, postTransaction } from "./ledger.js";

export interface PublicUser {
  id: string;
  handle: string;
  isGuest: boolean;
}

export const HANDLE_PATTERN = /^[a-zA-Z0-9_]{3,20}$/;

/** Create a user, their wallet, and the 2,000 PC starter grant in one transaction. */
export async function createUserWithGrant(input: {
  handle: string;
  password?: string;
  isGuest?: boolean;
}): Promise<PublicUser> {
  if (!HANDLE_PATTERN.test(input.handle)) throw new Error("handle must be 3-20 letters, digits or _");
  const passwordHash = input.password ? await bcrypt.hash(input.password, 10) : null;
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: { handle: input.handle, passwordHash, isGuest: input.isGuest ?? false },
    });
    const wallet = await tx.account.create({ data: { kind: "USER_WALLET", userId: user.id } });
    const mint = await mintAccountId(tx);
    await postTransaction(tx, {
      kind: "STARTER_GRANT",
      memo: "Starter grant",
      legs: [
        { accountId: mint, amount: -STARTER_GRANT_PC },
        { accountId: wallet.id, amount: STARTER_GRANT_PC },
      ],
    });
    return { id: user.id, handle: user.handle, isGuest: user.isGuest };
  });
}

export async function verifyCredentials(handle: string, password: string): Promise<PublicUser | null> {
  const user = await prisma.user.findUnique({ where: { handle } });
  if (!user?.passwordHash) return null;
  const ok = await bcrypt.compare(password, user.passwordHash);
  return ok ? { id: user.id, handle: user.handle, isGuest: user.isGuest } : null;
}

export async function findUserByHandle(handle: string): Promise<PublicUser | null> {
  const user = await prisma.user.findUnique({ where: { handle } });
  return user ? { id: user.id, handle: user.handle, isGuest: user.isGuest } : null;
}

export async function createGuest(): Promise<PublicUser> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const handle = `guest_${Math.random().toString(36).slice(2, 8)}`;
    const existing = await prisma.user.findUnique({ where: { handle } });
    if (!existing) return createUserWithGrant({ handle, isGuest: true });
  }
  throw new Error("could not allocate a guest handle");
}
