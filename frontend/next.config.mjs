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
    // The backend serves posters from its own /media/ (local storage) in dev and
    // a CDN/bucket in prod — add the real host(s) here as they come online.
    remotePatterns: [
      { protocol: 'http', hostname: 'localhost', port: '8000', pathname: '/media/**' },
      { protocol: 'https', hostname: '**.storage.googleapis.com' },
    ],
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
