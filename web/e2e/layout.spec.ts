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
  await page.getByText("Exploring Indicium? Use a sample account").click();
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

test("account and administration screens fit the viewport", async ({ page }) => {
  await page.goto("/login");
  await page.getByText("Exploring Indicium? Use a sample account").click();
  await page.getByRole("button", { name: /Casey Admin/ }).click();
  await expect(page.getByRole("heading", { name: "Worklist" })).toBeVisible();
  for (const path of ["/account", "/admin/people", "/admin/api-keys", "/admin/activity", "/policies"]) {
    await page.goto(path);
    await expect(page.locator("h1")).toBeVisible();
    await fits(page);
  }
  for (const path of ["/forgot-password", "/set-password?token=expired-or-wrong"]) {
    await page.context().clearCookies();
    await page.goto(path);
    await fits(page);
  }
});

test("provider portal screens fit the viewport", async ({ page }) => {
  await page.goto("/register");
  await fits(page);
  await page.goto("/login");
  await page.getByText("Exploring Indicium? Use a sample account").click();
  await page.getByRole("button", { name: /Sam Okafor/ }).click();
  await expect(page.getByRole("heading", { name: "Requests", exact: true })).toBeVisible();
  await fits(page);
  await page.locator("main ul li a").first().click();
  await expect(page.getByRole("heading", { name: "History" })).toBeVisible();
  await fits(page);
  for (const path of ["/portal/new", "/portal/team", "/account"]) {
    await page.goto(path);
    await expect(page.locator("h1")).toBeVisible();
    await fits(page);
  }
});
