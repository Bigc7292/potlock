import type { EscrowPort, MatchLogPort } from "@potlock/shared";

export interface MatchDeps {
  escrow: EscrowPort;
  matchLog: MatchLogPort;
  tokenSecret: string;
  now: () => number;
}

let deps: MatchDeps | null = null;

/** Wire the money ports once at boot (server) or per test. Rooms read them on create. */
export function configureMatchDeps(next: MatchDeps): void {
  deps = next;
}

export function matchDeps(): MatchDeps {
  if (!deps) throw new Error("match deps not configured");
  return deps;
}
