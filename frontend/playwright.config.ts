import { defineConfig, devices } from '@playwright/test';

/**
 * E2E smoke: the discovery funnel (home -> search -> results) plus the style
 * guide, each scanned with axe in both themes.
 *
 * Two servers are started: the Next app, and the FIXTURE backend
 * (`scripts/mock-api.mjs`) on port 8000 — the port the real backend uses. It
 * speaks the same `GET /events` contract, so CI gets deterministic data without
 * Postgres/PgBouncer/Redis. Running `docker compose up` instead (the real
 * backend on the same port) makes these tests exercise the real thing;
 * `reuseExistingServer` means whichever is already listening wins.
 *
 * CI runs against the PRODUCTION build, not `next dev`. That's parity with what
 * ships, and it removes a real source of flake: in dev, the first client-side
 * navigation to a route triggers an on-demand compile, so a `router.push` can
 * take seconds. `expect.timeout` is raised for the same reason, so a local dev
 * run doesn't fail on a first-visit compile either.
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  expect: { timeout: 10_000 },
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'npm run mock:api',
      // Fixture-only marker — see the note in scripts/mock-api.mjs. `/health/`
      // is also served by the real backend, so probing it made a running Docker
      // stack masquerade as the fixture.
      url: 'http://localhost:8000/__fixture__/health',
      reuseExistingServer: true,
      timeout: 30_000,
    },
    {
      command: process.env.CI ? 'npm run build && npm run start' : 'npm run dev',
      url: 'http://localhost:3000',
      reuseExistingServer: !process.env.CI,
      timeout: 300_000,
    },
  ],
});
