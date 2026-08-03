/**
 * The two public origins, resolved once.
 *
 * ── WHY THE LOCALHOST FALLBACK IS NOW A BUILD FAILURE ─────────────────────
 *
 * These used to be `process.env.X ?? 'http://localhost:3000'`. A default that
 * is right in development and catastrophic in production is the worst kind:
 * nothing fails, so nothing is noticed. A production build with
 * `NEXT_PUBLIC_SITE_URL` unset would emit a sitemap, canonical tags and
 * OpenGraph URLs all pointing at `localhost:3000` — and search engines would
 * index them exactly as written. With `NEXT_PUBLIC_API_BASE_URL` unset, every
 * server-rendered page would try to reach an API on the container's own
 * loopback and render an error state to real visitors.
 *
 * So the fallback survives ONLY where it is true. In a production build the
 * absence throws, which fails `next build` — before a deploy rather than
 * after one. `NODE_ENV` is inlined by the bundler, so this is a compile-time
 * branch and the check disappears from the development bundle entirely.
 */

const DEV_API = 'http://localhost:8000';
const DEV_SITE = 'http://localhost:3000';

function required(name: string, value: string | undefined, devFallback: string): string {
  if (value) return value.replace(/\/$/, '');
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      `${name} is not set. A production build must know its own public URL — ` +
        `defaulting to ${devFallback} would put localhost into the sitemap, ` +
        `canonical tags and every server-side API call. ` +
        `See REAL_INTEGRATIONS_AUDIT.md.`,
    );
  }
  return devFallback;
}

/** Backend REST API origin, no trailing slash. */
export const API_BASE_URL = required(
  'NEXT_PUBLIC_API_BASE_URL',
  process.env.NEXT_PUBLIC_API_BASE_URL,
  DEV_API,
);

/** This site's own public origin, no trailing slash. */
export const SITE_URL = required(
  'NEXT_PUBLIC_SITE_URL',
  process.env.NEXT_PUBLIC_SITE_URL,
  DEV_SITE,
);
