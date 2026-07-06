import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import unusedImports from "eslint-plugin-unused-imports";
import importPlugin from "eslint-plugin-import-x";

// Shared import restrictions — extracted so each file-scoped override can
// keep exactly the restrictions that still apply, rather than turning off all of them.
const RESTRICT_DOCUMENTS_DB = {
  name: "@/lib/database/documents-db",
  message:
    "Do not import DocumentDB outside the data layer. Use FilesAPI, ConnectionsAPI, or ConfigsAPI from lib/data/** instead. " +
    "DocumentDB is a shared server-side data primitive, allowed only in lib/data/*.server.ts modules and " +
    "lib/data/*/*.server.ts modules (files.server.ts, connections.server.ts, configs.server.ts, heal-stories.server.ts, " +
    "shares/shares.server.ts, and future siblings doing legitimate direct data access for non-file-shaped or " +
    "cross-file-lookup concerns) and lib/database/** internals.",
};

const RESTRICT_ADAPTER_FACTORY = {
  name: "@/lib/database/adapter/factory",
  message:
    "Do not call createAdapter/getAdapter directly. Use getModules().db instead — it is the module-registry singleton " +
    "that all DB operations share. Direct adapter construction creates isolated instances that silently lose writes. " +
    "Allowed only in lib/modules/db/** and lib/database/**.",
};

// pi-ai is isolated to orchestrator/llm/. Nothing else may import it — consumers
// use the owned types + wrapped runtime from @/orchestrator/llm, faux/test
// helpers from @/orchestrator/llm/testing, and typebox directly from "typebox".
// See orchestrator/llm/Migration.md for the rationale.
//
// INVARIANT: every `no-restricted-imports` override below must include
// RESTRICT_PI_AI, EXCEPT the orchestrator/llm/** carve-out (the one place pi-ai
// is allowed). Flat config replaces this rule per file, so a block that omits it
// silently reopens a hole.
const RESTRICT_PI_AI = {
  name: "@mariozechner/pi-ai",
  message:
    "Do not import @mariozechner/pi-ai directly. It is isolated to orchestrator/llm/. " +
    "Import LLM types + runtime from @/orchestrator/llm (faux/test helpers from @/orchestrator/llm/testing), " +
    "and import Type/TSchema/Static directly from 'typebox'.",
};

