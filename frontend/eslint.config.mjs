import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import unusedImports from "eslint-plugin-unused-imports";
import importPlugin from "eslint-plugin-import-x";

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
      // Prevent inline/dynamic imports (code smell indicating circular dependencies)
      // Enforce process.env access only through lib/config.ts or lib/constants.ts
      "no-restricted-syntax": [
        "error",
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
      ],
    },
  },
  // Allow process.env in the two centralized config files, scripts, and test bootstrap
  {
    files: ["lib/config.ts", "lib/constants.ts", "scripts/**", "jest.setup.js", "next.config.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "ImportExpression",
          message: "Dynamic imports (await import()) are not allowed. Use static imports at the top of the file. Inline imports indicate circular dependencies or poor architecture - fix the design instead.",
        },
        {
          selector: "CallExpression[callee.name='require']",
          message: "require() calls are not allowed. Use static ES module imports at the top of the file instead.",
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
]);

export default eslintConfig;
