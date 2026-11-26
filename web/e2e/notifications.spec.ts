import { expect, test, type Page } from "@playwright/test";

async function sampleSignIn(page: Page, name: RegExp) {
  await page.goto("/login");
  await page.getByText("Exploring Indicium? Use a sample account").click();
  await page.getByRole("button", { name }).click();
  await expect(page.getByRole("heading", { name: "Worklist" })).toBeVisible();
}

test("a nurse hears of a case handed to them, opens it, and clears the rest", async ({ page }) => {
  await sampleSignIn(page, /Morgan Supervisor/);
  const first = page.locator("tbody tr td a").first();
  const patient = (await first.textContent())!;
  await first.click();
  const picker = page.getByLabel("Assigned to");
  const avery = (await picker.locator("option", { hasText: "Avery Nurse" }).textContent())!;
  await Promise.all([page.waitForResponse((r) => r.request().method() === "POST"), picker.selectOption({ label: avery })]);
  await page.reload();
  await expect(picker.locator("option:checked")).toContainText("Avery Nurse");
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login/);

  await sampleSignIn(page, /Avery Nurse/);
  await page.getByRole("link", { name: /^Notifications, \d+ unread$/ }).click();
  await expect(page.getByRole("heading", { name: "Notifications", exact: true })).toBeVisible();
  const notice = page.getByRole("button", { name: new RegExp(`^${patient}'s request was given to you.*Unread$`) }).first();
  await notice.click();
  await expect(page).toHaveURL(/\/cases\/\d+/);
  await expect(page.getByRole("heading", { name: patient, exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Release" }).click(); // leave the case as it was
  await expect(page.getByText("Unassigned")).toBeVisible();

  await page.getByRole("link", { name: /^Notifications/ }).click();
  await expect(page.getByRole("heading", { name: "Notifications", exact: true })).toBeVisible();
  if (await page.getByRole("button", { name: "Mark all as read" }).isVisible()) {
    await page.getByRole("button", { name: "Mark all as read" }).click();
  }
  await expect(page.getByText("All read.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Notifications", exact: true })).toBeVisible();
});
