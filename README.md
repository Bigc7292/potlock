# Potlock

Lock in. Play. Winner takes the pot.

Potlock is a lobby plus short competitive match rooms. Players stake the same play-money ante
(Pot Credits, PC) into a pot, play one round, and the server pays the whole pot to the winner.
The first and only mode is **Gilt Round**: a first-person arena on Drydock 09, first to 3
eliminations takes the pot.

Pot Credits are play money. They cannot be bought, withdrawn or exchanged. There is no rake.

## Run it

Requirements: Node 20+, pnpm 10, Docker.

```bash
cp .env.example .env
pnpm install
pnpm db:up        # docker compose up -d: Postgres 16 + Redis 7
pnpm db:migrate
pnpm db:seed      # 8 dummy players with 2,000 PC each (vesper_k, rook, mako, juniper, cinder, halyard, quill, sable; password "potlock")
pnpm dev          # web http://localhost:3000, game http://localhost:5173, match ws://localhost:2567
```

### Play a pot match in two browsers

Sessions are cookies, so use two separate sessions: one normal window and one private window,
or two different browsers.

1. Open http://localhost:3000 in both. Sign in (seeded players above), create an account, or press **Play as guest**.
   Every new account starts with 2,000 PC.
2. In the first window press **25 PC** under *New table*. You are seated as host.
3. In the second window the table shows up in the list; press **Sit down**.
4. Both press **Ready**. The host presses **Lock pot** (or it auto-locks 20 seconds after two players are ready).
   Both balances drop by 25 and the pot shows 50 PC.
5. After the 5-second freeze, click the view to capture the mouse and fight:
   **WASD** move, **mouse** aim, **Space** jump, **Shift** walk, **left click** fire, **R** reload, **E** pick up the Auric Lance.
6. First to 3 eliminations wins. The results screen shows **+50 PC** for the winner.
   **Back to lobby** shows the new balance, and the ledger lists the ante and the payout (refresh any time).

## Put it online

See [DEPLOY.md](DEPLOY.md): two Node services (lobby and match server) plus Postgres, on Railway, Render,
or Vercel for the lobby with the match server elsewhere.

## Tests

```bash
pnpm test        # unit + integration: table rules, combat sim, room over real sockets, ledger on Postgres
pnpm typecheck
pnpm test:e2e    # two headless browsers play a full match to payout (needs pnpm dev running)
```

The ledger tests use a separate `potlock_test` database (`TEST_DATABASE_URL`), created and migrated automatically.
If Playwright cannot find its browser, set `PW_CHROMIUM_PATH` to a Chromium binary.

## Layout

```
apps/web          Next.js 15 lobby: accounts (NextAuth credentials + guest), tables, balance, ledger history
apps/game         Vite + Three.js client: table screen, Drydock 09, prediction, HUD, results
services/match    Colyseus server: one gilt_round room per table, Redis presence + driver, GET /tables
  src/table/      GiltRoundTable: seats, ready, lock, phases, forfeit, end rules, settlement
  src/sim/        GameSim: 20 Hz movement, Kestrel Sidearm, Auric Lance, respawns
packages/shared   protocol types, constants, EscrowPort, Drydock 09 geometry, shared movement
packages/db       Prisma schema, double-entry ledger, PrismaEscrow, match log, seed
e2e/              Playwright two-browser checks
```

## How it works

- **Server authority.** Clients send input commands only (move, aim, fire, reload, pick up). The match room
  simulates at 20 Hz, decides every hit, score and phase, and broadcasts snapshots. The client predicts its own
  movement with the same shared code and reconciles against snapshots; other players are interpolated.
- **Phases.** `waiting → locked → countdown → live → ended`, with an explicit transition table.
- **Money.** The room only calls `EscrowPort` (`hold`, `releaseToWinner`, `splitEven`, `refundAll`). The Postgres
  adapter posts balanced double-entry transactions: every balance change has ledger entries in the same database
  transaction, debits are guarded so nothing goes negative, a pot can be settled once, and `hold` is all or
  nothing. A future chain adapter can implement the same interface without touching the room.
- **Rules.** First to 3 eliminations takes the pot. At 4:00 the highest score wins; a true tie splits the pot evenly
  (any leftover credit goes to the tied players in seat order). Leaving after the lock is a forfeit; if one player
  remains, they win. A pot that never plays out is refunded.
- **Identity.** The lobby mints a short-lived signed match token; the room verifies it and never trusts a user id
  from the client.

## Gilt Round numbers

| | |
|---|---|
| Players | 2 to 6, free-for-all |
| Health | 100, no armour |
| Kestrel Sidearm | hitscan, 18 damage (mild falloff after 7.5 m), 8-round mag, 1.4 s reload |
| Auric Lance | pedestal spawn every 25 s while unheld, 1 shot, 999 damage, 0.35 s visible charge, dropped on death |
| Respawn | 2.5 s, far from threats, 0.8 s invulnerable |
| Timer | 4:00 safety limit |

## Roadmap (names reserved, not implemented)

Each future mode is a new Colyseus room class and client scene on the same pot engine.
Breachfront · Chrono Split · Quiet Protocol · Cage Circuit · Bell Row · Iron Dojo · Titan Brawl · Redline Rush ·
Impact Lane · Night Grid · Wreck Crown · Pulse Rail · Drift Riot · Blacktop Siege · Ridge Fall

All names, maps, weapons and art are original.
