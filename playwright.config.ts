/**
 * End-to-end usability tests (tests/e2e). The real backend + built dashboard are started on a dedicated port;
 * external map tiles are blocked in every test so runs are deterministic and use the offline base map.
 *
 *   npm run build && npm run test:e2e
 *
 * Chromium: the system build when PW_CHROMIUM (or /opt/pw-browsers/chromium) exists, else Playwright's own.
 * WebGL runs on SwiftShader so the MapLibre map renders headless.
 */
import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'fs';

const PORT = Number(process.env.E2E_PORT ?? 8123);
const systemChromium = process.env.PW_CHROMIUM ?? (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1, // one shared in-memory backend
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }], ['json', { outputFile: 'tests/e2e/results/results.json' }]] : [['list'], ['json', { outputFile: 'tests/e2e/results/results.json' }]],
  outputDir: 'tests/e2e/results/artifacts',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    ...devices['Desktop Chrome'],
    viewport: { width: 1440, height: 900 },
    locale: 'en-GB',
    timezoneId: 'Asia/Kabul',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: {
      executablePath: systemChromium,
      args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'],
    },
  },
  webServer: {
    command: 'npm start',
    url: `http://127.0.0.1:${PORT}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: { PORT: String(PORT), HOST: '127.0.0.1', JWT_SECRET: 'e2e-secret-0123456789abcdef0123456789', RATE_LIMIT_RPM: '100000', DEMO_MODE: 'true' },
  },
});
