# Deploying Potlock

Potlock online is two Node services and one Postgres database:

| Piece | What it does | Build | Start |
|---|---|---|---|
| **web** | Lobby, accounts, balances, ledger (Next.js) | `pnpm build:web` | `pnpm start:web` |
| **match** | Match rooms over WebSockets, and it also serves the game client | `pnpm build:match` | `pnpm start:match` |
| **Postgres 16** | Accounts and the double-entry ledger | | |

Run `pnpm release` once per deploy before starting (it applies migrations and seeds the 8 demo players; both are
safe to repeat). Redis is optional: without `REDIS_URL` the match server keeps rooms in memory, which is right for
a single match node.

The match server needs a host that keeps a process running with WebSockets (Railway, Render, Fly.io). Serverless
hosts such as Vercel cannot run it, but they can run **web**.

## Settings

Generate each secret with `openssl rand -base64 32`. Never commit them.

**web**

| Variable | Value |
|---|---|
| `DATABASE_URL` | the Postgres connection string |
| `NEXTAUTH_SECRET` | a secret |
| `NEXTAUTH_URL` | the lobby's public address, e.g. `https://potlock-web.up.railway.app` (not needed on Vercel) |
| `MATCH_TOKEN_SECRET` | a secret, the same value as on match (16+ characters) |
| `MATCH_HTTP_URL` | the match server's address, e.g. `https://potlock-match.up.railway.app` |
| `GAME_URL` | the match server's public address (it serves the game) |

**match**

| Variable | Value |
|---|---|
| `DATABASE_URL` | the same Postgres connection string |
| `MATCH_TOKEN_SECRET` | the same secret as on web |
| `LOBBY_URL` | the lobby's public address (the game's "Back to lobby" link) |
| `NODE_ENV` | `production` |
| `REDIS_URL` | optional, only when running more than one match node |

Both services read `PORT` from the host. `GAME_URL`, `MATCH_HTTP_URL` and `LOBBY_URL` are read at runtime, so
changing a domain needs a restart, not a rebuild. The game client connects its socket to the address it was loaded
from, so it needs no settings of its own.

## Railway

1. New project from the GitHub repo, add a **Postgres** database.
2. Service **web**: build `pnpm build:web`, pre-deploy `pnpm release`, start `pnpm start:web`, generate a domain.
3. Service **match** (same repo): build `pnpm build:match`, start `pnpm start:match`, generate a domain.
4. Fill in the settings above (use `${{Postgres.DATABASE_URL}}` for the database).

## Render

Same shape: a Postgres instance and two **Web Services** from the repo, with the build and start commands above and
`pnpm release` as the web service's pre-deploy command.

## Vercel for the lobby

Import the repo with root directory `apps/web` and the settings for **web** above. Host **match** on Railway or
Render as described, and point `DATABASE_URL` on both at one hosted Postgres. Run `pnpm release` once against that
database from any machine with `DATABASE_URL` set.

## Check it

Open the lobby in a normal window and a private window, play as guest in both, open a 25 PC table in one and sit
down in the other, ready up and lock. Both balances drop by 25; the winner of the match gets +50.
