// Bundle-size guard for CI: after `next build`, sum the (gzipped) JS a route can
// reference from the build manifest — an UPPER BOUND on its footprint — and fail
// if any route exceeds the budget. Performance is the top priority, so a bloat
// regression (e.g. a heavy dependency) fails the build. For the precise
// per-route First Load JS, read the `next build` route table.
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const BUDGET_KB = 220; // gzipped referenced JS per route (upper bound)
const root = process.cwd();
const nextDir = join(root, '.next');

let manifest;
try {
  manifest = JSON.parse(readFileSync(join(nextDir, 'app-build-manifest.json'), 'utf8'));
} catch (err) {
  console.error('Could not read .next/app-build-manifest.json — run `next build` first.');
  console.error(err.message);
  process.exit(1);
}

const gzipKb = (file) => {
  try {
    return gzipSync(readFileSync(join(nextDir, file))).length / 1024;
  } catch {
    return 0;
  }
};

let failed = false;
const rows = [];
for (const [route, files] of Object.entries(manifest.pages ?? {})) {
  const jsFiles = [...new Set(files)].filter((f) => f.endsWith('.js'));
  const gz = jsFiles.reduce((sum, f) => sum + gzipKb(f), 0);
  const raw = jsFiles.reduce(
    (sum, f) => sum + (statSync(join(nextDir, f), { throwIfNoEntry: false })?.size ?? 0) / 1024,
    0,
  );
  rows.push({ route, gzipKb: gz, rawKb: raw });
  if (gz > BUDGET_KB) failed = true;
}

rows.sort((a, b) => b.gzipKb - a.gzipKb);
console.log(`\nReferenced JS per route, gzipped upper bound (budget: ${BUDGET_KB} KB)\n`);
for (const r of rows) {
  const flag = r.gzipKb > BUDGET_KB ? '  ✗ OVER' : '  ✓';
  console.log(
    `  ${r.route.padEnd(28)} ${r.gzipKb.toFixed(1).padStart(7)} KB gz  (${r.rawKb.toFixed(1)} KB raw)${flag}`,
  );
}
console.log('');

if (failed) {
  console.error(
    `Bundle-size budget exceeded (> ${BUDGET_KB} KB gzipped). Investigate before merging.`,
  );
  process.exit(1);
}
console.log('Bundle-size budget OK.');
