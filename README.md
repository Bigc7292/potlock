# Potlock

Lock in. Play. Winner takes the pot.

Potlock is a lobby plus short competitive match rooms. Players stake the same play-money
ante (Pot Credits, PC) into a pot, play one round, and the server pays the whole pot to the
winner. The first and only mode is **Gilt Round**: a first-person arena, first to 3 eliminations.

Status: Phase 0 scaffold (monorepo, Compose, Prisma ledger schema, empty lobby, Colyseus hello room).

## Run it

Requirements: Node 20+, pnpm 10, Docker.

```bash
cp .env.example .env
pnpm install
pnpm db:up        # docker compose up -d (Postgres 16 + Redis 7)
pnpm db:migrate
pnpm db:seed      # 8 dummy players with 2,000 PC each, password "potlock"
pnpm dev          # web :3000, game :5173, match :2567
pnpm test
```
