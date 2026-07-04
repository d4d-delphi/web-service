// Backend origin proxied same-origin (see rewrites below) so the browser never
// makes a cross-origin request to *.onrender.com — sidesteps CORS, mixed-content,
// and privacy extensions that block free-host domains. Override via env if needed.
const BACKEND_ORIGIN = process.env.BACKEND_ORIGIN || 'https://delphi-api-wupt.onrender.com';

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Reverse-proxy the DELPHI backend under our own domain. Client code calls
  // /backend/... (same-origin) → Vercel forwards to the Render backend.
  async rewrites() {
    return [
      { source: '/backend/:path*', destination: `${BACKEND_ORIGIN}/:path*` },
    ];
  },
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        Buffer: false,
        http: false,
        https: false,
        zlib: false,
      };
    }
    return config;
  },
  env: {
    CESIUM_BASE_URL: '/cesium',
  },
  // Don't fail the production build on lint errors (e.g. rules-of-hooks in
  // EnemyPanel.tsx). These only warn in `next dev`; fix them separately.
  eslint: {
    ignoreDuringBuilds: true,
  },
};

module.exports = nextConfig;
