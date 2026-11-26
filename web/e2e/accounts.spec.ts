import { createHmac } from "node:crypto";

import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

// The stack's mail catcher (docker-compose.yml): the emails people would receive land here.
const MAILPIT = process.env.MAILPIT_URL ?? "http://localhost:8025";

async function emailIds(request: APIRequestContext, to: string): Promise<string[]> {
  const found = await (await request.get(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`)).json();
  return (found.messages ?? []).map((m: { ID: string }) => m.ID);
}

/** The path of the link in the first email to this address that is not in `seen`. Waits for it.
 *  Compares message ids, not times, so clock differences between machines do not matter. */
async function linkFromEmail(request: APIRequestContext, to: string, seen: string[]): Promise<string> {
  for (let i = 0; i < 30; i++) {
    const fresh = (await emailIds(request, to)).find((id) => !seen.includes(id));
    if (fresh) {
      const message = await (await request.get(`${MAILPIT}/api/v1/message/${fresh}`)).json();
      const url = new URL(/https?:\/\/\S+token=[\w-]+/.exec(message.Text)![0]);
      return url.pathname + url.search;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`no email to ${to}`);
}

/** RFC 6238: the six digits an authenticator app would show for this secret now. */
function totp(secret: string, offsetSteps = 0): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const c of secret.replace(/\s/g, "")) bits += alphabet.indexOf(c).toString(2).padStart(5, "0");
  const key = Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)));
  const step = Buffer.alloc(8);
  step.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000) + offsetSteps));
  const mac = createHmac("sha1", key).update(step).digest();
  const offset = mac[mac.length - 1] & 15;
  return String((mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

async function signIn(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

test("an admin invites a nurse, who sets a password, turns on two-step sign-in and resets it", async ({ page, request }) => {
  const email = `taylor.${Date.now()}@example.test`;

  // The admin invites; the invitation link is also offered for copying.
  await page.goto("/login");
  await page.getByText("Exploring Indicium? Use a sample account").click();
  await page.getByRole("button", { name: /Casey Admin/ }).click();
  await page.getByRole("link", { name: "Admin", exact: true }).click();
  const inviting = page.getByRole("region", { name: "Invite a person" });
  await inviting.getByLabel("Full name").fill("Taylor Tester");
  await inviting.getByLabel("Work email").fill(email);
  await inviting.getByLabel("Role").selectOption("nurse");
  await inviting.getByRole("button", { name: "Send invitation" }).click();
  await expect(page.getByText(`Invitation sent to ${email}.`)).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: email })).toContainText("Invited");
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login/); // signing out has finished before the next step

  // The nurse opens the emailed link and chooses a password.
  await page.goto(await linkFromEmail(request, email, []));
  await expect(page.getByRole("heading", { name: "Welcome, Taylor" })).toBeVisible();
  await page.getByLabel("New password").fill("taylor-first-password");
  await page.getByLabel("The same password again").fill("taylor-first-password");
  await page.getByRole("button", { name: "Save password" }).click();
  await expect(page.getByText("Your password is set. Sign in with it.")).toBeVisible();
  await signIn(page, email, "taylor-first-password");
  await expect(page.getByRole("heading", { name: "Worklist" })).toBeVisible();

  // Two-step sign-in: scan (here: read) the key, confirm with a code.
  await page.getByRole("link", { name: /Taylor Tester|Your account/ }).click();
  await page.getByRole("button", { name: "Set up an authenticator app" }).click();
  const secret = (await page.locator("li", { hasText: "No camera?" }).locator(".code").textContent())!;
  await page.getByLabel("Enter the six-digit code the app shows").fill(totp(secret));
  await page.getByRole("button", { name: "Turn on two-step sign-in" }).click();
  await expect(page.getByText("Two-step sign-in is on.")).toBeVisible();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login/); // signing out has finished before the next step

  await signIn(page, email, "taylor-first-password");
  await page.getByLabel("Code from your authenticator app").fill(totp(secret, 1)); // the next code: each works once
  await page.getByRole("button", { name: "Verify and sign in" }).click();
  await expect(page.getByRole("heading", { name: "Worklist" })).toBeVisible();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login/); // signing out has finished before the next step

  // Forgotten password: the same answer for any address, a link by email, then a new password.
  const earlier = await emailIds(request, email);
  await page.goto("/login");
  await page.getByRole("link", { name: "Forgot your password?" }).click();
  // The sign-in page has an Email field too: wait for the reset page before filling.
  await expect(page.getByRole("heading", { name: "Reset your password" })).toBeVisible();
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Send the link" }).click();
  await expect(page.getByText(/If that address has an account/)).toBeVisible();
  await page.goto(await linkFromEmail(request, email, earlier));
  await expect(page.getByRole("heading", { name: "Choose a new password" })).toBeVisible();
  await page.getByLabel("New password").fill("taylor-second-password");
  await page.getByLabel("The same password again").fill("taylor-second-password");
  await page.getByRole("button", { name: "Save password" }).click();
  await expect(page.getByText("Your password is set. Sign in with it.")).toBeVisible();
  await signIn(page, email, "taylor-first-password");
  await expect(page.getByText("Wrong email or password")).toBeVisible();
});
