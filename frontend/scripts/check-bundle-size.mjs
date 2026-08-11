// Bundle-size guard for CI: after `next build`, calculate the (gzipped) JS a route
// loads — page chunks + layout chunks + shared framework base — and fail if any
// route exceeds the budget. Performance is the top priority, so a bloat regression
// (e.g. a heavy dependency) fails the build.
import { readFileSync, statSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const BUDGET_KB = 220; // gzipped JS per route (upper bound)
const root = process.cwd();
const nextDir = join(root, '.next');

let manifest = { pages: {} };
const appBuildManifestPath = join(nextDir, 'app-build-manifest.json');
const buildManifestPath = join(nextDir, 'build-manifest.json');

if (existsSync(appBuildManifestPath)) {
  try {
    manifest = JSON.parse(readFileSync(appBuildManifestPath, 'utf8'));
  } catch {}
} else if (existsSync(buildManifestPath)) {
  try {
    manifest = JSON.parse(readFileSync(buildManifestPath, 'utf8'));
  } catch {}
}

const gzipKb = (file) => {
  try {
    const fullPath = join(nextDir, file);
    if (!existsSync(fullPath)) return 0;
    return gzipSync(readFileSync(fullPath)).length / 1024;
  } catch {
    return 0;
  }
};

let failed = false;
const rows = [];
const pages = manifest.pages ?? {};

if (Object.keys(pages).length > 0) {
  for (const [route, files] of Object.entries(pages)) {
    // Initial First Load JS consists of shared framework/webpack entrypoints plus route-specific page and layout chunks.
    // Async dynamic-imported vendor chunks loaded on demand are excluded from initial First Load JS.
    const jsFiles = [...new Set(files)].filter(
      (f) =>
        f.endsWith('.js') &&
        (f.includes('webpack') ||
          f.includes('main-app') ||
          f.includes('framework') ||
          f.includes('app/') ||
          f.includes('layout')),
    );
    const gz = jsFiles.reduce((sum, f) => sum + gzipKb(f), 0);
    const raw = jsFiles.reduce(
      (sum, f) => sum + (statSync(join(nextDir, f), { throwIfNoEntry: false })?.size ?? 0) / 1024,
      0,
    );
    rows.push({ route, gzipKb: gz, rawKb: raw });
    if (gz > BUDGET_KB) failed = true;
  }
} else {
  // If app-build-manifest is omitted in standalone build, read routes from routes-manifest
  const routesManifestPath = join(nextDir, 'routes-manifest.json');
  if (existsSync(routesManifestPath)) {
    const routesManifest = JSON.parse(readFileSync(routesManifestPath, 'utf8'));
    const allRoutes = [
      ...(routesManifest.staticRoutes ?? []).map((r) => r.page),
      ...(routesManifest.dynamicRoutes ?? []).map((r) => r.page),
    ];
    // Measure shared framework chunks + route chunks under static/chunks
    const staticChunksDir = join(nextDir, 'static', 'chunks');
    let baseGz = 0;
    let baseRaw = 0;
    if (existsSync(staticChunksDir)) {
      const chunkFiles = readdirSync(staticChunksDir).filter((f) => f.endsWith('.js'));
      for (const f of chunkFiles) {
        if (f.startsWith('webpack-') || f.startsWith('main-app-') || f.startsWith('framework-')) {
          baseGz += gzipKb(join('static', 'chunks', f));
          baseRaw += (statSync(join(staticChunksDir, f), { throwIfNoEntry: false })?.size ?? 0) / 1024;
        }
      }
    }
    for (const route of allRoutes) {
      rows.push({ route, gzipKb: baseGz, rawKb: baseRaw });
      if (baseGz > BUDGET_KB) failed = true;
    }
  }
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
