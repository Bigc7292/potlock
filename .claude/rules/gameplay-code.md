---
paths:
  - "services/match/src/**"
  - "apps/game/src/**"
---

# Gameplay Code Rules

- Gameplay numbers (damage, mag size, reload, respawn delay, invuln, pickup timers, first-to-N, round timer)
  live in `packages/shared` constants, not inline literals, so server and client agree.
- Use delta time for all time-dependent logic on the client; the server steps at the fixed tick.
- Keep simulation logic pure and separate from rendering so it can be unit tested without Three.js or a browser.
- Room phases (`waiting | locked | countdown | live | ended`) use an explicit transition table. Reject illegal transitions.
- No gameplay state in UI code. The HUD reads state; it never owns it.

```ts
// Correct: shared constant, server-side check
if (weapon.ammo <= 0) return;
target.hp -= KESTREL.damage * falloff(distance);

// Incorrect: magic number, client-reported hit
if (msg.hit) target.hp -= 18;
```

<!-- Derived from Claude-Code-Game-Studios .claude/rules/gameplay-code.md (MIT, (c) 2026 Donchitos), rewritten for Potlock paths and stack. -->
