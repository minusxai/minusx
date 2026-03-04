import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Enable standalone output for optimized Docker deployments (60% smaller images)
  output: 'standalone',

  // Exclude heavy client-side packages from server bundle
  // This prevents DuckDB WASM from being compiled during API route builds
  // 'duckdb' is the native Node.js DuckDB package used for server-side analytics
  serverExternalPackages: ['@duckdb/duckdb-wasm', 'duckdb'],

  // Belt-and-suspenders: explicitly externalize duckdb in webpack config too.
  // serverExternalPackages handles Turbopack; this handles webpack (used in --no-turbopack builds).
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals = [...(Array.isArray(config.externals) ? config.externals : [config.externals].filter(Boolean)), 'duckdb'];
    }
    return config;
  },

  experimental: {
    // Enable optimized package imports to reduce bundle size
    optimizePackageImports: ['@chakra-ui/react', 'react-icons', 'echarts'],

    // Increase request body size limit for database imports (default is 10MB)
    // This allows large compressed database files to be uploaded
    proxyClientMaxBodySize: '500mb',
  },
};

export default nextConfig;
