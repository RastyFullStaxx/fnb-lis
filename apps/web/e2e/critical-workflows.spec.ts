import { expect, test } from "@playwright/test";

test("owner can navigate the audit workflow", async ({ page }) => {
  await page.goto("/overview");
  await expect(page.getByRole("heading", { name: /good morning/i })).toBeVisible();
  if (await page.getByLabel("Open navigation").isVisible()) {
    await page.getByLabel("Open navigation").click();
  }
  await page.getByRole("link", { name: "Audits" }).click();
  await page.getByRole("link", { name: /Open June 28 Weekly Audit/i }).click();
  await page.getByRole("link", { name: /Count/ }).click();
  await page.getByLabel("London Dry Gin full count").fill("12");
  await page.getByLabel("London Dry Gin scale weight").fill("720");
  await expect(page.getByText("357 ml")).toBeVisible();
});

test("import stays staged while rows need review", async ({ page }) => {
  await page.goto("/imports/IMP-308/review");
  await expect(page.getByText("Changes here do not affect stock.")).toBeVisible();
  await expect(page.getByRole("button", { name: /Approve and commit/ })).toBeDisabled();
});

test("auditor does not see mutation navigation", async ({ page }) => {
  await page.goto("/overview");
  await page.getByLabel("Demo role").selectOption("auditor");
  if (await page.getByLabel("Open navigation").isVisible()) {
    await page.getByLabel("Open navigation").click();
  }
  await expect(page.getByRole("link", { name: "Purchases" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Reports" })).toBeVisible();
});
