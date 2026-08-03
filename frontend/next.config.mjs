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
      {
        source: '/:all*(woff2|woff|ttf|otf)',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
      },
    ];
  },
};

export default nextConfig;
