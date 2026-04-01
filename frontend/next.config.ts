import type { NextConfig } from "next";
import { execSync } from "child_process";

function readGitCommitSha(): string {
  if (process.env.GIT_COMMIT_SHA) return process.env.GIT_COMMIT_SHA;
  try {
    return execSync("git rev-parse HEAD").toString().trim().slice(0, 8);
  } catch {
    return "unknown";
  }
}

const GIT_COMMIT_SHA = readGitCommitSha();

const nextConfig: NextConfig = {
  // Embed git commit SHA at build time — available as process.env.GIT_COMMIT_SHA everywhere
  env: {
    GIT_COMMIT_SHA,
  },
  // Enable standalone output for optimized Docker deployments (60% smaller images)
  output: 'standalone',

  // Exclude heavy client-side packages from server bundle
  // This prevents DuckDB WASM from being compiled during API route builds
  // 'duckdb' is the native Node.js DuckDB package used for server-side analytics
  serverExternalPackages: ['@duckdb/duckdb-wasm', 'duckdb', '@duckdb/node-api', '@duckdb/node-bindings', 'mammoth', 'pdfjs-dist'],

  // Belt-and-suspenders: explicitly externalize browser-only packages in webpack config too.
  // serverExternalPackages handles Turbopack; this handles webpack (used in --no-turbopack builds).
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals = [...(Array.isArray(config.externals) ? config.externals : [config.externals].filter(Boolean)), 'duckdb', 'mammoth', 'pdfjs-dist'];
    }
    return config;
  },

  turbopack: {},

  experimental: {
    // Enable optimized package imports to reduce bundle size
    optimizePackageImports: ['@chakra-ui/react', 'react-icons', 'echarts'],

    // Increase request body size limit for database imports (default is 10MB)
    // This allows large compressed database files to be uploaded
    proxyClientMaxBodySize: '500mb',
  },
};

export default nextConfig;
