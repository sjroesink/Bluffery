import { defineConfig } from "@playwright/test";
import { join } from "node:path";
const evidence = process.env.VISSIG_EVIDENCE_DIR || "test-results/evidence";
export default defineConfig({
  testDir: "./tests",
  workers: 1,
  timeout: 60000,
  use: {
    baseURL: process.env.E2E_BASE_URL || "http://127.0.0.1:18088",
    launchOptions: {
      executablePath: process.env.CHROMIUM_PATH,
      args: ["--no-sandbox"],
    },
    screenshot: "only-on-failure",
  },
  reporter: [
    ["list"],
    ["json", { outputFile: join(evidence, "playwright-results.json") }],
  ],
});
