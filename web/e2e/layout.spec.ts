import { expect, test, type Page } from "@playwright/test";

// Every main screen fits its viewport: nothing scrolls sideways, at desktop and phone width.
async function fits(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

test("main screens fit the viewport", async ({ page }) => {
  await page.goto("/welcome");
  await fits(page);
  await page.goto("/login");
  await fits(page);
  await page.getByRole("button", { name: /Riley Viewer/ }).click();
  await expect(page.getByRole("heading", { name: "Worklist" })).toBeVisible();
  await fits(page);
  await page.locator("tbody tr td a").first().click();
  await expect(page.getByRole("heading", { name: /Checklist/ })).toBeVisible();
  await fits(page);
  await page.goto("/policies");
  await page.locator("main section a").first().click();
  await expect(page.getByRole("heading", { name: "Policy text" })).toBeVisible();
  await fits(page);
});
