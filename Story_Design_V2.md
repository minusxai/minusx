# Story & Design Revamp V2

Stories are authored as JSX and rendered by **real shadcn/ui components** (interactive included; modal overlays excluded) via a safe React interpreter running in the parent tree, portaled into the same-origin story iframe — the architecture live embeds already use. Look and feel comes from **six themes** — pure CSS-variable token sets in one TypeScript registry — picked via a Clarify dialog with preview images. There is **one renderer**: the `svg` surface (live DOM inside `<svg><foreignObject>`), captured by serialization; **snapdom and the canvas/Takumi renderer are removed entirely**. All data visualization is **Vega, always**.

**Scope: stories only.** Dashboards, questions, and the rest of the app stay on Chakra. The one cross-cutting exception is snapdom removal (§4): it is capture plumbing, so the dashboard/question/notebook capture paths migrate too — their UI is untouched.

**Delivery: ONE branch, ONE PR** (empty body per CLAUDE.md), executed autonomously — no human gates. Phases are commit milestones in order; the PR opens at Phase 0 and closes when every §11 checklist item is done.

---

## 1. Where we are today

- **Authoring:** a story is a JSX fragment in `StoryContent.story`, compiled to static HTML by `lib/data/story/story-v2.ts` (no React runtime, no JS in output). Security gate: `validateJsxSource` against `JSX_COMPONENT_NAMES` (`lib/jsx/components.ts:10`).
- **The problem:** `STORY_COMPONENTS` (`lib/data/story/story-components.ts:64-152`) — 18 invented primitives with a private compiler/de-compiler (`emitStoryComponent`/`reverseStoryComponents`, `data-c` stamping), taught to the model through hundreds of hand-maintained prompt lines (`skill_stories` in `prompts.yaml` ~L907-930 + the schema description in `atlas-schemas.ts:497-555`).
- **Styling:** Tailwind v4 compiled server-side per save (`lib/data/story/story-css.server.ts`) into server-managed `compiledCss`; drafts preview-compile via `POST /api/story-css`. shadcn/Radix are not in the repo. Theming = one variable (`--st-accent`) + `colorMode`.
- **Renderers:** `dom`/`svg` surfaces (iframe; `lib/story-surface/`) and `canvas` (`lib/canvas-story/`, Takumi Rust→WASM, behind a settings toggle).
- **Capture:** story svg-surface serialization capture **already exists** (`lib/screenshot/capture.ts` → `serializeStorySvg` in `lib/story-surface/serialize.ts`, with style cloning, font inlining, scroll transforms); snapdom (`@zumer/snapdom`) remains for app-page elements (dashboards, questions, notebooks) and as the story fallback. Every send attaches a full-height screenshot to app state (`lib/screenshot/app-state-screenshot.ts`); `ReviewFile` captures on demand.
- **Charts:** Vega/Vega-Lite is already the default (V2 `<viz>` envelope; ECharts legacy-only). Stories embed live charts via `<Question>`/`<Number>`/`<Param>`.
- **Clarify:** options are `{ label, description? }` — no image support (`web-tools.ts:252-271` → `clarify.ts:20-23` → `UserInputComponent.tsx:190-370`).

---

## 2. Components: real shadcn/ui via React portals

**Why shadcn:** it's copy-in source — Tailwind class recipes, a CSS-variable token contract (`--background`, `--card`, `--primary`, `--radius`, `--font-*`, `--chart-1..5`), and React/Radix behavior. The model already knows this entire API from training; adopting it deletes the custom vocabulary and every prompt line teaching it.

