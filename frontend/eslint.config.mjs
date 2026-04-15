import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import unusedImports from "eslint-plugin-unused-imports";
import importPlugin from "eslint-plugin-import-x";

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
    message: "Module-level Maps are shared across all requests and tenants. For mutable caches: ensure keys include companyId+mode, then add eslint-disable-next-line with justification. For immutable constants: use immutableMap() from lib/utils/immutable-collections instead of new Map().",
  },
  {
    selector: "Program > VariableDeclaration NewExpression[callee.name='Set']",
    message: "Module-level Sets are shared across all requests. For mutable state: add eslint-disable-next-line with justification. For immutable constants: use immutableSet() from lib/utils/immutable-collections instead of new Set().",
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
      // Unused imports/vars — warn, not error (harmless clutter, fix gradually)
      "unused-imports/no-unused-imports": "warn",
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
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@/lib/database/documents-db",
              message:
                "Do not import DocumentDB outside the data layer. Use FilesAPI, ConnectionsAPI, or ConfigsAPI from lib/data/** instead. " +
                "DocumentDB is only allowed in lib/data/**, lib/database/**, scripts/**, and test files.",
            },
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
    files: ["lib/config.ts", "lib/constants.ts", "scripts/**", "jest.setup.js", "next.config.ts"],
    rules: {
      "no-restricted-syntax": ["error", BASE_RESTRICTED_SYNTAX[0], BASE_RESTRICTED_SYNTAX[1]],
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
  // Allow DocumentDB only inside the server-side data layer implementations and database module.
  // Loaders, helpers, and client-side data code must go through FilesAPI/ConnectionsAPI/ConfigsAPI.
  {
    files: [
      "lib/data/*.server.ts",
      "lib/database/**",
      "scripts/**",
      "**/*.test.ts",
      "**/*.test.tsx",
      "**/__tests__/**",
      "**/__mocks__/**",
      "test/**",
    ],
    rules: {
      "no-restricted-imports": "off",
    },
  },
]);

export default eslintConfig;
