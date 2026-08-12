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
/**
 * ── THE APP PORT IS OVERRIDABLE, AND 3000 IS STILL THE DEFAULT ────────────
 *
 * It was hard-coded in three places (the `baseURL`, the `webServer.url`, and
 * implicitly in `npm run dev`). On a developer machine 3000 is the most
 * contended port there is — another Next app, a docs site, a local tool — and
 * when something else holds it the failure is genuinely confusing: Next prints
 * "Port 3000 is in use, trying 3001 instead", binds 3001, and Playwright then
 * waits the full five minutes for a URL on 3000 that nothing will ever serve.
 * The error it finally prints (`Timed out waiting 300000ms`) names neither the
 * port nor the conflict.
 *
 * `E2E_PORT` fixes that without changing anything for CI, which sets nothing
 * and gets 3000 exactly as before. The port is also passed explicitly to the
 * server command, so Next cannot silently fall back to a different one — a
 * fallback is what turned a port clash into a five-minute timeout rather than
 * an immediate, obvious failure.
 */
const PORT = process.env.E2E_PORT ?? '3000';
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  expect: { timeout: 10_000 },
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    // ── EVIDENCE IS RETAINED WHILE THE SUITE IS NON-BLOCKING ──────────────
    // The suite currently runs without gating the deploy (see
    // .github/workflows/frontend-e2e.yml). A suite that does not gate anything
    // is one nobody looks at, and a failure with no artefact is one nobody can
    // diagnose later — so a failing test keeps a screenshot and a video as well
    // as the trace it already kept on retry. `only-on-failure`/`retain-on-failure`
    // rather than `on`, so a green run stays cheap and the report stays small.
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
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
      // `-p ${PORT}` explicitly, so Next fails on a clash instead of silently
      // binding the next free port and leaving Playwright waiting on one
      // nothing will answer.
      command: process.env.CI
        ? `npm run build && npx next start -p ${PORT}`
        : `npx next dev -p ${PORT}`,
      url: BASE_URL,
      reuseExistingServer: !process.env.CI,
      timeout: 300_000,
    },
  ],
});
