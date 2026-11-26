import { expect, test, type Page } from "@playwright/test";

async function sampleSignIn(page: Page, name: RegExp) {
  await page.goto("/login");
  await page.getByText("Exploring Indicium? Use a sample account").click();
  await page.getByRole("button", { name }).click();
  await expect(page.getByRole("heading", { name: "Worklist" })).toBeVisible();
}

test("a supervisor reads the queue and the decisions; a nurse has no dashboard", async ({ page }) => {
  await sampleSignIn(page, /Morgan Supervisor/);
  await page.getByRole("link", { name: "Dashboard" }).click();
  await expect(page.getByRole("heading", { name: "Dashboard", exact: true })).toBeVisible();
  for (const tile of ["Open cases", "Past the deadline", "Due in 24 hours", "Unassigned", "Decided on time"]) {
    await expect(page.getByText(tile, { exact: true })).toBeVisible();
  }
  // Every day is reachable by keyboard and says its count; the table holds the same values.
  const today = page.getByRole("img", { name: /Decisions per day/ }).locator("rect[tabindex='0']").last();
  await today.focus();
  await expect(page.getByRole("status").filter({ hasText: /decision/ })).toBeVisible();
  await page.getByText("Show as a table").click();
  await expect(page.getByRole("columnheader", { name: "Approved" }).first()).toBeVisible();
  await page.getByRole("link", { name: "7 days" }).click();
  await expect(page).toHaveURL(/days=7/);
  await expect(page.getByText(/in the last 7 days/).first()).toBeVisible();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login/);

  await sampleSignIn(page, /Avery Nurse/);
  await expect(page.getByRole("link", { name: "Dashboard" })).toHaveCount(0);
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
});
