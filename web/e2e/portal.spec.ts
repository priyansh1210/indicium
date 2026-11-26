import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

const MAILPIT = process.env.MAILPIT_URL ?? "http://localhost:8025";

/** A random NPI with a valid check digit (Luhn over 80840 + the first nine digits). */
function randomNpi(): string {
  const body = "1" + String(Math.floor(Math.random() * 1e8)).padStart(8, "0");
  let total = 0;
  [..."80840" + body].reverse().forEach((c, i) => {
    const d = Number(c) * (i % 2 === 0 ? 2 : 1);
    total += d > 9 ? d - 9 : d;
  });
  return body + String((10 - (total % 10)) % 10);
}

async function newestLink(request: APIRequestContext, to: string): Promise<string> {
  for (let i = 0; i < 30; i++) {
    const found = await (await request.get(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`)).json();
    if (found.messages?.length) {
      const message = await (await request.get(`${MAILPIT}/api/v1/message/${found.messages[0].ID}`)).json();
      const url = new URL(/https?:\/\/\S+token=[\w-]+/.exec(message.Text)![0]);
      return url.pathname + url.search;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`no email to ${to}`);
}

async function sampleSignIn(page: Page, name: RegExp) {
  await page.goto("/login");
  await page.getByText("Exploring Indicium? Use a sample account").click();
  await page.getByRole("button", { name }).click();
}

test("a practice registers, confirms its email and sends a request", async ({ page, request }) => {
  const email = `desk.${Date.now()}@practice.example.test`;
  await page.goto("/login");
  await page.getByRole("link", { name: "Register your practice" }).click();
  await page.getByLabel("Practice name").fill("Harbor Family Medicine");
  await page.getByLabel("NPI").fill("1234567890");
  await page.getByLabel("Full name").fill("Robin Desk");
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill("harbor-practice-pass");
  await page.getByLabel("The same password again").fill("harbor-practice-pass");
  await page.getByRole("button", { name: "Register and confirm my email" }).click();
  await expect(page.getByText(/NPI is not valid/)).toBeVisible();
  await expect(page.getByLabel("Practice name")).toHaveValue("Harbor Family Medicine"); // nothing typed is lost
  await page.getByLabel("NPI").fill(randomNpi());
  await page.getByRole("button", { name: "Register and confirm my email" }).click();
  await expect(page.getByText(`Check ${email}`)).toBeVisible();

  await page.goto(await newestLink(request, email));
  await page.getByRole("button", { name: "Confirm my email address" }).click();
  await expect(page.getByText("Your email address is confirmed.")).toBeVisible();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill("harbor-practice-pass");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Requests" })).toBeVisible();
  await expect(page.getByText("No requests yet.")).toBeVisible();

  await page.getByRole("link", { name: "New request" }).first().click();
  await page.getByLabel("Member ID").fill("HFM-20931");
  await page.getByLabel("Full name").fill("Jordan Alvarez");
  await page.getByLabel("Date of birth").fill("1961-04-12");
  await page.getByLabel("Procedure code (CPT or HCPCS)").fill("72148");
  await page.getByLabel("Diagnosis codes (ICD-10)").fill("M54.16");
  await page.getByLabel("Ordering clinician").fill("Dr. Maya Chen");
  await page.getByLabel("Text", { exact: true }).fill(
    "Low back pain radiating to the left leg for eight weeks. Six weeks of physical therapy and NSAIDs without relief.",
  );
  await page.getByRole("button", { name: "Send request" }).click();
  await expect(page.getByText(/Request sent\. A decision is due in/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Jordan Alvarez" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "In review" })).toBeVisible();
  await expect(page.getByText("Request received")).toBeVisible();
});

test("a nurse pends a practice's request; the practice reads why and sends documents", async ({ page }) => {
  await sampleSignIn(page, /Avery Nurse/);
  const row = page.locator("tbody tr").first();
  const patient = (await row.locator("td a").textContent())!;
  await row.locator("td a").click();
  await page.getByText("Pend for information", { exact: true }).last().click();
  await page.getByLabel(/Reason \(sent with the decision/).fill("Please send the physical therapy notes from the last six weeks.");
  await page.getByRole("button", { name: "Record decision" }).click();
  await expect(page.getByText(/pended by Avery Nurse/i)).toBeVisible();
  await page.getByRole("button", { name: "Sign out" }).click();

  await sampleSignIn(page, /Sam Okafor/);
  await expect(page.getByRole("heading", { name: "Requests" })).toBeVisible();
  await page.getByRole("link", { name: patient }).first().click();
  await expect(page.getByRole("heading", { name: "Needs information" })).toBeVisible();
  await expect(page.locator("blockquote")).toContainText("Please send the physical therapy notes from the last six weeks.");
  await page.getByLabel("Text", { exact: true }).fill("PT discharge summary: twelve sessions over six weeks, pain 7/10 unchanged.");
  await page.getByRole("button", { name: "Send documents" }).click();
  await expect(page.getByText("Documents sent. The request is being reviewed again with them.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "In review" })).toBeVisible();
});
