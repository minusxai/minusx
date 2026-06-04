# E2E tests (Playwright) — Tests/QA/Evals Arch V2, Phase 4

Real-browser end-to-end tests that drive the actual app booted under `E2E_MODE`
(faux LLM via `/api/test/faux`, SVG charts, Redux store on `window.__MX_STORE__`).

## Run

```bash
cd frontend
npm run test:e2e          # headless
npm run test:e2e:ui       # Playwright UI mode
npx playwright test smoke.spec.ts   # a single spec
```

The `webServer` in `playwright.config.ts` boots `npm run dev` on port **3100** with
its **own** `distDir` (`.next-e2e`) and PGLite dir (`data/pglite-e2e`), so it never
collides with a `next dev` you already have running on 3000.

## Harness

- **`playwright.config.ts`** — webServer (E2E env), a `setup` project the `chromium`
  project depends on, serial workers (tutorial reset is global-per-company).
- **`auth.setup.ts`** — registers the workspace admin (idempotent), logs in via the
  dev `password === email` shortcut, marks onboarding complete via `POST /api/configs`,
  and saves `storageState`.
- **`fixtures.ts`** — per-test faux-channel reset + a `resetTutorial` fixture.
- **`../flows/e2e.ts`** — DOM-driver helpers (`enterSideChatMessage`, `assertRedux`,
  `getState`) that mirror the node helpers (`../flows/node.ts`) name-for-name.
- **`../flows/e2e-faux.ts`** — `setFauxLLM` / `assertLLMReceived` / `resetFauxLLM` over
  the `/api/test/faux*` channel.

Specs use `aria-label` locators (`getByLabel`) per the project convention.

## jsdom `ui` project — migration status (READ BEFORE DELETING)

The plan was to port the `*.ui.test.tsx` suite to Playwright and remove the jsdom
`ui` vitest project. On inventory, that is **not a clean swap**: of **145** tests
across 24 files, only ~24 are genuine full-app flows; ~120 are **component-unit or
hook tests with no browser-E2E equivalent**. Deleting them would be coverage loss,
not a port. So the `ui` project is **kept** for now. Categorization:

**Portable to E2E (flow-shaped) — migrate here over time (~24):**
- `agent-e2e.ui.test.tsx` (18) — full agent turn (send → tool → reply). `chat-flow.spec.ts` covers the basic case.
- `streaming-render.ui.test.tsx` (1), `conversations-page.ui.test.tsx` (2)
- `connection-wizard/.../onboarding-wizard-e2e` (3), `onboarding-context-flow` (1)

**NOT portable — keep as jsdom/unit (~120):**
- **Hook logic:** `use-deep-stable` (5), `use-stable-callback` (6) — referential stability; no DOM/E2E meaning.
- **Render/perf:** `chat-rerender` (1), `conversation-too-long-gate` (2) — assert render behavior, not user flow.
- **Component units:** `viz-components` (36), `file-ui` (14), `context-docs-editor` (10), `feedback-block` (7),
  `chat-input*` (9), `generic-selector` (3), `bulk-move` (6), `echart` (1), `error-message-render` (2),
  `suggested-questions` (1), `legacy-chat` (2), `context-whitelist-merge` (2), etc. — isolated component
  behavior with specific props/mocks; an E2E equivalent would be slower, flakier, and lower-resolution.

**Recommended path:** migrate the flow-shaped tests into Playwright incrementally (each
becomes a spec here), and **keep the jsdom `ui` project** for component/hook units —
they are the fast, high-resolution layer of the pyramid. Revisit a full removal only if
the component-unit set itself is retired. Do not delete the `ui` project wholesale.
