import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import unusedImports from "eslint-plugin-unused-imports";

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
    },
    rules: {
      // Disable base rules as they are replaced by unused-imports
      "@typescript-eslint/no-unused-vars": "off",
      "no-unused-vars": "off",
      // Enable unused-imports rules
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
      // Prevent inline/dynamic imports (code smell indicating circular dependencies)
      "no-restricted-syntax": [
        "error",
        {
          selector: "ImportExpression",
          message: "Dynamic imports (await import()) are not allowed. Use static imports at the top of the file. Inline imports indicate circular dependencies or poor architecture - fix the design instead.",
        },
      ],
    },
  },
]);

export default eslintConfig;
