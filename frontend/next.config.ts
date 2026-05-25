import { withSentryConfig } from '@sentry/nextjs';
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
  // Embed git commit SHA and build time at build time — available as process.env.* everywhere
  env: {
    GIT_COMMIT_SHA,
    NEXT_PUBLIC_BUILD_TIME: new Date().toISOString(),
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

export default withSentryConfig(nextConfig, {
  // For all available options, see:
  // https://www.npmjs.com/package/@sentry/webpack-plugin#options

  org: "minusx",

  project: "minusx-bi",

  // Only print logs for uploading source maps in CI
  silent: !process.env.CI,

  // For all available options, see:
  // https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/

  // Upload a larger set of source maps for prettier stack traces (increases build time)
  widenClientFileUpload: true,

  // Route browser requests to Sentry through a Next.js rewrite to circumvent ad-blockers.
  // This can increase your server load as well as your hosting bill.
  // Note: Check that the configured route will not match with your Next.js middleware, otherwise reporting of client-
  // side errors will fail.
  tunnelRoute: "/monitoring",

  webpack: {
    // Enables automatic instrumentation of Vercel Cron Monitors. (Does not yet work with App Router route handlers.)
    // See the following for more information:
    // https://docs.sentry.io/product/crons/
    // https://vercel.com/docs/cron-jobs
    automaticVercelMonitors: true,

    // Tree-shaking options for reducing bundle size
    treeshake: {
      // Automatically tree-shake Sentry logger statements to reduce bundle size
      removeDebugLogging: true,
    },
  }
});
