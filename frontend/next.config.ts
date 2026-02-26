import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Enable standalone output for optimized Docker deployments (60% smaller images)
  output: 'standalone',

  // Exclude heavy client-side packages from server bundle
  // This prevents DuckDB WASM from being compiled during API route builds
  // 'duckdb' is the native Node.js DuckDB package used for server-side analytics
  serverExternalPackages: ['@duckdb/duckdb-wasm', 'duckdb'],

  experimental: {
    // Enable optimized package imports to reduce bundle size
    optimizePackageImports: ['@chakra-ui/react', 'react-icons'],

    // Increase request body size limit for database imports (default is 10MB)
    // This allows large compressed database files to be uploaded
    proxyClientMaxBodySize: '500mb',
  },
};

export default nextConfig;
