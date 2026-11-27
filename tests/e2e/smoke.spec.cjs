const { test, expect } = require("@playwright/test");

test.describe("FinanceGR E2E Browser Smoke Suite", () => {
  test("boots cleanly, navigates all tabs, hides Self-Test from users, and isolates hidden admin", async ({ page }) => {
    const pageErrors = [];
    page.on("pageerror", err => pageErrors.push(err.message));

    await page.goto("/");
    await expect(page.locator(".sidebar-brand h1")).toHaveText("FinanceGR");

    // Dismiss first-visit Welcome Setup modal if shown
    const welcomeModal = page.locator("#welcomeSetupModal");
    if (await welcomeModal.isVisible()) {
      await page.click('#welcomeSetupModal button[onclick="skipWelcomeSetup()"]');
      await expect(welcomeModal).toBeHidden();
    }

    // Verify all primary sidebar tabs switch without errors (and no Admin tab exists)
    await expect(page.locator('[data-tab="admin"]')).toHaveCount(0);
    for (const tab of ["transactions", "planning", "wealth", "loans", "cards", "settings", "overview"]) {
      await page.click(`.nav-tab[data-tab="${tab}"]`);
      await expect(page.locator(`#tab-${tab}`)).toHaveClass(/active/);
    }

    // Add a transaction via modal and confirm Net Worth updates
    await page.evaluate(() => openTransactionModal());
    await page.fill("#amount", "42.50");
    await page.fill("#description", "E2E Smoke Coffee");
    await page.click('#transactionModal button[onclick="addTransaction(false)"]');
    await expect(page.locator("#netWorthMetric")).toContainText("42,50");

    // Verify Self-Test button is NOT exposed to regular users in Settings
    await page.click('.nav-tab[data-tab="settings"]');
    await expect(page.locator('button[onclick="runAndShowSelfTests()"]')).toHaveCount(0);

    // Visit hidden admin.html directly -> must show locked login gate & hide console (including Health Check)
    await page.goto("/admin.html");
    await expect(page.locator("#adminLoginGate")).toBeVisible();
    await expect(page.locator("#adminConsoleApp")).toBeHidden();
    await expect(page.locator("#admRunHealthBtn")).toBeHidden();

    expect(pageErrors).toEqual([]);
  });
});
