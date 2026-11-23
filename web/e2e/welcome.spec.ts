import { expect, test } from "@playwright/test";

test("a visitor without a session lands on the welcome page and can open the demo", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/welcome$/);
  await expect(page.getByRole("heading", { level: 1, name: "Every criterion points at its evidence." })).toBeVisible();

  // Both example quotes are found in the example note (positions are computed, not typed).
  await expect(page.locator("mark.evidence")).toHaveCount(2);
  // The example behaves like the review screen: choosing a criterion marks its sentence.
  await page.getByRole("button", { name: /Unsuccessful non-surgical management/ }).click();
  await expect(page.locator('mark.evidence[data-active="true"]').first()).toContainText("two corticosteroid injections");
  await page.getByRole("button", { name: /active infection/ }).click();
  await expect(page.locator('mark.evidence[data-active="true"]')).toHaveCount(0);
  await expect(page.getByText("No sentence shows an infection.", { exact: false })).toBeVisible();

  await page.getByRole("link", { name: "Open the demo" }).first().click();
  await expect(page).toHaveURL(/\/login$/);
});

test("other pages still ask to sign in first", async ({ page }) => {
  await page.goto("/?view=referred");
  await expect(page).toHaveURL(/\/login\?next=%2F%3Fview%3Dreferred/);
});
