import { NextResponse } from "next/server";
import { getLedgerHistory, getWalletSummary } from "@potlock/db";
import { currentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const [wallet, history] = await Promise.all([getWalletSummary(user.id), getLedgerHistory(user.id, 25)]);
  return NextResponse.json({ wallet, history });
}
