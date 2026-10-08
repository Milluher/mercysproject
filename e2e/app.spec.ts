import { expect, test, type Page } from "@playwright/test";

// Demo accounts from src/lib/seed.ts.
const ADMIN = { email: "admin@demo.fund", password: "demo-admin-password" };
const RAVI = { email: "ravi@cargoline.example", password: "demo-founder-password" }; // founder of Cargoline

async function signIn(page: Page, who: { email: string; password: string }, path = "/login", { expectSuccess = true } = {}) {
  await page.goto(path);
  await page.getByLabel("Email").fill(who.email);
  await page.getByLabel("Password", { exact: true }).fill(who.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  if (expectSuccess) await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

const heading = (page: Page) => page.getByRole("heading", { level: 1 });

test.describe("signed out", () => {
  for (const path of ["/", "/people", "/requests", "/company/1", "/submit?request=1"]) {
    test(`${path} asks to sign in`, async ({ page }) => {
      await page.goto(path);
      await expect(page).toHaveURL(/\/login/);
      await expect(heading(page)).toHaveText("Sign in");
      await expect(page.getByText("Lumen Health")).toHaveCount(0);
    });
  }

  test("wrong password is rejected", async ({ page }) => {
    await signIn(page, { email: RAVI.email, password: "not the password" }, "/login", { expectSuccess: false });
    await expect(page.getByText("Incorrect email or password")).toBeVisible();
  });

  test("setup is closed once an admin exists", async ({ page }) => {
    await page.goto("/setup");
    await expect(heading(page)).toHaveText("Setup is complete");
  });
});

test.describe("founder", () => {
  test("only sees their own company, and stays signed in after a reload", async ({ page }) => {
    await signIn(page, RAVI);
    await expect(page).toHaveURL(/\/submit$/);
    await expect(heading(page)).toHaveText("Cargoline");
    const nav = page.getByRole("navigation");
    await expect(nav.getByRole("link")).toHaveText([/Submit update/, /My company/, /Account/]);

    await page.reload();
    await expect(heading(page)).toHaveText("Cargoline");

    await nav.getByRole("link", { name: /My company/ }).click();
    await expect(heading(page)).toHaveText("Cargoline");
    await expect(page.getByText("ownership")).toHaveCount(0); // the fund's investment details
    await expect(page.getByText(/Critical|Serious/)).toHaveCount(0); // the fund's warning signs
  });

  test("gets a 404 for the fund's pages and other companies", async ({ page }) => {
    await signIn(page, RAVI);
    await expect(heading(page)).toHaveText("Cargoline");
    for (const path of ["/people", "/requests", "/company/1"]) {
      await page.goto(path);
      await expect(page.getByText("Page not found")).toBeVisible();
    }
    await page.goto("/");
    await expect(page).toHaveURL(/\/submit$/);
  });

  test("lands on the request link after signing in, and submits for their own company", async ({ page }) => {
    await page.goto("/submit?request=2"); // the Q3 board pack
    await expect(page).toHaveURL(/\/login\?next=/);
    await page.getByLabel("Email").fill(RAVI.email);
    await page.getByLabel("Password", { exact: true }).fill(RAVI.password);
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(heading(page)).toHaveText("Q3 board pack");
    await expect(page.getByLabel("Company")).toHaveCount(0); // the company comes from the account
    await page.getByLabel("Cash in bank at month end ($)").fill("1050000");
    await page.getByLabel("Gross margin (%)").fill("41.5");
    await page.getByLabel("Net promoter score").fill("38");
    await page.getByLabel("Biggest risk next quarter").fill("Fuel prices");
    await page.getByRole("button", { name: "Submit" }).click();
    await expect(page.getByText("Thanks! Your figures have been received.")).toBeVisible();
  });

  test("a request for another company isn't shown", async ({ page }) => {
    await signIn(page, RAVI, "/login?next=%2Fsubmit%3Frequest%3D999");
    await expect(page.getByText("isn't for your company")).toBeVisible();
  });
});

test.describe("fund admin", () => {
  test("sees the overview with warning signs", async ({ page }) => {
    await signIn(page, ADMIN);
    await expect(heading(page)).toHaveText("Portfolio KPI dashboard");
    await expect(page.getByText(/Critical — Cargoline/)).toBeVisible();
    await expect(page.getByRole("row")).toHaveCount(9); // header + 8 companies
  });

  test("sees Cargoline's answer to the board pack", async ({ page }) => {
    await signIn(page, ADMIN);
    await page.goto("/requests");
    const boardPack = page.locator("article", { hasText: "Q3 board pack" });
    await expect(boardPack.getByText("6 of 8 companies responded")).toBeVisible();
    await expect(boardPack.getByRole("row", { name: /Cargoline/ })).toContainText("Fuel prices");
  });

  test("adds a custom metric and a request using it", async ({ page }) => {
    await signIn(page, ADMIN);
    await page.goto("/requests");
    await page.getByText(/Custom metrics/).click();
    await page.getByLabel("Metric name").fill("Monthly active users");
    await page.getByRole("button", { name: "Add metric" }).click();
    await expect(page.getByText("Added “Monthly active users”.")).toBeVisible();

    await page.getByLabel("Title").fill("Usage check");
    for (const box of await page.locator('input[name="fields"]').all()) await box.uncheck();
    await page.getByLabel("Monthly active users").check();
    await page.getByRole("button", { name: "Create request" }).click();
    await expect(page.getByText("Created “Usage check”")).toBeVisible();
    await expect(page.locator("article", { hasText: "Usage check" }).getByText("Metrics: Monthly active users")).toBeVisible();
  });

  test("invites a founder who sets a password and only sees their company", async ({ page, browser }) => {
    await signIn(page, ADMIN);
    await page.goto("/people");
    await page.getByLabel("Name", { exact: true }).fill("Priya Shah");
    await page.getByLabel("Email").fill("priya@pathwise.example");
    await page.getByLabel("Company (founders only)").selectOption({ label: "Pathwise" });
    await page.getByRole("button", { name: "Add and create invite link" }).click();
    const link = await page.getByRole("textbox", { name: "Link" }).inputValue();
    expect(link).toMatch(/\/invite\?token=/);

    const invitee = await (await browser.newContext()).newPage();
    await invitee.goto(link);
    await expect(heading(invitee)).toHaveText("Welcome, Priya");
    await invitee.getByLabel("New password").fill("priyas password 1");
    await invitee.getByLabel("Confirm password").fill("priyas password 1");
    await invitee.getByRole("button", { name: "Set password and sign in" }).click();
    await expect(heading(invitee)).toHaveText("Pathwise");

    await invitee.goto(link); // single use
    await expect(invitee.getByText("isn't valid any more")).toBeVisible();
  });

  test("deactivating a founder signs them out at once", async ({ page, browser }) => {
    const founder = await (await browser.newContext()).newPage();
    await signIn(founder, { email: "noor@pathwise.example", password: "demo-founder-password" });
    await expect(heading(founder)).toHaveText("Pathwise");

    await signIn(page, ADMIN);
    await page.goto("/people");
    await page.locator("li", { hasText: "noor@pathwise.example" }).getByRole("button", { name: "Deactivate" }).click();
    await expect(page.locator("li", { hasText: "noor@pathwise.example" }).getByText("Deactivated")).toBeVisible();

    await founder.reload();
    await expect(heading(founder)).toHaveText("Sign in");
  });

  test("signs out", async ({ page }) => {
    await signIn(page, ADMIN);
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(heading(page)).toHaveText("Sign in");
    await page.goto("/");
    await expect(page).toHaveURL(/\/login/);
  });
});
