import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    // Set ADMIN_BASE_URL to your deployed admin dashboard URL
    baseURL: process.env.ADMIN_BASE_URL || 'http://localhost:3001',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    // Optional: point at a pre-installed Chromium instead of downloading
    // browsers (e.g. PW_CHROMIUM_PATH=/opt/pw-browsers/chromium)
    launchOptions: process.env.PW_CHROMIUM_PATH
      ? { executablePath: process.env.PW_CHROMIUM_PATH }
      : {},
    // Sandboxed CI environments often route outbound HTTPS through an
    // intercepting proxy - honor it and tolerate its certificate.
    proxy: process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined,
    ignoreHTTPSErrors: !!process.env.HTTPS_PROXY,
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
  ],

});