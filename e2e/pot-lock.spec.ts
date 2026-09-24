import { expect, test } from "@playwright/test";
import { balanceOf, guestPlayer } from "./helpers";

test("two players lock a 25 PC pot; the one who leaves forfeits it", async ({ browser }) => {
  const host = await guestPlayer(browser);
  const guest = await guestPlayer(browser);
  const hostStart = await balanceOf(host);
  const guestStart = await balanceOf(guest);

  await host.getByTestId("create-25").click();
  await expect(host.getByTestId("table-panel")).toBeVisible();

  await guest.reload();
  const row = guest.getByTestId("table-list").locator("li", { hasText: "25 PC" }).first();
  await row.getByRole("button", { name: "Sit down" }).click();
  await expect(guest.getByTestId("table-panel")).toBeVisible();

  await host.getByTestId("ready").click();
  await guest.getByTestId("ready").click();
  await expect(host.getByTestId("lock")).toBeEnabled();
  await host.getByTestId("lock").click();
  await expect(host.getByTestId("countdown")).toBeVisible();

  // Leaving after the lock is a forfeit: the host takes the whole pot.
  await guest.close();
  await expect(host.getByTestId("payout")).toHaveText("+50 PC", { timeout: 20_000 });

  await host.getByTestId("back").click();
  await expect(host.getByTestId("balance")).toBeVisible();
  expect(await balanceOf(host)).toBe(hostStart + 25);
  await host.reload();
  const ledger = host.getByTestId("ledger");
  await expect(ledger).toContainText("Pot won");
  await expect(ledger).toContainText("Ante locked in pot");
  expect(guestStart).toBe(2000);
});
