/**
 * Hosts `next/image` may optimise from.
 *
 * Built from environment because a hard-coded `localhost:8000` silently
 * rejects every image the moment the app has a real domain.
 */
function remotePatterns() {
  const patterns = [];

  const add = (raw, pathname) => {
    if (!raw) return;
    try {
      const url = new URL(raw);
      patterns.push({
        protocol: url.protocol.replace(':', ''),
        hostname: url.hostname,
        ...(url.port ? { port: url.port } : {}),
        ...(pathname ? { pathname } : {}),
      });
    } catch {
      // A malformed URL must not take the build down. The pattern is simply
      // not added, so the image fails visibly rather than the build failing
      // obscurely.
    }
  };

  // Uploads served THROUGH the API (STORAGE_BACKEND=local, path /media/**).
  add(process.env.NEXT_PUBLIC_API_BASE_URL, '/media/**');
  // Uploads served straight from a bucket or CDN (STORAGE_BACKEND=s3|gcs).
  add(process.env.NEXT_PUBLIC_MEDIA_BASE_URL);

  // Local development, so `npm run dev` works with nothing configured.
  if (process.env.NODE_ENV !== 'production') {
    patterns.push({
      protocol: 'http',
      hostname: 'localhost',
      port: '8000',
      pathname: '/media/**',
    });
  }

  return patterns;
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  /**
   * Where the build lands. `.next` unless `NEXT_DIST_DIR` says otherwise.
   *
   * This exists for one specific reason: on Windows, running `next build` while
   * `next dev` is watching the same `.next` corrupts it — the dev server sees
   * half-written chunks appear under it and starts serving 500s for routes that
   * are fine, with no error naming the cause. Recovering means stopping
   * everything and deleting the directory.
   *
   * So a verification build (CI's gate, or a check run while somebody has the
   * dev server open) points somewhere else and leaves the running server
   * alone. Deploys set nothing and get `.next`.
   */
  distDir: process.env.NEXT_DIST_DIR || '.next',
  /**
   * Emit `.next/standalone` — a self-contained server with only the modules it
   * actually imports.
   *
   * This is what makes a deployable image possible at all: without it the
   * runtime stage has to carry the whole `node_modules` tree (~500 MB on this
   * project) because `next start` resolves dependencies at request time. With
   * it, the runner copies one traced folder and the image lands near 200 MB —
   * which matters on a free-tier box where the boot volume and the network are
   * both finite.
   *
   * `next start` and `next dev` are unaffected; this only ADDS an output.
   */
  output: 'standalone',
  // Performance: tree-shake icon imports so we never ship the whole Lucide set.
  experimental: {
    optimizePackageImports: ['lucide-react', 'framer-motion'],
  },
  images: {
    // Modern formats first — smaller payloads, better LCP.
    formats: ['image/avif', 'image/webp'],
    // Derived from the environment rather than hard-coded.
    //
    // This used to be `localhost:8000` plus a Google Cloud Storage wildcard.
    // Behind a real domain that combination refuses EVERY poster: next/image
    // rejects any host not on the list, and neither the deployed API host nor
    // an S3/Supabase/R2 bucket appeared on it. Silent in development, total
    // in production.
    remotePatterns: remotePatterns(),
  },
  async headers() {
    // Immutable caching for the self-hosted font/static assets; page-level cache
    // headers (ISR / edge) are added per-route as public pages are built, to
    // mirror the backend's public read-path caching.
    return [
      // ── SECURITY HEADERS, ON EVERY RESPONSE THIS APP SERVES ─────────────
      //
      // There was NO Content-Security-Policy anywhere: not in Django settings,
      // not here, not in the Caddyfile. `prod.py` sets `X_FRAME_OPTIONS: DENY`,
      // which covers responses the BACKEND serves — and every page a visitor
      // actually looks at is served by this app, which had no frame protection
      // at all. A checkout that can be framed is a clickjacking target.
      //
      // ── WHAT IS DELIBERATELY NOT HERE: script-src ───────────────────────
      //
      // A `script-src` without nonces needs `'unsafe-inline'`, because Next's
      // App Router hydrates through inline `self.__next_f.push(...)` scripts.
      // `script-src 'unsafe-inline'` stops approximately no XSS — it is the
      // exact capability an injected script needs — so it would be theatre
      // that also risks breaking Razorpay Checkout on the money path.
      //
      // Doing it properly means a per-request nonce, which means generating it
      // in middleware and reading it through `headers()`, which opts EVERY
      // page out of static rendering. On a codebase whose public read path is
      // tuned to 0 DB queries warm and served from the edge, that trade needs
      // measuring, not assuming. It is a separate change with its own test
      // run — see BACKLOG.
      //
      // What IS here are the directives that cannot break a render and close
      // real holes: framing, plugin embedding, `<base>` hijacking, and where
      // forms may post.
      {
        source: '/:path*',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: [
              // The clickjacking fix, and the reason this block exists.
              "frame-ancestors 'none'",
              // A stored `<base href>` silently re-points every relative URL
              // on the page, including the ones the funnel posts to.
              "base-uri 'self'",
              // Flash/Java embeds. Nothing here uses them; leaving the door
              // open costs nothing to close.
              "object-src 'none'",
              // Razorpay is listed because Checkout hands control back by
              // form POST on some flows. Omitting it would break payment for
              // exactly the visitors this platform must not fail.
              "form-action 'self' https://api.razorpay.com https://checkout.razorpay.com",
            ].join('; '),
          },
          // Browsers still honour this and it is not expressible in CSP.
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          // Matches the backend's `SECURE_REFERRER_POLICY`, so a request does
          // not leak the full URL of a private page to a third party.
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          // GEOLOCATION IS `self`, NOT `()`. `LocationPrompt` asks for it to
          // sort events by distance; denying it here would break a shipped
          // feature while looking like a hardening win. Camera, microphone and
          // payment-request are genuinely unused.
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), payment=(), geolocation=(self)',
          },
        ],
      },

      {
        source: '/:all*(woff2|woff|ttf|otf)',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
      },

      // ── AUTHENTICATED SHELLS ARE NEVER SHARED-CACHEABLE ─────────────────
      //
      // These routes fetch everything client-side with the caller's token, so
      // Next found no dynamic API during the build, prerendered them, and
      // stamped them with its static default:
      //
      //     Cache-Control: s-maxage=31536000, stale-while-revalidate
      //
      // A ONE-YEAR shared-cache lifetime on /dashboard and /admin. Two
      // separate faults, and the second is what organizers actually hit.
      //
      // 1. It contradicts the rule this platform states for every private
      //    response — "a shared/CDN cache must never serve one user's cached
      //    response to another". Cloudflare happens to mark these DYNAMIC and
      //    declines to cache them, which is luck, not design: the header is an
      //    instruction to every shared cache in the path.
      //
      // 2. The prerendered HTML names the CHUNK HASHES of the build that
      //    produced it. Hold it across a deploy — a browser back/forward, a
      //    proxy, anything honouring a year — and those chunks are gone from
      //    the new image. The client throws a ChunkLoadError mid-render, the
      //    organizer error boundary catches it, and the screen becomes "This
      //    screen didn't load". Reloading eventually fetches HTML matching the
      //    running build, which is exactly why refreshing "fixes" it and why
      //    it appears intermittently rather than always.
      //
      // `no-store` rather than a short max-age: the correct lifetime for a
      // document whose script references only exist in the build currently
      // deployed is zero. These shells are a skeleton plus a script tag, so
      // there is no meaningful paint cost to giving up their cache entry.
      //
      // The route groups — (organizer), (admin), (performer) — are erased from
      // the URL, so the paths are matched literally here.
      {
        source: '/dashboard/:path*',
        headers: [{ key: 'Cache-Control', value: 'private, no-store' }],
      },
      { source: '/dashboard', headers: [{ key: 'Cache-Control', value: 'private, no-store' }] },
      {
        source: '/admin/:path*',
        headers: [{ key: 'Cache-Control', value: 'private, no-store' }],
      },
      { source: '/admin', headers: [{ key: 'Cache-Control', value: 'private, no-store' }] },
      {
        source: '/studio/:path*',
        headers: [{ key: 'Cache-Control', value: 'private, no-store' }],
      },
      { source: '/studio', headers: [{ key: 'Cache-Control', value: 'private, no-store' }] },
      {
        source: '/account/:path*',
        headers: [{ key: 'Cache-Control', value: 'private, no-store' }],
      },
      { source: '/account', headers: [{ key: 'Cache-Control', value: 'private, no-store' }] },
    ];
  },
};

export default nextConfig;
