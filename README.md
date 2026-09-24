# Potlock

Lock in. Play. Winner takes the pot.

Potlock is a lobby plus short competitive match rooms. Players stake the same play-money
ante (Pot Credits, PC) into a pot, play one round, and the server pays the whole pot to the
winner. The first and only mode is **Gilt Round**: a first-person arena, first to 3 eliminations.

Status: Phase 1 (tables, ready, pot lock, forfeit, refund and payout, with tests). The 3D match is Phase 2.

## Run it

Requirements: Node 20+, pnpm 10, Docker.

```bash
cp .env.example .env
pnpm install
pnpm db:up        # docker compose up -d (Postgres 16 + Redis 7)
pnpm db:migrate
pnpm db:seed      # 8 dummy players with 2,000 PC each, password "potlock"
pnpm dev          # web :3000, game :5173, match :2567
pnpm test         # unit + ledger integration tests (uses the potlock_test database)
pnpm test:e2e     # two-browser end-to-end check (needs pnpm dev running)
```
