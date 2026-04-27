import type { NextConfig } from "next";
import { execSync } from "child_process";

function readGitCommitSha(): string {
  if (process.env.GIT_COMMIT_SHA) return process.env.GIT_COMMIT_SHA.slice(0, 8);
  // In dev, return a stable value so Turbopack's cache key doesn't change on every commit.
  // The SHA is only meaningful in production builds.
  if (process.env.NODE_ENV === 'development') return 'dev';
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

  // Exclude heavy packages from the server bundle — they are loaded from node_modules
  // at runtime instead of being compiled into server chunks by Turbopack.
  // '@duckdb/duckdb-wasm'  — browser WASM, should never be in server bundle
  // 'duckdb' / '@duckdb/node-api' — native Node.js DuckDB, can't be bundled
  // '@resvg/resvg-js'      — native SVG renderer
  // 'node-sql-parser'      — pure-JS but 5.2 MB compiled; server-only (API routes + MCP),
  //                          so making it external cuts 5 MB from the server chunk graph
  serverExternalPackages: [
    '@duckdb/duckdb-wasm', 'duckdb', '@duckdb/node-api', '@duckdb/node-bindings',
    '@duckdb/node-bindings-darwin-arm64', '@duckdb/node-bindings-darwin-x64',
    '@duckdb/node-bindings-linux-arm64', '@duckdb/node-bindings-linux-x64',
    '@duckdb/node-bindings-win32-arm64', '@duckdb/node-bindings-win32-x64',
    '@resvg/resvg-js', '@electric-sql/pglite',
  ],

  // Belt-and-suspenders: explicitly externalize duckdb in webpack config too.
  // serverExternalPackages handles Turbopack; this handles webpack (used in --no-turbopack builds).
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals = [...(Array.isArray(config.externals) ? config.externals : [config.externals].filter(Boolean)), 'duckdb'];
    }
    return config;
  },

  turbopack: {},

  devIndicators: {
    position: 'bottom-right',
  },

  experimental: {
    // Cache fetch() responses in Server Components across HMR refreshes.
    // Without this, every code change during development re-fetches from the remote
    // Postgres DB (AWS RDS us-west-1), adding ~50–100 ms latency per SSR call and
    // causing the 17–29 s compile+render times seen in the dev logs.
    // This is a dev-only optimization; production builds are unaffected.
    serverComponentsHmrCache: true,

    // Enable optimized package imports to reduce bundle size
    optimizePackageImports: ['@chakra-ui/react', 'react-icons', 'echarts'],

    // Increase request body size limit for database imports (default is 10MB)
    // This allows large compressed database files to be uploaded
    proxyClientMaxBodySize: '500mb',
  },
};

export default nextConfig;
