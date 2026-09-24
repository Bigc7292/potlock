# POTLOCK

Winner-takes-all multiplayer arena platform. Shared lobby + isolated match rooms. Play-money **Pot Credits** only.

**Stack:** pnpm monorepo · Next.js 15 (`apps/web`) · Vite + Three.js (`apps/game`) · Colyseus (`services/match`) · Prisma + Postgres · Redis · TypeScript strict.

## Commands

- `pnpm dev` — web + game + match together
- `pnpm db:migrate` / `pnpm db:seed`
- `pnpm test`

## Architecture

- Lobby and accounts live in `apps/web`.
- Authoritative simulation lives in `services/match` Colyseus rooms. Clients send input only.
- `packages/shared` owns protocol types and constants (tick 20 Hz, ante presets, first-to-3).
- Money moves only through `EscrowPort` + double-entry ledger. Never set a balance in place.
- One match = one room. Target: dozens of concurrent rooms per node.

## Rules (never violate)

- Ship **Gilt Round** before any other mode.
- Gilt Round: 2–6 players, first to 3 elims, winner takes the locked pot. 4:00 timeout → highest score; true tie splits.
- Currency is play-money Pot Credits. No fiat, no chain, no withdrawals.
- Keep `EscrowPort` swappable; do not leak ledger details into the room tick.
- Original IP only. Never use Golden Gun, GoldenEye, Bond, UFC, CoD, Need for Speed, Burnout, Twisted Metal, Wipeout, Tekken, TimeSplitters, SOCOM, CTR, or lookalike map/weapon/HUD names.
- No `any`. No client-trusted hits, scores, or wallets.
- Do not add modes, shops, voice, anti-cheat ML, or cosmetics until a 2-browser Gilt Round pays out correctly.

## Current build order

0. Scaffold monorepo + Compose + Prisma
1. Table + pot lock/refund/payout tests
2. Playable Drydock 09 (move, shoot, respawn, first-to-3, payout)
3. 6 players + lobby list + dummy load test

Stop at 2 unless asked.

## Reserved mode names (docs only)

Gilt Round · Breachfront · Chrono Split · Quiet Protocol · Cage Circuit · Bell Row · Iron Dojo · Titan Brawl · Redline Rush · Impact Lane · Night Grid · Wreck Crown · Pulse Rail · Drift Riot · Blacktop Siege · Ridge Fall