**Registry:**
- **Static:** all of them (Card family, Badge, Button, Alert, Table family, Separator, Skeleton, Progress, Breadcrumb, Avatar, Typography, …).
- **Interactive:** Tabs, Accordion, Collapsible, Tooltip, Popover. Tooltip/Popover are patched (we own the copied source) to floating-ui `strategy:'absolute'`, portaled inside the story root, story root as collision boundary — `position: fixed` is banned (§4).
- **Excluded:** Dialog, Sheet (viewport modals don't fit a scrolling document), DropdownMenu (action menus are meaningless in a script-free document). The validator's unknown-tag error is the agent's self-correction path.
- **Embeds:** `Question`, `Number`, `Param` — plus plain HTML.
- **The HTML tag surface is an explicit allowlist too**: content tags (`div`, `span`, headings, `p`, lists, `table` family, `img`, `a`, `strong`/`em`/`code`, `style`, …) in; **`script`, `iframe`, `object`, `embed`, `base`, `form`, `meta`, `link` out** — enforced in `validateJsxSource` alongside the component allowlist.

**Rendering model:** a **JSX-AST → `React.createElement` interpreter** (no eval) over the registry renders the story body from the parent React tree via `createPortal` into the story root — exactly how `StoryEmbeds.tsx` mounts embeds today. One React tree, one Redux store, direct events; no in-iframe bundle, no postMessage bridge (possible because the iframe stays same-origin — §6b). Embeds are untouched; embed views inside stories consume the theme tokens so they match the document. The interpreter maps controlled props to uncontrolled (`value`→`defaultValue`, `open`→`defaultOpen`) since authored markup has no handlers.

**Parse restrictions come first — hard parse errors, not sanitization:** the interpreter's JSX dialect is deliberately less than JSX. **Rejected at parse: expression containers (`{...}`), spread attributes, member-expression tags (`<Foo.Bar>`), namespaced tags; prop values must be string/number/boolean literals from the AST** (no objects except a sanitized `style`). This is structural — whole classes of injection can't be *expressed*, which is the difference between an interpreter and eval with extra steps.

**Prop sanitization (a real XSS boundary — `content.story` is editable by any org user and rendered to other viewers, including public guests):** shadcn components spread `{...props}` and enumerate nothing (§12), so on top of the parse restrictions sits a global **pattern deny list**: `on*`, `ref`/`key`, `dangerouslySetInnerHTML`, style sanitization, scheme-filtering for every URL-carrying attribute (`href`, `src`, `srcset`, `xlinkHref`, `formAction`/`formaction`, `ping`), plus `srcDoc` and `is`.

**WYSIWYG editing lands in the same phase** — the current editor scrapes the DOM (`serializeEditedStory`), which dies when JSX becomes canonical and React owns the DOM. Replacement: the interpreter tags every rendered text node with its AST path; `contenteditable` is scoped (component chrome locked, text hosts editable — the existing embed-island pattern generalized); edits **commit on blur** by replacing the edited element's *children* in the JSX source — text plus inline elements (`<strong>`, `<em>`, links), since today's editor is rich contenteditable (§12 audit) and plaintext-only would regress it. **Render-during-edit guard:** React must never re-render a text host mid-edit (a Redux update — embed refetch, param change — would clobber typing). While a host has focus its subtree is frozen (memoized against upstream renders); a forced re-render commits the in-progress edit first. The editing UX is unchanged; only the save mechanism inverts. **The write-back is an injection path** (paste carries arbitrary HTML): parsed edits run through the same `validateJsxSource` + prop deny list as all other input — no editor-trusted parse.

**Legacy stories: freeze, don't migrate.** Old `data-c` stories keep rendering and round-tripping via retained legacy support; old component names leave the prompts and the new-story allowlist. Because `reverseStoryComponents` reconstitutes legacy HTML into old-component JSX, validation is legacy-aware: a `legacy: true` flag — **derived exclusively from the STORED HTML** carrying a `data-c` attribute (attribute parse, not substring; never accepted from input, so it cannot be authored into a new story as a validation bypass) — lets `validateJsxSource` accept old names for legacy stories only.

**Prompt/schema rewrite:** the per-component docs in `skill_stories` and the schema description shrink to ~3 lines: *"Write shadcn JSX — the registered component set (the schema carries the exact name list), standard props/variants/className — plus plain HTML with Tailwind utilities and the shadcn tokens. No scripts, no event handlers; interactive components carry their own behavior."*

---

## 3. Styling: Tailwind tokens + compile hardening

**Token layer:** extend `TW_INPUT` (`story-css.server.ts`) with the standard shadcn v4 preamble — `@theme inline { --color-card: var(--card); … }` so `bg-card`, `text-muted-foreground`, `rounded-lg` etc. compile — plus a neutral `:root`/`.dark` default block for themeless stories. Keep `@custom-variant dark`. `--st-accent` dies; accent = the theme's `--primary`.

**Server compilation stays:** save-time compile produces a few KB of exactly-used rules — zero client cost, deterministic, static (what the self-contained capture document needs). The shadcn recipes are Tailwind classes too: precompile a base sheet from the registry source once (§12: all class strings are static, so this is complete), union with per-story candidates. Draft preview-compile via `POST /api/story-css` already covers code-view edits; unknown classes are silently unstyled, never an error.

**Hardening (Phase 0 — DONE):** `withCompiledStoryCss` is awaited uncaught in `createFile`/`saveFile` (`lib/data/files.server.ts`), so any `build()` throw fails the whole save; the preview route shares the exposure. **Empirical correction (probed during implementation):** no malformed candidate shape throws in the current Tailwind v4 — 40+ shapes tested (`w-[calc(100%`, unbalanced brackets/quotes, etc.) all compile or no-op. The guard is therefore protective, not a repro fix: `buildSalvaging` (in `story-css.server.ts`) wraps `build()`, bisects out any candidate a future Tailwind rejects, compiles the survivors, and logs the dropped tokens. It never throws — a save can never fail on a bad class token, tested via an injected throwing build.

---

## 4. Renderer & capture: one surface, serialization

**One renderer, no setting.** The `svg` surface (`lib/story-surface/` — live, interactive DOM inside `<svg><foreignObject>`) is both the render surface and the capture source. **Deleted in Phase 2:** the canvas/Takumi renderer (`lib/canvas-story/`, `CanvasStoryView`, the "Use Canvas Renderer" setting + `useCanvasRenderer` config, Takumi WASM assets, their tests) — it cannot render the new shadcn markup and parity work is closed, so its toggle would only produce broken output — and the plain `dom` surface, strictly dominated by `svg`. All git-recoverable.

**Capture pipeline** (replaces snapdom everywhere): `XMLSerializer` over the live surface → **`data:image/svg+xml;charset=utf-8,` + `encodeURIComponent(xml)`** → `<img>` → canvas → JPEG/PNG. Validated on all three engines (§12); Blob URLs are forbidden — they taint the canvas in Chromium and WebKit. Resources inside the SVG must be inline data-URIs (SVG-as-image blocks all external references).

**snapdom is removed in one phase, all capture paths** — stories, dashboards, questions, notebooks, and the OG share-card path (`lib/og/capture-story-preview.ts`); `@zumer/snapdom` uninstalled at the end of Phase 2. No fallback flag: snapdom is already unusable on the old browsers motivating this work. Note the story serialization path **largely exists** (`serializeStorySvg`); Phase 2's real construction is the app-page paths. Internal order de-risks accordingly: harden the story path → migrate app-page paths against the matrix → uninstall last. The gatekeeper is the matrix, green on **Chromium + WebKit + Firefox** before the uninstall commit.

**App-page capture specifics** (dashboards/questions are live Chakra pages; Emotion styles are same-origin `<style>` elements — readable and collectable):
- **`<canvas>` content** serializes empty — designed out: charts are Vega-only, forced to Vega's SVG renderer in captured surfaces; ECharts capture is unsupported (decision 9).
- **`fixed`/`sticky` app chrome** (unbannable in the app): renders at its document-flow position, as in a scrolled-to-top full-page capture; transient portal popovers are dropped by the fixup pass. Divergence from snapdom's output is accepted — the bar is content complete and legible.
- **Form state:** the fixup pass stamps `input`/`textarea` values as attributes (DOM properties don't serialize).

**Self-contained document** (the rasterizing canvas taints on any external fetch):
- **Styles live inside the story root**, not the iframe `<head>` — head styles would be missing from the serialized SVG. `compiledCss`, theme tokens, and font CSS go in `data-mx-*`-tagged nodes; every save path that reads root contents drops `data-mx-*` nodes (else derived CSS compounds into `content.story`). One filter + a render→save byte-identity test.
- **Fonts: one shared static asset per theme, two forms.** Live view loads fonts by **URL** (a cacheable static asset — no data-URI payload on every story view); the **data-URI form exists only in the capture-time parsed copy**, spliced in during serialization (300KB–1MB blocks; never in per-story `compiledCss`, never in the live DOM). Both generated from the theme registry.
- **Images** data-URI'd/inlined at save/serialize time.
- **Await `document.fonts.ready` + image decode before rasterizing** — the dominant cause of "blank in Safari" captures elsewhere is racing resource decode.

**Banned CSS** — one exported constant, three enforcement points (prompt line, sanitizer strip on `<style>`/inline styles, Tailwind candidate filter):
1. `position: fixed`/`sticky` — containing-block semantics break inside foreignObject. The registered floating components are already patched to `absolute`, so no `fixed` exists in a story, authored or component-internal.
2. **Every external-fetch CSS construct** — `url()`/`src()` tokens and `@import` at-rules; only `data:` URIs pass. Dual purpose: exfiltration guard (CSS fetches from guest viewers) and capture-taint guard. Arbitrary-value classes (`bg-[url(…)]`, `content-[…]`) are caught **at the candidate level, before compile** — and the candidate filter is a separate step from Phase 0's error-bisect, so the hardening path can never silently absorb a guard reject as a "bad token." (Frozen legacy stories keep `@import` fonts live; captures fall back to system fonts — accepted.)

Everything else needs no rejection: foreignObject renders with the real browser engine, so whatever renders live captures identically.

**Ephemeral state in captures:**
- **Scroll:** offsets don't serialize. Visual fix: record `scrollTop/scrollLeft`, apply as `translate(-x,-y)` transforms in the parsed copy (live DOM untouched) — the capture shows exactly what the user sees, both axes. Textual fix: per-element scroll offsets in app state (generalizing the story `<Viewport>` pointer).
- **Click-driven component state** (selected tab, open accordion) captures faithfully — real DOM mutation.
- **Hover** does not capture — transient; accepted.

---

## 5. Themes: six token sets, one registry

**A theme is CSS custom-property values only** (the shadcn/tweakcn convention). Components and utility classes are identical across themes; a theme swaps `--primary`, `--radius`, fonts, `--chart-1..5`. Playful = `--radius: 1rem`; industrial = `--radius: 0`.

**Authoring: one JSON-shaped TS object per theme** — `{ name, label, fonts, cssVars: { light, dark } }` in `lib/data/story/story-themes.ts`. One source, four consumers: CSS emitter, picker UI, preview-image generation, font-asset generation. All six ship as tiny `[data-theme="<name>"]`-scoped variable blocks — instant in-app preview, no recompile. Themes set defaults only; agent CSS is injected after and wins.

| Theme | Personality | Radius | Fonts (display / body) | Palette feel |
|---|---|---|---|---|
| **Modernist** | stark editorial, Swiss | 0 | Archivo / Inter | white, near-black, one red accent |
| **Classical** | old-print, bookish | sm | Cormorant Garamond / Lora | cream, ochre/sepia |
| **Nocturne** | dark-first, technical | md | Inter / Inter | deep navy, violet accents |
| **Organic** | warm, soft, playful | xl | Fraunces / Figtree | sand, terracotta, olive |
| **Broadsheet** | newspaper/report | sm | Source Serif 4 | paper white, ink, steel blue |
| **Industry** | professional, square | 0–xs | Barlow Condensed / Barlow | slate, industrial blue |

**Plumbing:** `theme: Optional(Nullable(StringEnum))` on `StoryContent` (sibling of `colorMode`, authored `<theme>nocturne</theme>`); `data-theme` stamped on the story root; a settings picker rendered from the registry. **`--chart-1..5` drive Vega chart colors** via the envelope render config. **Preview images** (`public/story-themes/<name>.png`) are generated by the real renderer (Playwright over a canonical sample fragment) so they're truthful and regenerate on theme changes.

---

## 6. Agent ↔ app

### 6a. Theme picking via Clarify (no new tool)

- **Layer A — image options:** optional `imageUrl` + real `value` on the Clarify option schema (`web-tools.ts`), threaded through `user-input-exception.ts` → handler (`clarify.ts`, which currently drops extra fields) → `UserInputComponent.tsx` card-grid branch (image top, label + check below) → `ClarifyDisplay.tsx`, `clarify-answer-stash.ts`. Radio/checkbox semantics, "Other", "Figure it out" all kept.
- **Layer B — `type: 'design'` preset:** when set, `options` is ignored and the frontend handler populates the six theme options from the registry (label, description, preview). The model's call is one line; the list can't drift; the result returns the theme `name` via `value` PLUS the theme's registry description (personality, fonts, palette feel) so the agent can write custom CSS that harmonizes with the chosen theme without guessing. The next app-state screenshot shows the themed render — no need to return images to the model.
- **Prompt wiring:** new story or look/feel question → call Clarify with `type:'design'`; honor "figure it out" by choosing.

### 6b. Agent reading rendered state — existing pipeline only

Every send already attaches a full-height screenshot; `ReviewFile` captures on demand with rubric + LLM judge; `EditFile review:true` re-screenshots. Prompt work only: review after visual edits. **No story-JS/query tool ships** — arbitrary iframe JS can only be made safe with an opaque-origin sandbox, which would kill the parent's `contentDocument` access and force the embeds + interpreter into an in-iframe bundle with a postMessage bridge — an architecture serving one tool. If a need appears later, the shape is a closed-verb query API run by trusted code (never eval, never a sandbox).

### 6c. Headless capture (Slack, benchmarks) — swappable module, Playwright backend

**Seam:** `renderStoryToImage(story) → bitmap`; callers never know the backend.

**Backend: Playwright, spawned from Node in the same container.** It renders through the identical serialize path users see (zero fidelity work) and the repo already carries Playwright infra. Lifecycle keeps it cheap: lazy singleton (launch on first capture), ~60s idle shutdown, concurrency semaphore (1–2) bounding memory at one browser + a page (~150–400MB, bursty CPU), env-gated (no Chromium → capability unavailable, callers degrade gracefully — the feature is additive). A separate capture service is a later transport swap behind the seam, justified only by volume/replicas/isolation.

**No browserless backend exists**: Node SVG rasterizers ignore `foreignObject`; Satori is a flexbox-only subset that can't express this markup; Takumi is deleted. Headless capture requires a browser — a fact of the problem.

**Interim state is safe:** headless runs have no story screenshots today, so this phase is purely additive.

---

## 7. Vega-always for data visualization

The failure mode: asked for a chart, the agent hand-builds it in HTML/CSS divs. Two enforcement layers (both land inside Phase 1's prompt/schema rewrite — not a separate phase):
1. **Prompt rule** (`skill_stories` + `skill_questions`): anything that visualizes data MUST be a `<Question>` embed with a `<viz>` envelope; never approximate charts in HTML/CSS; reproduce reference images as Vega-Lite specs. HTML remains correct for stat tiles, callouts, layout.
2. **Review rubric:** "no hand-drawn charts — all data visuals are live embeds" in `ReviewFile` — hand-drawn charts are visually obvious to the judge.

---

## 8. Milestones (one branch, one PR, in this order)

- **Phase 0 — live-bug fix:** compile hardening (§3). Independent; first commits on the branch.
- **Phase 1 — shadcn foundation (§2, §3):** registry install + Radix-in-surface harness check, interpreter, sanitization, WYSIWYG rework, token preamble + base sheet, prompt/schema rewrite (including the Vega-always rules, §7), legacy validation.
- **Phase 2 — renderer & capture (§4):** svg-only rendering, canvas renderer deleted, serialization capture everywhere (stories hardened first, then app paths), snapdom uninstalled last, banned-CSS enforcement, three-engine matrix.
- **Phase 3 — themes (§5):** registry, schema field, token blocks, picker, Vega colors, font assets, preview images.
- **Phase 4 — Clarify + picker (§6a):** needs Phase 3's registry + previews.
- **Phase 5 — headless capture (§6c).**
- **Later, outside this plan:** optional one-shot migration of legacy `data-c` stories, after which legacy support can be deleted. Not scheduled.

---

## 9. Resolved decisions

1. **Stories only.** No app-wide Chakra→Tailwind migration; snapdom removal is the one cross-cutting exception (Chakra is no obstacle — Emotion styles are readable same-origin `<style>` elements).
2. **Legacy stories: freeze, don't migrate**, with legacy-mode validation so re-saves don't self-reject.
3. **One renderer, no renderer setting.** Canvas/Takumi and the `dom` surface are deleted in Phase 2.
4. **snapdom removal completes in Phase 2** — all capture paths, dependency uninstalled, no fallback flag (snapdom is already broken on the browsers that motivate this). The three-engine test matrix is the gate.
5. **Capture URL scheme: percent-encoded `data:` URL, never Blob URL** (Blob taints Chromium/WebKit — §12).
6. **Overlays excluded** (Dialog/Sheet/DropdownMenu); interactive set is Tabs/Accordion/Collapsible/Tooltip/Popover.
7. **No story-JS tool** — same-origin iframe is what makes the parent-tree architecture possible; future shape is a closed-verb query API, never eval.
8. **PDF/share captures show the default state** (fresh render) — a capture is a document artifact, not a session snapshot.
9. **Charts are Vega-only; ECharts capture unsupported** — Vega forced to SVG renderer in captures, so nothing draws to `<canvas>`. (Escape if ever needed: `toDataURL()` frozen-bitmap stamp, ~10 lines.)
10. **Vega-always enforcement is prompt rule + visual rubric** (a save-time HTML heuristic lint was dropped as weaker than both).
11. **Themes: take the §5 table as-is**; ship all six token blocks; previews generated by the real renderer.
12. **`--chart-1..5` drive Vega colors** via the envelope render config.
13. **Headless capture: swappable-backend module, Playwright backend, same-container spawn** — a separate service is a later transport swap; no browserless backend exists.

## 10. Open questions

None.

---

## 11. Execution checklists

An item is checked only when its tests exist, went red before implementation, and are green now (TDD per CLAUDE.md). Each phase ends with: `npm run validate` clean → `npm test` green → browser-verify on the dev server (for chat: read the side-chat debug message) → commit + push.

### Phase 0 — compile hardening
- [x] Empirical probe: no current Tailwind input throws (40+ malformed shapes tested) — doc corrected; the guard protects against future `build()` throws at the uncaught await sites.
- [x] Red test: `buildSalvaging` contract tested with an injected throwing build (drops exactly the bad candidates, compiles survivors together, never throws even when everything fails).
- [x] `compileStoryCss` hardened: `build()` runs through `buildSalvaging`; dropped candidates logged; malformed-token integration tests on the compile + save paths.
- [ ] Browser-verified by hand-editing story CSS in code view (done in the consolidated browser pass).

### Phase 1 — shadcn foundation
- [ ] shadcn/ui + Radix copied into `lib/story-ui/`; registry per §2 (overlays absent); Tooltip/Popover patched to `absolute`, portaled in the story root.
- [x] Radix-in-surface check: real Tabs + patched (portal-free, absolute) Popover in the svg surface — interaction + serialize-capture pass on Chromium, WebKit, Firefox (§12).
- [ ] Interpreter: JSX-AST → `React.createElement` from the parent tree via `createPortal` (StoryEmbeds pattern); no eval; controlled→uncontrolled prop mapping; prop deny list wired in.
- [ ] Parse restrictions (hard parse errors, red tests each): expression containers `{...}`, spread attributes, member-expression tags (`<Foo.Bar>`), namespaced tags all rejected; prop values only string/number/boolean literals (objects only as sanitized `style`).
- [ ] Sanitization tests (hostile code-view user): `on*`, `dangerouslySetInnerHTML`, `ref`/`key`, `formAction`, `srcDoc`, `is`, style injection blocked; every URL-carrying attribute (`href`, `src`, `srcset`, `xlinkHref`, `ping`) scheme-filtered and fuzzed (`java\tscript:`, mixed-case, entity-encoded, unicode confusables); real component usage passes.
- [ ] Embeds regression: `Question`/`Number`/`Param` render, execute, edit exactly as before; embed views consume theme tokens.
- [ ] `validateJsxSource`: new allowlist (registry + HTML allowlist + embeds); `legacy: true` from `data-c` attribute detection; red test: legacy re-save validates, new story with old names rejects.
- [x] WYSIWYG: scoped `contenteditable` (chrome locked, text hosts editable), commit on blur, children-level AST write-back through `validateJsxSource` + deny list; hostile-paste test (`onclick`/`<iframe>`/`javascript:` sanitized out); round-trip test including a bolded word.
- [x] Render-during-edit guard: a focused text host's subtree is frozen against upstream re-renders; forced re-render commits first. Test: trigger a Redux update (embed refetch) mid-edit → typed text survives.
- [ ] `TW_INPUT` preamble + neutral defaults; base sheet from registry source unioned with per-story candidates.
- [ ] Prompt/schema rewrite: per-component docs deleted, ~3-line contract in; `--st-accent` removed; Vega-always prompt rule in `skill_stories` + `skill_questions` (data visuals are `<Question>`+`<viz>` embeds, never HTML/CSS approximations) and the `ReviewFile` rubric line "no hand-drawn charts — all data visuals are live embeds" (§7).
- [ ] E2E via faux LLM: agent authors a shadcn story; renders interactively; saves; reloads identically.

### Phase 2 — renderer & capture
- [ ] Canvas renderer deleted: `lib/canvas-story/`, `CanvasStoryView`, "Use Canvas Renderer" setting + `useCanvasRenderer` config, Takumi WASM assets, tests; grep shows zero references to `canvas-story`/`takumi`/`useCanvasRenderer`. `dom` surface removed as an option; svg is the only render path.
- [ ] Capture pipeline: `XMLSerializer` → percent-encoded `data:` URL → `<img>` → canvas → JPEG; awaits `document.fonts.ready` + image decode.
- [ ] Styles inside the story root as `data-mx-*` nodes; save paths strip them; byte-identity test (render → save → `content.story` unchanged).
- [ ] Font-asset mechanism with the neutral default's fonts (Phase 3 extends per theme); image inlining.
- [ ] Parsed-copy fixup pass: scroll-offset transforms + `input`/`textarea` value stamping; scroll offsets added to app state; Vega forced to SVG renderer in captures.
- [ ] Banned-CSS enforcement at all three points: `fixed`/`sticky` + external `url()`/`src()`/`@import` (`data:`-only).
- [ ] Migrations: story, dashboard/question/notebook (`lib/screenshot/*`), and OG (`lib/og/capture-story-preview.ts`) captures all on serialization; grep shows zero snapdom imports.
- [ ] Matrix green on Chromium + WebKit + Firefox: external images, cross-origin fonts, full-app-stylesheet pages, a dashboard fixture with `fixed`/`sticky` chrome (§4 expected behavior), Vega-SVG charts (incl. one large-dataset perf fixture), form-control state, external-`url()`/`@import` stripped-and-untainted, explicit `width`/`height` on the SVG root.
- [ ] Final commit: `@zumer/snapdom` uninstalled.

### Phase 3 — themes
- [ ] `story-themes.ts`: six themes per §5, each `{ name, label, fonts, cssVars: { light, dark } }`.
- [ ] `StoryContent.theme` in `atlas-schemas.ts`; `<theme>` authored; `data-theme` stamped on the root.
- [ ] All six `[data-theme]` blocks in the compiled output; agent CSS wins on conflict; theme switch needs no recompile.
- [ ] Settings picker rendered from the registry (aria-labels per repo test rules).
- [ ] Vega consumes `--chart-1..5`; visual check: same story, six themes, charts recolor.
- [ ] Per-theme font assets (extending Phase 2's mechanism); preview-generation script (`frontend/scripts/`, Playwright over a canonical fragment); six PNGs committed to `public/story-themes/<name>.png`.

### Phase 4 — Clarify + theme picker
- [x] Option schema gains `imageUrl` + real `value`; threaded through `user-input-exception.ts`, `clarify.ts`, `ClarifyDisplay.tsx`, `clarify-answer-stash.ts`.
- [x] `UserInputComponent.tsx` card-grid branch; radio/checkbox, "Other", "Figure it out" preserved; `getOptionKey` uses real `value`.
- [x] `type:'design'` preset: options populated (TEMPORARY hardcoded §5 list in `lib/branding/story-theme-options.ts` until Phase 3's `story-themes.ts` registry lands); result returns theme `name` via `value` plus its personality `description`.
- [x] Prompt wiring: new story / look-feel question → Clarify `type:'design'`.
- [ ] E2E via faux LLM: design Clarify → card pick → `<theme>` written → themed render in next screenshot.

### Phase 5 — headless capture
- [ ] `renderStoryToImage(story) → bitmap` module with a backend interface.
- [ ] Playwright backend: story route loaded headlessly, captured through the same serialize path; lazy singleton, ~60s idle shutdown, semaphore (1–2), env-gated with graceful degradation.
- [ ] Slack (`run-turn.server.ts`) + benchmark runs attach story screenshots when available.
- [ ] Fidelity test: headless vs client capture of the same fixture; pixel-diff under an explicit threshold recorded in the test file.

---

## 12. De-risk validation results (run 2026-07-21, pre-implementation)

Executed, not assumed: a Playwright harness (Chromium, WebKit, Firefox) drove a self-contained `<svg><foreignObject>` page — absolute-positioned overlay, click-toggled panel, text input, inline SVG chart — through the full §4 capture pipeline (fixup → `XMLSerializer` → URL → `<img>` → canvas → pixel + taint assertions).

| Check | Chromium | WebKit | Firefox |
|---|---|---|---|
| Absolute positioning inside foreignObject (exact rects) | pass | pass | pass |
| Live interactivity (click state, input typing) | pass | pass | pass |
| Click-state + stamped input value in serialized XML | pass | pass | pass |
| All content pixels present after rasterize | pass | pass | pass |
| Rasterize via SVG **Blob URL** | **TAINTED** | **TAINTED** | ok |
| Rasterize via percent-encoded **`data:` URL** | **ok** | **ok** | **ok** |

**shadcn registry source analysis** (`shadcn-ui/ui` `new-york-v4`: button, card, tabs, accordion, popover, tooltip, badge, alert, table, collapsible): zero template literals — all class strings static, so the precompiled base sheet is provably complete; every component spreads `{...props}` — no enumerable prop lists, so the pattern deny list is the mechanism by necessity; no `fixed`/`sticky` in any static recipe — the only positioning surface is the Radix Popover/Tooltip portal, which §2 patches.

**Editor audit** (code-verified): `AgentHtml.tsx:387` applies full rich `contentEditable` — inline formatting works today, so the write-back must handle inline-element children (plaintext-only ruled out).

**Radix-in-surface (run during Phase 1, real dependency):** actual `@radix-ui/react-tabs` + portal-free `@radix-ui/react-popover` (the story patch: no Portal, `[data-radix-popper-content-wrapper]{position:absolute}`) bundled with esbuild and mounted inside `<svg><foreignObject>` on all three engines — tab switching works, the popover opens visible with an `absolute` wrapper (x:0, y:73–78 across engines), open state serializes, and the capture rasterizes untainted with both panels' pixels present. Chromium / WebKit / Firefox: all pass. Every §12 assumption is now validated with real dependencies.
