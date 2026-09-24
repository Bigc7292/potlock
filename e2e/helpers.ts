import { expect, type Browser, type Page } from "@playwright/test";

/** A fresh browser context is a separate cookie jar: one context = one signed-in player. */
export async function guestPlayer(browser: Browser): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/");
  await page.getByTestId("guest-button").click();
  await expect(page.getByTestId("balance")).toBeVisible();
  return page;
}

export async function balanceOf(page: Page): Promise<number> {
  const text = (await page.getByTestId("balance").innerText()).replace(/[^0-9]/g, "");
  return Number(text);
}
