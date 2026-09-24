---
paths:
  - "**/*.test.ts"
  - "**/*.spec.ts"
  - "**/tests/**"
---

# Test Standards

- Name tests by behaviour: `describe('pot lock')` / `it('refunds every seat when one debit fails')`.
- Arrange, act, assert. One behaviour per test.
- Match-end logic is deterministic and covered: pot lock, lock failure refund, forfeit, first-to-3, timeout winner, true-tie split.
- Unit tests do not touch the network or a real database. Ledger integration tests use a disposable database and clean up.
- Assert ledger invariants, not just balances: every movement is a balanced double-entry pair and no pot pays out twice.
- Every bug fix gets a regression test, and you watch it fail on the unfixed code before trusting it.

<!-- Derived from Claude-Code-Game-Studios .claude/rules/test-standards.md (MIT, (c) 2026 Donchitos), rewritten for Potlock. -->
