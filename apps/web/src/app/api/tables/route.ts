import { NextResponse } from "next/server";
import type { TableListing } from "@potlock/shared";

export const dynamic = "force-dynamic";

/** Lobby list, read from the match service's matchmaker. */
export async function GET() {
  const base = process.env.MATCH_HTTP_URL ?? "http://localhost:2567";
  try {
    const res = await fetch(`${base}/tables`, { cache: "no-store" });
    const body = (await res.json()) as { tables: TableListing[] };
    return NextResponse.json(body);
  } catch {
    return NextResponse.json({ tables: [], error: "Match server is not reachable." }, { status: 503 });
  }
}
