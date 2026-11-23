// Captures the README screenshots from a running stack (node e2e/readme-screens.mjs).
// Not a test: it only takes pictures. The stack should have been reviewed by a language model.
import { chromium } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "http://localhost:8080";
const OUT = process.argv[2] ?? "../docs/images";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
page.setDefaultTimeout(120_000);

await page.goto(`${BASE}/welcome`);
await page.waitForTimeout(4500); // the intro, then the example walks to its second criterion
await page.screenshot({ path: `${OUT}/welcome.png` });

await page.goto(`${BASE}/login`);
await page.getByRole("button", { name: /Avery Nurse/ }).click();
await page.getByRole("heading", { name: "Worklist" }).waitFor();
await page.waitForTimeout(1200);
await page.screenshot({ path: `${OUT}/worklist.png` });

async function openPatient(name) {
  await page.goto(`${BASE}/?view=review`);
  await page.getByRole("link", { name }).click();
  await page.getByRole("heading", { name: /Checklist/ }).waitFor();
  await page.waitForTimeout(800); // the page's opening settle
}

await openPatient("Margaret Holloway");
await page.locator("article ul button").first().click();
await page.waitForTimeout(800);
await page.locator("#checklist-heading").scrollIntoViewIfNeeded();
await page.screenshot({ path: `${OUT}/case-review.png` });

await openPatient("Yvonne Castillo");
await page.screenshot({ path: `${OUT}/flagged-case.png` });

await page.goto(`${BASE}/policies`);
await page.getByRole("link", { name: "Version 1" }).nth(1).click();
await page.getByRole("heading", { name: "Policy text" }).waitFor();
await page.waitForTimeout(800);
await page.screenshot({ path: `${OUT}/policy.png` });

const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
await phone.context().addCookies(await page.context().cookies());
await phone.goto(`${BASE}/?view=review`);
await phone.getByRole("link", { name: "Margaret Holloway" }).click();
await phone.getByRole("heading", { name: /Checklist/ }).waitFor();
await phone.waitForTimeout(800);
await phone.screenshot({ path: `${OUT}/phone.png` });

await browser.close();
console.log("saved to", OUT);
