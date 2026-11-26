const { test, expect } = require("@playwright/test");

test.describe("FinanceGR E2E Browser Smoke Suite (Vite Bundle + Strict CSP)", () => {
  test("boots cleanly with zero CSP/runtime errors, navigates all tabs, adds a transaction, and isolates hidden admin", async ({ page }) => {
    const pageErrors = [];
    const cspErrors = [];
    page.on("pageerror", err => pageErrors.push(err.message));
    page.on("console", msg => {
      if (msg.type() === "error" && /content security policy|refused to execute/i.test(msg.text())) {
        cspErrors.push(msg.text());
      }
    });

    await page.goto("/");
    await expect(page.locator(".sidebar-brand h1")).toHaveText("FinanceGR");

    // Dismiss first-visit Welcome Setup modal if shown
    const welcomeModal = page.locator("#welcomeSetupModal");
    if (await welcomeModal.isVisible()) {
      await page.click('#welcomeSetupModal button[data-click="skipWelcomeSetup"]');
      await expect(welcomeModal).toBeHidden();
    }

    // Verify all primary sidebar tabs switch without errors (and no Admin tab exists)
    await expect(page.locator('[data-tab="admin"]')).toHaveCount(0);
    for (const tab of ["transactions", "planning", "wealth", "loans", "cards", "settings", "overview"]) {
      await page.click(`.nav-tab[data-tab="${tab}"]`);
      await expect(page.locator(`#tab-${tab}`)).toHaveClass(/active/);
    }

    // Open Transactions tab, add a transaction via modal and confirm Net Worth updates
    await page.click('.nav-tab[data-tab="transactions"]');
    await page.click('#tab-transactions button[data-click="openTransactionModal"]');
    await page.fill("#amount", "42.50");
    await page.fill("#description", "E2E Smoke Coffee");
    await page.click('#transactionModal button[data-click="addTransaction"]');
    await page.click('.nav-tab[data-tab="overview"]');
    await expect(page.locator("#netWorthMetric")).toContainText("42,50");

    // Verify Privacy & Terms modal opens cleanly via delegated handler
    await page.click('.sidebar-footer button[data-click="openPrivacySecurityModal"]');
    await expect(page.locator("#privacySecurityModal")).toBeVisible();
    await page.click('#privacySecurityModal button[data-click="closePrivacySecurityModal"]');
    await expect(page.locator("#privacySecurityModal")).toBeHidden();

    // Verify Self-Test button is NOT exposed to regular users in Settings
    await page.click('.nav-tab[data-tab="settings"]');
    await expect(page.locator('[data-click="runAndShowSelfTests"]')).toHaveCount(0);

    // Visit hidden admin.html directly -> must show locked login gate & hide console
    await page.goto("/admin.html");
    await expect(page.locator("#adminLoginGate")).toBeVisible();
    await expect(page.locator("#adminConsoleApp")).toBeHidden();
    await expect(page.locator("#admRunHealthBtn")).toBeHidden();

    expect(cspErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });
});
