import { expect, test, type Page } from "@playwright/test";
import { DRYDOCK_09, MOVEMENT, firstMapHit, type Snapshot, type Vec3 } from "../packages/shared/src/index.js";
import { balanceOf, guestPlayer } from "./helpers";

/**
 * Definition of done, end to end: two browsers, 25 PC table, lock, both drop 25, a real match
 * to 3 eliminations over the network, winner +50, loser stays down 25, ledger after refresh.
 *
 * Each browser is steered through the dev-only automation hook in the game client, which feeds the
 * same input pipeline as keyboard and mouse. The server still decides every hit and payout.
 */

interface DebugState {
  me: string;
  s: Snapshot | null;
  pos: Vec3 | null;
}

async function readState(page: Page): Promise<DebugState | null> {
  return page.evaluate(() => {
    const d = (window as unknown as { __potlock?: { me: string; snapshot: () => unknown; position: () => unknown } }).__potlock;
    if (!d) return null;
    return { me: d.me, s: d.snapshot(), pos: d.position() } as never;
  });
}

async function steer(page: Page, override: Record<string, number | boolean> | null, fire: boolean): Promise<void> {
  await page.evaluate(
    ([o, f]) => {
      const d = (window as unknown as { __potlock: { setOverride: (x: unknown) => void; pulse: (k: string) => void } }).__potlock;
      d.setOverride(o);
      if (f) d.pulse("fire");
    },
    [override, fire] as const,
  );
}

/** Hand-authored walk routes from each spawn into the open lane (z = 0). */
function routeFrom(spawn: Vec3): Vec3[] {
  const key = `${spawn.x},${spawn.z}`;
  const routes: Record<string, [number, number][]> = {
    "10,6": [[10, 0]],
    "-10,-6": [[-10, 0]],
    "-20,12": [[-16, 12], [-16, 0]],
    "20,-12": [[16, -12], [16, 0]],
    "-6.5,14.5": [[-5, 14.5], [-5, 0]],
    "6.5,-14.5": [[5, -14.5], [5, 0]],
  };
  return (routes[key] ?? []).map(([x, z]) => ({ x, y: 0, z }));
}

function nearestSpawn(p: Vec3): Vec3 {
  let best = DRYDOCK_09.spawns[0]!.position;
  for (const s of DRYDOCK_09.spawns) {
    if (Math.hypot(s.position.x - p.x, s.position.z - p.z) < Math.hypot(best.x - p.x, best.z - p.z)) best = s.position;
  }
  return best;
}

class Bot {
  private route: Vec3[] = [];
  private wasAlive = false;
  constructor(
    readonly page: Page,
    private readonly shooter: boolean,
  ) {}

  async step(): Promise<Snapshot | null> {
    const st = await readState(this.page);
    const s = st?.s;
    if (!st || !s) return null;
    const me = s.players.find((p) => p.userId === st.me);
    const foe = s.players.find((p) => p.userId !== st.me);
    if (s.phase !== "live" || !me || !foe || !st.pos) {
      await steer(this.page, null, false);
      return s;
    }
    if (!me.alive) {
      this.wasAlive = false;
      await steer(this.page, { forward: 0, strafe: 0 }, false);
      return s;
    }
    if (!this.wasAlive) {
      this.route = routeFrom(nearestSpawn(st.pos));
      this.wasAlive = true;
    }
    const eye = { x: st.pos.x, y: st.pos.y + MOVEMENT.eyeHeight, z: st.pos.z };
    const aimPoint = { x: foe.x, y: foe.y + 1.1, z: foe.z };
    const d = { x: aimPoint.x - eye.x, y: aimPoint.y - eye.y, z: aimPoint.z - eye.z };
    const dist = Math.hypot(d.x, d.y, d.z);
    const dir = { x: d.x / dist, y: d.y / dist, z: d.z / dist };
    const clear = foe.alive && firstMapHit(eye, dir, dist, DRYDOCK_09.boxes) >= dist - 0.5;
    const yawTo = (p: Vec3) => Math.atan2(-(p.x - st.pos!.x), -(p.z - st.pos!.z));

    if (this.shooter && clear) {
      const pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
      await steer(this.page, { forward: 0, strafe: 0, yaw: yawTo(aimPoint), pitch }, true);
      return s;
    }
    // Walk the route into the lane, then along the lane towards the opponent.
    // The non-shooting player stops in the open once it can see the shooter.
    if (!this.shooter && clear && !this.route[0]) {
      await steer(this.page, { forward: 0, strafe: 0, yaw: yawTo(aimPoint), pitch: 0 }, false);
      return s;
    }
    while (this.route[0] && Math.hypot(this.route[0].x - st.pos.x, this.route[0].z - st.pos.z) < 1) this.route.shift();
    const goal = this.route[0] ?? { x: foe.x, y: 0, z: 0 };
    const near = !this.route[0] && Math.abs(foe.x - st.pos.x) < 4;
    await steer(this.page, { forward: near ? 0 : 1, strafe: 0, yaw: yawTo(goal), pitch: 0 }, false);
    return s;
  }
}

