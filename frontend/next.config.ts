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
  // Build output dir. Overridable so the E2E server (Playwright webServer) can use
  // its own dir and not collide with a running `next dev` (`.next/dev/lock`).
  distDir: process.env.NEXT_DIST_DIR || '.next',
  // The CI test-server builds (E2E/QA) set NEXT_SKIP_TYPECHECK=true to skip the
  // in-build tsc pass (~37s), which the dedicated `validate` job already runs on
  // every PR. The real prod build (publish.yml) leaves this unset → full type
  // checking. (Next 16 no longer runs eslint during build.) eslint-disable:
  // next.config reads process.env by design.
  // eslint-disable-next-line no-restricted-syntax
  typescript: {
    ignoreBuildErrors: process.env.NEXT_SKIP_TYPECHECK === 'true',
    // Build-only tsconfig that excludes tests (validate covers them) —
    // keeps the in-build type-check within default heap on small CI runners.
    tsconfigPath: 'tsconfig.build.json',
  },
  // Embed git commit SHA and build time at build time — available as process.env.* everywhere
  env: {
    GIT_COMMIT_SHA,
    NEXT_PUBLIC_BUILD_TIME: new Date().toISOString(),
    // Explicitly inline the E2E flag into the client bundle (Turbopack dev does
    // not reliably inline ambient NEXT_PUBLIC_* set via the process env). Empty
    // string ⇒ E2E_MODE false for normal dev/prod; the Playwright webServer sets
    // it to 'true'. eslint-disable: next.config reads process.env by design.
    // eslint-disable-next-line no-restricted-syntax
    NEXT_PUBLIC_E2E: process.env.NEXT_PUBLIC_E2E || '',
  },
  // Enable standalone output for optimized Docker deployments (60% smaller images)
  output: 'standalone',

  // pi-ai (external, below) loads its LLM providers via a fully dynamic `import()`,
  // so the standalone tracer cannot see the AWS SDK the Bedrock provider pulls in —
  // and the Bedrock credential chain then lazily `require()`s @aws-sdk/token-providers
  // (+ @smithy utils). Those are absent from the container's node_modules, so the
  // first Bedrock LLM call dies with MODULE_NOT_FOUND in prod (works locally only
  // because the full node_modules is present). Force the AWS SDK + smithy into the
  // trace for every route that can make an LLM call. Files land once in the shared
  // standalone node_modules, so listing extra routes does not duplicate them.
  outputFileTracingIncludes: {
    '/api/chat': ['./node_modules/@aws-sdk/**/*', './node_modules/@smithy/**/*'],
    '/api/chat/stream': ['./node_modules/@aws-sdk/**/*', './node_modules/@smithy/**/*'],
  },

  // Exclude heavy packages from the server bundle — they are loaded from node_modules
  // at runtime instead of being compiled into server chunks by Turbopack.
  // '@duckdb/duckdb-wasm'  — browser WASM, should never be in server bundle
  // 'duckdb' / '@duckdb/node-api' — native Node.js DuckDB, can't be bundled
  // '@resvg/resvg-js'      — native SVG renderer
  // 'node-sql-parser'      — pure-JS but 5.2 MB compiled; server-only (API routes + MCP),
  //                          so making it external cuts 5 MB from the server chunk graph
  // '@earendil-works/pi-ai' — the in-process LLM client. It loads providers via a
  //                          fully dynamic `import(specifier)`; bundling it makes the
  //                          bundler emit a stub that throws "Cannot find module as
  //                          expression is too dynamic" at runtime on every LLM call.
  //                          Must be external so Node's native dynamic import resolves it.
  serverExternalPackages: [
    '@duckdb/duckdb-wasm', 'duckdb', '@duckdb/node-api', '@duckdb/node-bindings',
    '@duckdb/node-bindings-darwin-arm64', '@duckdb/node-bindings-darwin-x64',
    '@duckdb/node-bindings-linux-arm64', '@duckdb/node-bindings-linux-x64',
    '@duckdb/node-bindings-win32-arm64', '@duckdb/node-bindings-win32-x64',
    '@resvg/resvg-js', '@electric-sql/pglite', '@earendil-works/pi-ai',
    // '@polyglot-sql/sdk' — WASM SQL parser. If bundled, Turbopack emits its .wasm as a
    //   `/_next/static/media/*.wasm` asset URL that can't be fetched during SSR, throwing
    //   "Failed to parse URL from …polyglot_sql_wasm_bg.wasm" on EVERY page's server render
    //   (the browser then recovers via client render, masking it). External → loaded from
    //   node_modules with a real file path, so SSR works.
    '@polyglot-sql/sdk',
    // '@tailwindcss/node' / '@tailwindcss/oxide' — the in-process Tailwind compiler for story
    //   design-system CSS (lib/data/story/story-css.server.ts). oxide is a native addon and
    //   node resolves stylesheets from disk; bundling either breaks the story save path.
    '@tailwindcss/node', '@tailwindcss/oxide', 'tailwindcss',
    // 'playwright-core' — headless story capture backend (lib/headless-capture). Drives a
    //   real browser via node child processes + registry lookups on disk; bundling it breaks
    //   its driver/executable resolution. External → resolved from node_modules at runtime.
    'playwright-core',
  ],

  // Belt-and-suspenders: explicitly externalize duckdb in webpack config too.
  // serverExternalPackages handles Turbopack; this handles webpack (used in --no-turbopack builds).
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals = [...(Array.isArray(config.externals) ? config.externals : [config.externals].filter(Boolean)), 'duckdb'];
    }
    // Native YAML imports (e.g. orchestrator/prompts/prompts.yaml) for --no-turbopack /
    // Sentry webpack builds. yaml-loader parses the YAML at build and emits a JS module
    // that exports the parsed object — inlined into the bundle, no runtime fs read.
    config.module.rules.push({ test: /\.ya?ml$/, use: 'yaml-loader' });
    return config;
  },

  turbopack: {
    // Native YAML imports for Turbopack (dev + `next build`). Mirrors the webpack rule
    // above so `import x from './x.yaml'` works identically in both bundlers.
    rules: {
      '*.yaml': { loaders: ['yaml-loader'], as: '*.js' },
      '*.yml': { loaders: ['yaml-loader'], as: '*.js' },
    },
  },

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
