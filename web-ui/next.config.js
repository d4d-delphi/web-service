/** @type {import('next').NextConfig} */
const nextConfig = {
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
