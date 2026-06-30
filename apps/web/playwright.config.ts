import { defineConfig, devices } from "@playwright/test";
import { existsSync } from "node:fs";

const localBrowserLibs = "/mnt/c/xampp/htdocs/StockLedger/.playwright-libs/root/usr/lib/x86_64-linux-gnu";
const browserEnv = existsSync(localBrowserLibs)
  ? {
      ...process.env,
      LD_LIBRARY_PATH: [localBrowserLibs, process.env.LD_LIBRARY_PATH].filter(Boolean).join(":")
    }
  : process.env;

if (existsSync(localBrowserLibs)) {
  process.env.PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS = "true";
}

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  retries: 1,
  reporter: "html",
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "on-first-retry",
    launchOptions: { env: browserEnv }
  },
  webServer: {
    command: "pnpm exec vite --host 127.0.0.1 --port 4173",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: true,
    timeout: 120000
  },
  projects: [
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"], browserName: "chromium" } },
    { name: "tablet-chromium", use: { ...devices["iPad (gen 7)"], browserName: "chromium" } }
  ]
});
