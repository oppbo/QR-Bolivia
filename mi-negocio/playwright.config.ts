import { defineConfig, devices } from '@playwright/test';

// Requiere Supabase local en marcha (npm run db:start) y .env.local.
// El setup global ejecuta el seed de desarrollo (datos ficticios, solo local).
export default defineConfig({
  testDir: 'tests/e2e',
  globalSetup: './tests/e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
    locale: 'es-BO',
    timezoneId: 'America/La_Paz',
    ...(process.env.CHROMIUM_PATH ? { launchOptions: { executablePath: process.env.CHROMIUM_PATH } } : {}),
  },
  projects: [
    { name: 'movil', use: { ...devices['Pixel 5'], viewport: { width: 360, height: 780 } } },
    { name: 'escritorio', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 860 } }, testMatch: /layout\.spec\.ts/ },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000/login',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
