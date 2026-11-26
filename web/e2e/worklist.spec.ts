import { expect, test, type Page } from "@playwright/test";

async function sampleSignIn(page: Page, name: RegExp) {
  await page.goto("/login");
  await page.getByText("Exploring Indicium? Use a sample account").click();
  await page.getByRole("button", { name }).click();
  await expect(page.getByRole("heading", { name: "Worklist" })).toBeVisible();
}

test("a nurse searches, takes a case, finds it under Mine and releases it", async ({ page }) => {
  await sampleSignIn(page, /Avery Nurse/);
  const first = page.locator("tbody tr").first();
  const patient = (await first.locator("td a").textContent())!;

  await page.getByRole("searchbox", { name: "Search cases" }).fill(patient.split(" ").at(-1)!);
  await page.getByRole("searchbox", { name: "Search cases" }).press("Enter");
  await expect(page.locator("tbody tr").filter({ hasText: patient })).toHaveCount(1);
  await page.getByRole("searchbox", { name: "Search cases" }).fill("nobody by this name");
  await page.getByRole("searchbox", { name: "Search cases" }).press("Enter");
  await expect(page.getByText("No case matches.")).toBeVisible();
  await page.getByRole("link", { name: "Clear them" }).click();

  await page.getByRole("link", { name: patient }).click();
  await page.getByRole("button", { name: "Take this case" }).click();
  await expect(page.getByText("Assigned to you")).toBeVisible();
  await page.getByRole("link", { name: "Worklist" }).first().click();
  await page.getByRole("link", { name: "Mine" }).click();
  await expect(page.locator("tbody tr").filter({ hasText: patient })).toContainText("You");

  await page.getByRole("link", { name: patient }).click();
  await page.getByRole("button", { name: "Release" }).click();
  await expect(page.getByText("Unassigned")).toBeVisible();
});

test("a supervisor hands a case to a reviewer, seeing their workload", async ({ page }) => {
  await sampleSignIn(page, /Morgan Supervisor/);
  await page.locator("tbody tr td a").first().click();
  const picker = page.getByLabel("Assigned to");
  await expect(picker).toContainText(/Avery Nurse \(nurse\), \d+ open/);
  await picker.selectOption({ label: (await picker.locator("option", { hasText: "Avery Nurse" }).textContent())! });
  await page.waitForLoadState("networkidle");
  await page.reload(); // the choice is saved, not just shown
  await expect(picker.locator("option:checked")).toContainText("Avery Nurse");
  await picker.selectOption("");
  await page.waitForLoadState("networkidle");
  await page.reload();
  await expect(picker.locator("option:checked")).toHaveText("Nobody");
});
