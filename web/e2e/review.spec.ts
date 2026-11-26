import { expect, test, type Page } from "@playwright/test";

async function signInAs(page: Page, name: string) {
  await page.goto("/login");
  await page.getByText("Exploring Indicium? Use a sample account").click();
  await page.getByRole("button", { name: new RegExp(name) }).click();
  await expect(page.getByRole("heading", { name: "Worklist" })).toBeVisible();
}

test("signing in is required", async ({ page }) => {
  await page.goto("/policies");
  await expect(page).toHaveURL(/\/login\?next=%2Fpolicies/);
});

test("a nurse corrects an item and refers; a physician denies", async ({ page }) => {
  await signInAs(page, "Avery Nurse");
  const row = page.locator("tbody tr").filter({ hasText: "Lumbar MRI" }).first();
  const patient = (await row.locator("td a").textContent())!;
  await row.locator("td a").click();
  await expect(page.getByRole("heading", { name: patient })).toBeVisible();

  // Choosing a quoted passage marks the same sentence in the document.
  const quote = page.locator("article ul button").first();
  await quote.click();
  await expect(page.locator('mark.evidence[data-active="true"]').first()).toBeVisible();

  // Correct one item with a reason; the correction is shown with who made it.
  await page.getByRole("button", { name: "Correct this item" }).first().click();
  await page.getByRole("radio", { name: "Documented" }).first().check();
  await page.getByLabel("Reason (kept in the audit trail)").fill("Red flag confirmed on phone with the office");
  await page.getByRole("button", { name: "Save correction" }).click();
  await expect(page.getByText(/Avery Nurse set this to/)).toBeVisible();

  // A nurse refers; denying is not offered to a nurse at all.
  await expect(page.getByText("Deny", { exact: true })).toHaveCount(0);
  await page.getByText("Refer to a physician", { exact: true }).last().click();
  await page.getByLabel(/Reason \(sent with the decision/).fill("Needs physician review of the red flag");
  await page.getByRole("button", { name: "Record decision" }).click();
  await expect(page.getByText("With physician")).toBeVisible();
  await expect(page.getByText("A physician reviewer decides referred cases.")).toBeVisible();

  // The physician finds it in their queue and denies it, with a reason.
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login/); // signing out has finished before the next step
  await signInAs(page, "Jordan Physician");
  await page.getByRole("link", { name: patient }).click();
  await page.getByText("Deny", { exact: true }).click();
  await page.getByLabel(/Reason \(sent with the decision/).fill("Imaging not indicated without a red flag");
  await page.getByRole("button", { name: "Record decision" }).click();
  await expect(page.getByText(/denied by Jordan Physician \(physician\)/i)).toBeVisible();

  // Everything above is in the audit trail.
  await page.getByText(/Audit trail/).click();
  for (const action of ["checklist overridden", "case.referred", "case.denied"]) {
    await expect(page.getByText(action.replace(".", " ").replace("_", " "), { exact: false }).first()).toBeVisible();
  }
});

test("a viewer can read a case but not decide it", async ({ page }) => {
  await signInAs(page, "Riley Viewer");
  await page.locator("tbody tr td a").first().click();
  await expect(page.getByText("Your role can read this case but not decide it.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Record decision" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Correct this item" })).toHaveCount(0);
});
