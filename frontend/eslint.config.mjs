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
  name: "@earendil-works/pi-ai",
  message:
    "Do not import @earendil-works/pi-ai directly. It is isolated to orchestrator/llm/. " +
    "Import LLM types + runtime from @/orchestrator/llm (faux/test helpers from @/orchestrator/llm/testing), " +
    "and import Type/TSchema/Static directly from 'typebox'.",
};
// Subpath entrypoints (/compat, /api/*, /providers/*) need their own pattern —
// `name` only blocks the exact specifier.
const RESTRICT_PI_AI_SUBPATHS = {
  group: ["@earendil-works/pi-ai/*"],
  message: RESTRICT_PI_AI.message,
};

// Container/View convention (CLAUDE.md "Component Patterns"):
// views must be pure presentation, containers own Redux. Widen the file list here
// only as each view is actually migrated, never all at once.
//
// Deliberate exceptions, NOT in this list:
// - components/views/story/InlineNumber.tsx: its SavedNumber sub-component reads Redux
//   directly (selectMergedContent), but it's a structural peer of
//   SmartEmbeddedQuestionContainer/EmbeddedQuestionContainer — all three are dynamically
//   instantiated leaves inside StoryEmbeds' nested iframe React root, not file-level views
//   with a stable parent that could source the value via props. Moving it would just
//   rename the hook call, not remove it.
// - components/views/shared/StoryEmbeds.tsx: imports react-redux's Provider to RE-PROVIDE
//   the store to that same nested root (iframe DOM events don't bubble to the parent
//   document, so a nested root needs its own provider tree) — required architecture, not
//   a view reading Redux state. RESTRICT_VIEW_REDUX blocks the whole `react-redux` import,
//   which can't distinguish "re-providing the store" from "reading it", so this file would
//   false-positive if added.
const RESTRICT_VIEW_REDUX = [
  {
    name: "@/store/hooks",
    message:
      "Views must not read/write Redux directly (Container/View convention, CLAUDE.md " +
      "'Component Patterns'). Move the useAppDispatch/useAppSelector call into this view's " +
      "container and pass the value/callback down as a prop instead.",
  },
  {
    name: "react-redux",
    message:
      "Views must not read/write Redux directly (Container/View convention, CLAUDE.md " +
      "'Component Patterns'). Move the Redux access into this view's container and pass " +
      "the value/callback down as a prop instead.",
  },
];

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
          patterns: [RESTRICT_PI_AI_SUBPATHS],
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
      "no-restricted-imports": ["error", { paths: [RESTRICT_ADAPTER_FACTORY, RESTRICT_PI_AI], patterns: [RESTRICT_PI_AI_SUBPATHS] }],
    },
  },
  // lib/modules/db/** — adapter allowed (it IS the module), DocumentDB still restricted.
  // pi-ai stays banned (allowed only in orchestrator/llm/).
  {
    files: ["lib/modules/db/**"],
    rules: {
      "no-restricted-imports": ["error", { paths: [RESTRICT_DOCUMENTS_DB, RESTRICT_PI_AI], patterns: [RESTRICT_PI_AI_SUBPATHS] }],
    },
  },
  // lib/database/** — database internals; factory + adapter allowed. pi-ai still
  // banned (allowed only in orchestrator/llm/).
  {
    files: ["lib/database/**"],
    rules: {
      "no-restricted-imports": ["error", { paths: [RESTRICT_PI_AI], patterns: [RESTRICT_PI_AI_SUBPATHS] }],
    },
  },
  // scripts/** — DocumentDB allowed (scripts seed the DB), adapter still restricted.
  // Scripts must go through getModules().db just like everything else.
  {
    files: ["scripts/**"],
    rules: {
      "no-restricted-imports": ["error", { paths: [RESTRICT_ADAPTER_FACTORY, RESTRICT_PI_AI], patterns: [RESTRICT_PI_AI_SUBPATHS] }],
    },
  },
  // Chakra exit — EMBED TREE + re-skinned chrome (Renderer_v2 Phase 3/6a): these files are
  // kit/Tailwind now, and the story iframe's style mirror no longer carries Chakra for them.
  // "No Chakra in the embed render tree" is an `npm run validate` fact, not a review claim —
  // add each file here as its re-skin lands (lists miss things; PivotTable proved it).
  {
    files: [
      "components/kit/**/*.tsx",
      // Whole migrated trees (Renderer_v2 Phase 5): the question workbench, all viz/config
      // panels, the DOM-tier grids, and the param widgets are kit/Tailwind — new files in these
      // directories are born under the ban.
      "components/plotx/**/*.ts",
      "components/plotx/**/*.tsx",
      "components/viz/**/*.tsx",
      "components/question/**/*.tsx",
      "components/params/**/*.tsx",
      "components/query-builder/**/*.tsx",
      "components/lexical/**/*.tsx",
      "components/selectors/DatePicker.tsx",
      "components/selectors/TabSwitcher.tsx",
      "components/shared/FileSearchSelect.tsx",
      "components/shared/DeliveryPicker.tsx",
      "components/shared/RunNowHeader.tsx",
      "components/shared/SchedulePicker.tsx",
      "components/shared/StatusBanner.tsx",
      "components/containers/ReportContainerV2.tsx",
      "components/containers/AlertContainerV2.tsx",
      "components/containers/ReportRunContainerV2.tsx",
      "components/containers/AlertRunContainerV2.tsx",
      // Rendered-document views + embed chrome.
      "components/containers/SmartEmbeddedQuestionContainer.tsx",
      "components/TextBlockCard.tsx",
      "components/views/QuestionViewV2.tsx",
      "components/views/DashboardView.tsx",
      "components/views/NotebookView.tsx",
      "components/views/ReportView.tsx",
      "components/views/AlertView.tsx",
      "components/views/CodeView.tsx",
      "components/views/notebook/**/*.tsx",
      "components/views/dashboard/**/*.tsx",
      "components/views/story/StoryParamControl.tsx",
      "components/views/shared/empty-states.tsx",
      "components/views/shared/SvgPageSurface.tsx",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@chakra-ui/*", "@chakra-ui"],
              message:
                "This file is on the kit/Tailwind stack (Renderer_v2 Chakra exit) — no @chakra-ui " +
                "imports. Use components/kit primitives and Tailwind classes instead.",
            },
            {
              // The Chakra-wrapper snippets in components/ui — banned from migrated trees so a
              // regression can't sneak Chakra DOM back in. (`ui/toaster` — an imperative service
              // whose DOM lives in the app shell — and the Chakra-free `ui/Link`/`ui/Dither`
              // stay allowed.)
              group: [
                "@/components/ui/tooltip",
                "@/components/ui/checkbox",
                "@/components/ui/select",
                "@/components/ui/close-button",
                "@/components/ui/color-mode",
                "@/components/ui/resizable-panel",
                "@/components/ui/ImageLightbox",
              ],
              message:
                "This file is on the kit/Tailwind stack (Renderer_v2 Chakra exit) — use the " +
                "components/kit equivalent, not the components/ui Chakra wrappers.",
            },
          ],
        },
      ],
    },
  },
  // Container/View convention (CLAUDE.md "Component Patterns") — these views were
  // migrated to pure presentation; guard against regression. See RESTRICT_VIEW_REDUX.
  {
    files: [
      "components/views/QuestionViewV2.tsx",
      "components/views/DashboardView.tsx",
      "components/views/ConnectionFormV2.tsx",
      "components/views/TransformationView.tsx",
      "components/views/AlertView.tsx",
      "components/views/ReportView.tsx",
      "components/views/CodeView.tsx",
      "components/views/NotebookView.tsx",
      "components/views/story/StoryView.tsx",
      "components/views/shared/AgentHtml.tsx",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        { paths: [RESTRICT_DOCUMENTS_DB, RESTRICT_ADAPTER_FACTORY, RESTRICT_PI_AI, ...RESTRICT_VIEW_REDUX], patterns: [RESTRICT_PI_AI_SUBPATHS] },
      ],
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
          RESTRICT_PI_AI_SUBPATHS,
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
  // allowed to import @earendil-works/pi-ai. It also bridges to deployment config
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
