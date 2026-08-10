#!/usr/bin/env node
/**
 * A production build that CANNOT damage a running dev server.
 *
 * ── THE FAILURE THIS EXISTS TO PREVENT ────────────────────────────────────
 *
 * `next build` and `next dev` both own `.next`. Run the build while a dev
 * server is watching that directory and the two interleave their output: the
 * dev server starts serving half-written production chunks, routes that are
 * perfectly fine begin throwing at the error boundary, and the console fills
 * with module-resolution errors. Nothing names the cause, because nothing
 * failed — the build succeeds and the dev server keeps running.
 *
 * Recovery is stopping everything and deleting `.next`, which is a lot of
 * confusion for a mistake that is one forgotten flag.
 *
 * So verification builds go somewhere else. `next.config.mjs` reads
 * `NEXT_DIST_DIR`; deploys set nothing and get `.next` exactly as before.
 *
 * Use `npm run build` to produce a deployable build, and `npm run build:verify`
 * to check that the code compiles while somebody has the dev server open.
 */
import { spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';

const DIST = '.next-verify';

const result = spawnSync('next', ['build'], {
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, NEXT_DIST_DIR: DIST },
});

// Removed either way. It is a check, not an artifact, and leaving a second
// multi-hundred-megabyte build tree behind is its own small nuisance.
rmSync(DIST, { recursive: true, force: true });

process.exit(result.status ?? 1);
