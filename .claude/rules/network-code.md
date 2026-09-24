---
paths:
  - "services/match/**"
  - "packages/shared/**"
  - "apps/game/src/net/**"
---

# Network Code Rules

- The Colyseus room is AUTHORITATIVE for hits, scores, phase and pot state. Clients send input only.
- Every message type is a shared type in `packages/shared`. No `any`, no untyped payloads.
- Simulate and snapshot at the shared tick rate (20 Hz). Clients interpolate; they never decide outcomes.
- Validate every incoming input: size, field ranges, rate. Drop and log (rate-limited) anything out of range.
- A disconnect after pot lock is a forfeit. Handle leave, reconnect window and room disposal explicitly.
- Keep ledger and database details out of the room tick. Money moves only through `EscrowPort`.

<!-- Derived from Claude-Code-Game-Studios .claude/rules/network-code.md (MIT, (c) 2026 Donchitos), rewritten for Potlock paths and stack. -->