// Software WebGL in headless Chrome is slow; a smaller canvas keeps the automation responsive.
test.use({ viewport: { width: 800, height: 500 } });

test("two browsers play Gilt Round to 3 eliminations and the winner takes the 25 PC pot", async ({ browser }) => {
  const host = await guestPlayer(browser);
  const guest = await guestPlayer(browser);
  const hostStart = await balanceOf(host);
  const guestStart = await balanceOf(guest);

  await host.getByTestId("create-25").click();
  await expect(host.getByTestId("table-panel")).toBeVisible();
  await guest.reload();
  await guest.getByTestId("table-list").locator("li", { hasText: "25 PC" }).first().getByRole("button", { name: "Sit down" }).click();
  await expect(guest.getByTestId("table-panel")).toBeVisible();

  await host.getByTestId("ready").click();
  await guest.getByTestId("ready").click();
  await host.getByTestId("lock").click();
  await expect(host.getByTestId("countdown")).toBeVisible();

  // Both balances drop by the ante as soon as the pot locks.
  const lobbyCheck = await host.context().newPage();
  await lobbyCheck.goto("/");
  expect(await balanceOf(lobbyCheck)).toBe(hostStart - 25);
  await lobbyCheck.close();

  const shooter = new Bot(host, true);
  const walker = new Bot(guest, false);
  const deadline = Date.now() + 150_000;
  let last: Snapshot | null = null;
  let shots = 0;
  while (Date.now() < deadline) {
    const [a] = await Promise.all([shooter.step(), walker.step()]);
    if (a) last = a;
    if (process.env.E2E_TRACE && a && a.tick % 20 === 0) {
      console.log(
        a.phase,
        a.seats.map((x) => `${x.name}:${x.score}`).join(" "),
        a.players.map((p) => `${p.x.toFixed(1)},${p.z.toFixed(1)} hp${p.hp}${p.alive ? "" : " dead"} ack${p.ackSeq}`).join(" | "),
      );
    }
    if (a?.phase === "live" && shots < 2 && a.serverTime - (a.liveEndsAt ?? 0) + 240_000 > 2500 + shots * 9000) {
      await Promise.all([
        host.screenshot({ path: `test-results/live-host-${shots}.png` }),
        guest.screenshot({ path: `test-results/live-guest-${shots}.png` }),
      ]);
      shots++;
    }
    if (last?.phase === "ended") break;
    await host.waitForTimeout(80);
  }
  expect(last?.phase).toBe("ended");
  await steer(host, null, false);

  await expect(host.getByTestId("payout")).toHaveText("+50 PC", { timeout: 15_000 });
  await expect(guest.getByTestId("payout")).toHaveText("+0 PC");
  await host.screenshot({ path: "test-results/result-winner.png" });

  await host.getByTestId("back").click();
  await guest.getByTestId("back").click();
  await host.reload();
  await guest.reload();
  expect(await balanceOf(host)).toBe(hostStart + 25);
  expect(await balanceOf(guest)).toBe(guestStart - 25);
  await expect(host.getByTestId("ledger")).toContainText("Pot won");
  await expect(guest.getByTestId("ledger")).toContainText("Ante locked in pot");
  await host.screenshot({ path: "test-results/lobby-ledger.png", fullPage: true });
});
