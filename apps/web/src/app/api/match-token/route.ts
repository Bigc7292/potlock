import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { signMatchToken } from "@/lib/matchToken";

export const dynamic = "force-dynamic";

export async function POST() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const token = await signMatchToken(user.id, user.handle);
  return NextResponse.json({ token });
}