// Shared no-restricted-syntax selectors — reused across multiple file-scoped overrides
// so that per-file configs can extend rather than replace the base rules.
const BASE_RESTRICTED_SYNTAX = [
  {
    selector: "ImportExpression",
    message: "Dynamic imports (await import()) are not allowed. Use static imports at the top of the file. Inline imports indicate circular dependencies or poor architecture - fix the design instead.",
  },
  {
    selector: "CallExpression[callee.name='require']",
    message: "require() calls are not allowed. Use static ES module imports at the top of the file instead.",
  },
  {
    selector: "MemberExpression[object.name='process'][property.name='env']",
    message: "Do not access process.env directly. Import from lib/config.ts (server-only vars) or lib/constants.ts (client-safe NEXT_PUBLIC_* vars) instead.",
  },
  {
    selector: "Program > VariableDeclaration NewExpression[callee.name='Map']",
    message: "Module-level Maps are shared across all requests. For mutable caches: ensure keys include a per-request scope key, then add eslint-disable-next-line with justification. For immutable constants: use immutableMap() from lib/utils/immutable-collections instead of new Map().",
  },
  {
    selector: "Program > VariableDeclaration NewExpression[callee.name='Set']",
    message: "Module-level Sets are shared across all requests. For mutable state: add eslint-disable-next-line with justification. For immutable constants: use immutableSet() from lib/utils/immutable-collections instead of new Set().",
  },
  {
    selector: "LogicalExpression[operator='||'][left.type='BinaryExpression'][left.operator='==='][right.type='BinaryExpression'][right.operator='===']:matches([left.right.type='Literal'][left.right.raw='null'][right.right.type='Identifier'][right.right.name='undefined'], [left.right.type='Identifier'][left.right.name='undefined'][right.right.type='Literal'][right.right.raw='null'])",
    message: "Use `== null` instead of `=== null || === undefined`. `== null` catches both.",
  },
  {
    selector: "LogicalExpression[operator='&&'][left.type='BinaryExpression'][left.operator='!=='][right.type='BinaryExpression'][right.operator='!==']:matches([left.right.type='Literal'][left.right.raw='null'][right.right.type='Identifier'][right.right.name='undefined'], [left.right.type='Identifier'][left.right.name='undefined'][right.right.type='Literal'][right.right.raw='null'])",
    message: "Use `!= null` instead of `!== null && !== undefined`. `!= null` catches both.",
  },
];

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // postinstall-generated third-party WASM worker bundles (not project code)
    "public/duckdb/**",
    // Playwright E2E build output + run artifacts (not project code)
    ".next-e2e/**",
    ".next-qa/**",
    "test-results/**",
    "playwright-report/**",
    "blob-report/**",
    "playwright/.cache/**",
    // Plain-CJS worker entry points (run inside worker_threads). The
    // next/eslint config injects React rules into all JS — these workers
    // have no React surface, so we skip them rather than carry the plugin.
    "**/*.cjs",
  ]),
  {
    plugins: {
      "unused-imports": unusedImports,
      "import-x": importPlugin,
    },
    settings: {
      "import-x/resolver": {
        typescript: {
          alwaysTryTypes: true,
          project: "./tsconfig.json",
        },
      },
    },
    rules: {
      // Downgraded to warn — fix gradually
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/ban-ts-comment": "warn",
      // Disable base rules as they are replaced by unused-imports
      "@typescript-eslint/no-unused-vars": "off",
      "no-unused-vars": "off",
      // Unused imports — error (auto-fixable; keeps clutter from accruing).
      // Unused vars/args — still warn (not auto-fixable; some are intentional placeholders).
      "unused-imports/no-unused-imports": "error",
      "unused-imports/no-unused-vars": [
        "warn",
        {
          vars: "all",
          varsIgnorePattern: "^_",
          args: "after-used",
          argsIgnorePattern: "^_",
        },
      ],
      // Style preferences — warn, not error
      "prefer-const": "warn",
      "react/no-unescaped-entities": "warn",
      // React Compiler memoization hints — warn (perf hints, not bugs)
      "react-hooks/preserve-manual-memoization": "warn",
      // Detect runtime circular imports (import type cycles are safe and ignored)
      "import-x/no-cycle": ["error", { ignoreExternal: true }],
      // Enforce all imports at the top of the file before any other code
      "import-x/first": "error",
      // Prevent direct DocumentDB imports outside the data layer.
      // Use lib/data/* functions instead. Allowed paths are whitelisted below.
      // Prevent createAdapter/getAdapter calls outside the module setup layer.
      // Everything else must use getModules().db — calling createAdapter directly
      // creates throwaway instances that don't share state with the module registry.
      "no-restricted-imports": [
        "error",
        {
          paths: [
            RESTRICT_DOCUMENTS_DB,
            RESTRICT_ADAPTER_FACTORY,
            RESTRICT_PI_AI,
          ],
        },
      ],
      // Prevent inline/dynamic imports (code smell indicating circular dependencies)
      // Enforce process.env access only through lib/config.ts or lib/constants.ts
      "no-restricted-syntax": ["error", ...BASE_RESTRICTED_SYNTAX],
    },
  },
  // Allow process.env in the two centralized config files, scripts, and test bootstrap
  {
    files: ["lib/config.ts", "lib/constants.ts", "scripts/**", "test/setup/**", "next.config.ts", "playwright.config.ts", "playwright.qa.config.ts"],
    rules: {
      "no-restricted-syntax": ["error", BASE_RESTRICTED_SYNTAX[0], BASE_RESTRICTED_SYNTAX[1]],
    },
  },
  // Playwright E2E: the fixture API names its callback `use`, which the react-hooks
  // plugin mistakes for a Hook. Not React code.
  {
    files: ["test/e2e/**", "playwright.config.ts"],
    rules: {
      "react-hooks/rules-of-hooks": "off",
    },
  },
  // API routes must use handleApiError() for 500s — ensures all errors reach internal Slack.
  // If a route genuinely needs a custom 500 shape (e.g. /api/chat returns ChatResponse),
  // suppress inline with: // eslint-disable-next-line no-restricted-syntax
  {
    files: ["app/api/**/*.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        ...BASE_RESTRICTED_SYNTAX,
        {
          selector: "CallExpression[callee.object.name='NextResponse'][callee.property.name='json']:has(Property[key.name='status'][value.value=500])",
          message: "Use handleApiError(error) instead of NextResponse.json with { status: 500 }. This ensures the error is reported to internal monitoring.",
        },
      ],
    },
  },
  // Relax import discipline rules in test files — Jest module mocking requires
  // require() calls and dynamic imports after jest.mock()/jest.resetModules().
  {
    files: ["**/*.test.ts", "**/*.test.tsx", "**/__tests__/**", "**/__mocks__/**", "test/**"],
    rules: {
      "import-x/no-cycle": "off",
      "import-x/first": "off",
      "no-restricted-syntax": "off",
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  // lib/data/*.server.ts (+ one level of subdirectory, e.g. lib/data/shares/shares.server.ts)
  // and test files — DocumentDB allowed, adapter still restricted.
  // DocumentDB is the shared server-side data primitive for files.server.ts's siblings doing
  // legitimate direct data access for non-file-shaped concerns (connections, configs, one-shot
  // healing/migration scripts) or cross-file lookups with no FilesAPI equivalent (shares'
  // findByShareNonce) — confirmed current members: files.server.ts, connections.server.ts,
  // configs.server.ts, heal-stories.server.ts, shares/shares.server.ts. Keyed on the *.server.ts
  // category (not a hardcoded file list) so a genuine new sibling doesn't need an eslint edit to
  // exercise the same access. DocumentDB is clean (routes through getModules().db) so tests may
  // use it for fixtures/assertions.
  {
    files: [
      "lib/data/*.server.ts",
      "lib/data/*/*.server.ts",
      "**/*.test.ts",
      "**/*.test.tsx",
      "**/__tests__/**",
      "**/__mocks__/**",
      "test/**",
    ],
    rules: {
      "no-restricted-imports": ["error", { paths: [RESTRICT_ADAPTER_FACTORY, RESTRICT_PI_AI] }],
    },
  },
  // lib/modules/db/** — adapter allowed (it IS the module), DocumentDB still restricted.
  // pi-ai stays banned (allowed only in orchestrator/llm/).
  {
    files: ["lib/modules/db/**"],
    rules: {
      "no-restricted-imports": ["error", { paths: [RESTRICT_DOCUMENTS_DB, RESTRICT_PI_AI] }],
    },
  },
  // lib/database/** — database internals; factory + adapter allowed. pi-ai still
  // banned (allowed only in orchestrator/llm/).
  {
    files: ["lib/database/**"],
    rules: {
      "no-restricted-imports": ["error", { paths: [RESTRICT_PI_AI] }],
    },
  },
  // scripts/** — DocumentDB allowed (scripts seed the DB), adapter still restricted.
  // Scripts must go through getModules().db just like everything else.
  {
    files: ["scripts/**"],
    rules: {
      "no-restricted-imports": ["error", { paths: [RESTRICT_ADAPTER_FACTORY, RESTRICT_PI_AI] }],
    },
  },

  // orchestrator/** — must stay app-agnostic. The orchestrator is the generic
  // agent runtime; it knows about pi-ai, MXTool, MXAgent, and not much else.
  // App-specific concerns (Files, Auth, Connections, Redux state, etc.) belong
  // on agents that extend `AgentContext` with their own context type, NOT in
  // the orchestrator core.
  {
    files: ["orchestrator/**/*.ts", "orchestrator/**/*.tsx"],
    ignores: ["orchestrator/**/__tests__/**"],
    rules: {
      "no-restricted-imports": ["error", {
        paths: [RESTRICT_PI_AI],
        patterns: [
          {
            group: ["@/lib/**", "@/app/**", "@/store/**", "@/components/**", "@/agents/**"],
            message:
              "orchestrator/ must stay app-agnostic. Move this dependency into agents/<agent>/ , for example: extend AgentContext with what your agent needs.",
          },
        ],
      }],
    },
  },
  // orchestrator/llm/** — THE pi-ai isolation boundary. This is the only place
  // allowed to import @mariozechner/pi-ai. It also bridges to deployment config
  // (the MX proxy URL), so @/lib/config is permitted here (the app-agnostic
  // pattern ban is intentionally not applied). Must come AFTER the orchestrator/**
  // block so it wins (flat-config: last matching config replaces the rule).
  // See orchestrator/llm/Migration.md for the rationale.
  {
    files: ["orchestrator/llm/**/*.ts"],
    rules: {
      "no-restricted-imports": ["error", { paths: [RESTRICT_DOCUMENTS_DB, RESTRICT_ADAPTER_FACTORY] }],
    },
  },
]);

export default eslintConfig;
