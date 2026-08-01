# UI components

Everything under `frontend/components` — everything the browser renders except the chart engine
itself: the Container/View separation, the kit/Chakra split, the chat UI, and the
rendered-document surfaces. `components/viz/` (Vega) and `components/plotx/` (DOM-tier tables, viz
config panels, download helpers) are a separate area; this tree consumes them and never
reimplements them.

> Part of the MinusX project documentation. The root `CLAUDE.md` carries the system
> overview, the module map and the development principles that apply everywhere.

## What each module owns

| Module | Owns | Does NOT own |
|---|---|---|
| `containers/` | All Redux reads/writes for a file page; derives props for its view | Any presentation |
| `views/` | Pure presentation of one file type | Redux, fetching, save/publish |
| `kit/` | Vendored shadcn primitives (Radix + Tailwind + `cva`) | App state, Chakra, data |
| `ui/` | The surviving Chakra wrappers (`toaster`, `select`, `checkbox`, `close-button`, `color-mode`, `ImageLightbox`, `GenerateButton`) plus the Chakra-free `Link`/`Dither` | Anything on the kit stack |
| `file-browser/` | The file page shell: `FileLayout` → `FileView` → `FileHeader` + type container; folder/list/grid browsing, drag-move, bulk select | File-type rendering (delegated) |
| `explore/` | The whole chat surface: composer, transcript, timeline/carousel, per-tool displays, debug modals | Tool *config* (`lib/tools/tool-config.ts`) and tool *execution* (`lib/tools/handlers/*`) |
| `app-shell/` | Providers, sidebars, create menu, mobile chrome, localStorage→Redux flag hydration (`DataLoader`) | Page content |
| `question/`, `params/`, `query-builder/`, `lexical/` | Question workbench pieces: viz dispatch, parameter widgets, Monaco SQL + semantic explorer, the Lexical rich-text editor with `@`-mentions | Chart rendering |
| `modals/`, `selectors/`, `schema-browser/`, `screenshot/`, `banners/`, `share/`, `dev/`, `Markdown/` | Cross-cutting leaf surfaces | — |
| `settings/`, `context/`, `connection-wizard/`, `evals/`, `config/` | Admin/authoring surfaces (users, LLM models, integrations, context + semantic-model editing, onboarding wizard, eval authoring, the custom-agent builder). All still Chakra. | — |

Direction of dependency on the chart area: `views/QuestionViewV2.tsx` and
`views/notebook/NotebookSqlCell.tsx` import `components/plotx/` config panels and
`components/viz/` renderers directly. Views compose plotx/viz; plotx/viz never import views.

## Container / View separation

Enforced by convention *and* by ESLint. `frontend/eslint.config.mjs` defines `RESTRICT_VIEW_REDUX`
(bans `@/store/hooks` and `react-redux`) and applies it to a hardcoded list of view files. The
convention currently holds across the whole `views/` tree: the only two files under
`components/views/**` that import Redux at all are the two documented exceptions —
`views/story/InlineNumber.tsx` (a dynamically instantiated embed leaf, structural peer of the
embed containers) and `views/shared/StoryEmbeds.tsx` (imports `react-redux`'s `Provider` to
*re-provide* the store to a nested iframe root, not to read it).

```
app/f/[id]/page.tsx
  └─ FileLayout (breadcrumb, right sidebar, edit banner)
       └─ FileView                      ← useFile(id); picks visual vs Code
            ├─ FileHeader               ← name/description, edit mode, save, publish, Present
            └─ getFileComponent(type)   ← lib/ui/fileComponents.tsx
                 └─ <Type>ContainerV2   ← ALL Redux for the page
                      └─ <Type>View     ← props only
```

`FileView` centralizes the visual-vs-code decision: when `uiSlice.fileViewMode[id] === 'json'` it
renders `views/CodeView.tsx` (editable JSON + read-only agent XML via `fileToMarkup`) instead of
the type view. No type view carries its own JSON branch.

Two generic bridges let a view push chrome up into the shared header without a command bus:
`file-toolbar/FileToolbarContext.tsx` (`useFileToolbarActions(memoizedActions)` in the view →
`useFileToolbar()` in `FileHeader`) and `file-toolbar/PresentationContext.tsx` (native Fullscreen
API via `useSyncExternalStore`; `FileHeader` offers the toggle for `PRESENTABLE_TYPES`).

## The kit / Chakra split

Two design systems coexist. `components/kit/` is the Tailwind v4 + vendored-shadcn stack; app
shell, admin and form surfaces are Chakra v3. The boundary is not "new vs old" — it is a
**per-file allowlist** in `eslint.config.mjs` that bans `@chakra-ui/*` imports (plus five of the
Chakra wrappers under `components/ui/` — `checkbox`, `select`, `close-button`, `color-mode`,
`ImageLightbox`; `toaster` and `GenerateButton` and the Chakra-free `Link`/`Dither` stay allowed) in
named files and whole trees. Inside this area the ban covers `components/kit/**`,
`components/plotx/**`, `components/viz/**`, `components/question/**`, `components/params/**`,
`components/query-builder/**`, `components/lexical/**`, the rendered-document views
(`QuestionViewV2`, `DashboardView`, `NotebookView`, `ReportView`, `AlertView`, `CodeView`,
`views/notebook/**`, `views/dashboard/**`, `views/shared/empty-states.tsx`,
`views/story/StoryParamControl.tsx`), the embed containers, and a handful of named `shared/` and
`selectors/` files. Everything else may still use Chakra.

The reason is not taste: rendered documents mount inside an iframe surface where Chakra/emotion
rules from the top document never reach. A Chakra style prop on a component that renders inside a
story or dashboard resolves to nothing.

## Chat UI

`explore/ChatInterface.tsx` is the single chat component; `app-shell/RightSidebar.tsx` mounts it
with `container="sidebar"` and `app/explore/[[...id]]/page.tsx` with `container="page"`.

There are **two independent "compact" notions**, and they are unrelated:

- `viewMode` = `'detailed'` when `uiSlice.showExpandedMessages` is on, else `'compact'` (default).
- `isCompact` = `container === 'sidebar' || containerWidth < 900` — pure layout density.

Routing by `viewMode`:

```
compact (default)                        detailed
─────────────────                        ────────
groupIntoTurns(allMessages)              allMessages.map(...)
  └─ AgentTurnContainer (memo)             └─ SimpleChatMessage per message
       ├─ SimpleChatMessage (user msg)          └─ role==='tool' → ToolCallDisplay
       ├─ buildTimeline() → TimelineNode[]           └─ getToolConfig(name).displayComponent
       │    ├─ CompactTimelineBar   (isCompact)
       │    └─ VerticalTimelineRail (wide)
       │         └─ AgentTurnDetailPane
       │              ├─ 'agent' → thinking/content box
       │              ├─ 'query' → ChartCarousel
       │              └─ 'tool'  → DETAIL_CARD_BY_TOOL → DetailCarousel
       ├─ PendingClarifyPanel (outside the working area)
       └─ SimpleChatMessage (last reply → ToolCallDisplay → ContentDisplay)
```

So `ToolCallDisplay` is reached in **both** modes: as the per-message row in detailed, and via the
turn's user message / final reply in compact.

`buildTimeline` (`explore/agentTurnTimeline.ts`) collapses the flat message list into nodes:
`CHAT_TOOLS` messages coalesce into `agent` nodes, `ExecuteQuery` into `query` nodes, everything
else into `tool` nodes keyed by `getToolConfig(name).chipLabel` (so `SearchFiles` and
`SearchDBSchema` merge — both label `search`). The **last** chat message is spliced out of the
timeline and rendered below the working area as the reply.

Per-tool presentation is configured in `lib/tools/tool-config.ts` (not under `components/`):
`{ displayComponent, chipLabel, chipLabelPlural, chipIcon, timelineVerb }`, with
`DEFAULT_TOOL_CONFIG` for unknown tools. Each per-tool display file in `explore/tools/` exports a
default (the compact row) and, where it appears in the carousel, a named `*DetailCard`
(`WebSearchDisplay.tsx` is carousel-only and has no default export; `DetailCarousel.tsx`,
`ChartCarousel.tsx` and `StreamingProgress.tsx` are shared infrastructure, not tool displays).
Two independent null
switches exist: `displayComponent: null` in `tool-config.ts` suppresses the compact row
(`ClarifyFrontend`, `LoadSkillFrontend`, `WebSearch`), and a `null` value in `DETAIL_CARD_BY_TOOL`
(`explore/AgentTurnDetailPane.tsx`) skips the tool in the carousel — currently nothing uses the
latter, but the filter is live.

Interactive tools pause the orchestrator. `ToolCallDisplay` looks up the conversation by
`tool_call_id` (`makeSelectConversationByToolCallId`) and, if a `pending_tool_calls[].userInputs`
entry has `result === undefined`, renders `explore/UserInputComponent.tsx` instead of the tool
display. Answering dispatches `setUserInputResult` into `chatSlice` — the component never issues
HTTP; the chat middleware resumes the turn. Clarify answers are additionally stashed client-side
(`lib/chat/clarify-answer-stash`) so a reload before the resume turn commits doesn't re-ask.
**Exception:** when `conversation.remoteSession.active`, inline prompts suppress themselves and
`remote/RemoteSessionPrompts.tsx` is the sole renderer — a floating card stack on every page,
because a remote agent routinely navigates the user away from the session's chat view.

## Rendered-document surfaces

Stories and dashboards both render inside a **same-origin iframe** whose body contains an
`<svg><foreignObject>` surface (`lib/story-surface`, attribute `data-mx-story-svg`). React mounts
a *nested root inside that iframe document* — iframe DOM events don't bubble to the parent, so
delegation from the main root would never see clicks.

```
StoryContainerV2 → views/story/StoryView.tsx
      └─ views/shared/AgentHtml.tsx        ← builds the iframe, mounts the surface
           ├─ format:'jsx' → views/shared/StoryJsxBody.tsx  (lib/jsx parse → lib/story-ui render)
           └─ legacy HTML  → views/shared/StoryEmbeds.tsx   (portal per placeholder element)
                 └─ StoryEmbedProviders: Redux + Chakra + ark EnvironmentProvider re-provided

DashboardContainerV2 → views/shared/DashboardSurface.tsx  (same machinery, reused wholesale)
      └─ views/DashboardView.tsx  → react-grid-layout → WindowedTile → SmartEmbeddedQuestionContainer
```

`DashboardSurface` injects the generated chrome stylesheet (`lib/dashboard-surface/chrome-css.gen.ts`)
**inside** the surface root, so serializing the `<svg>` subtree is self-contained by construction.
Because the surface svg carries `STORY_SVG_ATTR`, the story capture path
(`findStorySvg`/`serializeStorySvg` in `lib/story-surface/serialize.ts`) picks dashboards up with no
dashboard-specific capture code. Main-document captures go through `lib/screenshot/serialize-element.ts`.

`views/dashboard/WindowedTile.tsx` renders off-viewport tiles as `data-mx-busy="true"` ghosts that
fill their grid cell (`h-full`, so total content height — which the marker math depends on — is
exact). Visibility is a rAF-throttled `getBoundingClientRect` composed up the frame chain, *not*
IntersectionObserver (IO never fires for `foreignObject` descendants) and *not* the tile's own
frame rect (the content-height iframe never scrolls, so every tile would read visible).

`DashboardView` deliberately does **not** use react-grid-layout's `WidthProvider`: its polyfill
observer is bound to the top realm and goes deaf inside the surface iframe. Width arrives via
`SurfaceWidthContext` (`lib/dashboard-surface/surface-width`), falling back to 1280px.

## Interactions with other areas

**Inbound — who renders this tree**

| Caller | Entry point | Contract |
|---|---|---|
| `app/f/[id]/page.tsx` | `FileLayout` + `FileView` | file id + path/name/type; everything else from Redux |
| `app/p/[[...path]]`, `app/page.tsx`, `app/conversations` | `FolderView`, `RecentFilesSection`, `Breadcrumb`, `InfiniteScrollSentinel` | plain props |
| `app/explore/[[...id]]` | `ExploreInterface` → `ChatInterface` | `container='page'` |
| `app/settings`, `app/new/connection`, `app/hello-world` | `settings/*`, `ConnectionWizard`, `ConfigContainerV2`/`StylesContainerV2` | plain props |
| `app/benchmark/page.tsx` | `AgentTurnContainer`, `groupIntoTurns`, `ExecutionTree`, `ToolDebugBar` | replays a stored conversation log through the *live* chat renderer — changing turn grouping changes benchmark output |
| `lib/story-ui/registry.ts` | `components/kit/*` | the story JSX interpreter's component registry IS the kit; renaming/removing a kit export breaks agent-authored stories |
| `lib/navigation/NavigationGuardProvider.tsx` | `modals/PublishModal` | unusual inbound edge: `lib/` renders a component |
| `lib/tools/tool-config.ts` | every `explore/tools/*Display` | imports the compact displays; `components/explore` imports `getToolConfig` back — the cycle is broken because `tool-config.ts` lives in `lib/` |

**Outbound — what this tree calls**

- **File & query state**: `lib/hooks/file-state-hooks.ts` (`useFile`, `useFolder`, `useQueryResult`)
  and `lib/file-state/file-state.ts` (`editFile`, `getQueryResult`, `applyStoryHtmlEdit`,
  `captureNotebookCellResult`). Containers use these; views never fetch.
- **Redux**: `store/filesSlice` (`selectMergedContent` = content + persistableChanges +
  ephemeralChanges), `store/uiSlice` (edit mode, view mode, view stack, chat flags),
  `store/chatSlice`, `store/authSlice` (`selectEffectiveUser`, `selectView`).
- **Permissions**: `lib/auth/access-rules.client.ts` — `canCreateFileByRole` is what containers use
  to derive `readOnly`. This is UI-layer defence only; the API routes and data layer re-check.
- **Capture**: components only *produce* the DOM contract; `lib/screenshot/*` consumes it.
  `data-file-id` (the capture anchor, stamped by each page view), `data-mx-busy` (readiness gate),
  `data-mx-story-svg` (surface svg), and `FORCE_MOUNT_TILES_EVENT` = `'mx-force-mount-tiles'`
  (`lib/screenshot/readiness.ts` → `WindowedTile`) are the four load-bearing strings.
- **Theming**: `data-mx-theme-host` must be present on any detached/portaled root
  (`file-browser/FileLayout.tsx`, `file-browser/ViewStack.tsx`, `kit/tooltip.tsx`,
  `kit/dropdown-menu.tsx`, `kit/select.tsx`) or the `app/theme-tokens.css` variables — scoped under
  `[data-mx-theme-host]`, never `:root` — don't resolve.
- **Tests**: `test/qa/*` and `test/e2e/*` drive this tree by `aria-label` only and read state via
  `window.__MX_STORE__`, which `app-shell/ReduxProvider.tsx` assigns only when the build-time
  `E2E_MODE` flag is set or the runtime QA opt-in (`?e2e=<secret>`) passes.
  A control without an `aria-label` is untestable by policy — add the label rather than working
  around it.

## Gotchas

- **The two ESLint guards are hardcoded file lists.** A newly added view is born *unguarded* by
  `RESTRICT_VIEW_REDUX`, and a newly added file outside the listed trees is born *outside* the
  Chakra ban. Both lists also name things that no longer exist: TransformationView.tsx (in
  `RESTRICT_VIEW_REDUX`), plus SvgPageSurface.tsx and the ui/resizable-panel wrapper (both in the
  Chakra ban) were deleted but never removed from the config. A name's presence in either list
  proves nothing about coverage — and `check-docs` will not catch these, since they are ESLint
  config strings, not doc pointers.
- **Tailwind classes in the kit or in embed chrome need a codegen run.** Story CSS is compiled
  per-story from the story markup only; component chrome classes are pre-extracted into
  `lib/story-ui/recipe-classes.ts` from `components/kit/**` plus the explicit `EMBED_CHROME_FILES`
  list in `scripts/generate-story-ui-classes.ts`. Add a class to any of those and run
  `npm run generate-story-ui-classes` (and `npm run generate-dashboard-chrome-css`, which unions the
  same list) — otherwise the class silently emits nothing inside the iframe. The freshness test
  `lib/story-ui/__tests__/recipe-classes.test.ts` fails on a stale file.
- **`kit/popover.tsx` and `kit/tooltip.tsx` are patched shadcn.** No Radix `Portal` (or
  `portalled={false}`) because `position: fixed` is broken inside `foreignObject`; Radix's internal
  `[data-radix-popper-content-wrapper]` still sets `fixed`, which `STORY_FLOATING_CSS`
  (`lib/story-ui/floating.ts`) overrides to `absolute`. Re-vendoring shadcn upstream re-breaks
  story popovers.
- **`AgentTurnContainer` is `memo`'d with default equality and reads `state.files.files` with
  `shallowEqual`.** Passing an unmemoized callback from `ChatInterface`, or switching the selector
  to a plain read, reintroduces a full re-render of every turn on every streaming chunk (guarded by
  `components/__tests__/chat-rerender.ui.test.tsx`).
- **`ChatInput`/`LexicalMentionEditor` memo comparators deliberately ignore `onSend`/`onSubmit`
  identity.** They assume a reference-stable callback; passing a fresh closure makes Enter send the
  mount-time (empty) input while the editor clears. Two regression tests pin this
  (`__tests__/chat-input-enter.ui.test.tsx`, `__tests__/chat-input-stable-onsend.ui.test.tsx`).
- **`DashboardContainerV2` uses a module-level `EMPTY_PARAMS` constant.** A fresh `{}` per render
  destabilizes `DashboardView`'s derived `effectiveSubmittedValues` and cascades into infinite
  query-retry loops.
- **Dashboard param fallback uses key-existence, not `??`.** `computeEffectiveSubmittedValues`
  (`lib/dashboard/effective-params`) applies a question's saved default only when the key is
  *absent*; an explicit `null` (None) or `""` is a real value and must survive.
- **`views/CodeView.tsx` is rendered by `FileView`, not by any type view.** Adding a JSON toggle to
  a view duplicates it.
- **`getFileComponent` is a partial map.** `lib/ui/fileComponents.tsx` has no entry for
  `context_run`; `views/ContextRunView.tsx` is mounted directly by `context/EvalsTabContent.tsx`.
  A file type with no entry renders the "Unsupported file type" branch of `FileView`.
- **`aria-label` is the query strategy for anything interactive** — `*ByLabelText` accounts for
  roughly 1,800 of the ~2,000 queries across the `*.ui.test.tsx` suite, and the Playwright suites use
  `getByLabel` almost exclusively. The convention is enforced by review, not lint. A control you
  cannot reach by label is a **missing `aria-label` on the component**, not a reason to reach for
  `getByRole`/`getByTestId`; add the label. The legitimate exceptions are narrow: `getByText` for
  asserting *rendered content* (as opposed to locating a control), and CSS selectors over the
  `data-*` DOM contract (`[data-file-id]`, `svg[data-mx-story-svg]`) where the thing being located is
  a surface rather than a control.

## Key files

| Task | File |
|---|---|
| Add a new file type page | `lib/ui/fileComponents.tsx` + a new `containers/<Type>ContainerV2.tsx` + `views/<Type>View.tsx` |
| Change the file page shell / header actions | `file-browser/FileView.tsx`, `file-browser/FileHeader.tsx` |
| Publish a toolbar button from a view | `file-toolbar/FileToolbarContext.tsx` |
| Change how a tool renders in chat | `lib/tools/tool-config.ts` + `explore/tools/<Tool>Display.tsx` (default = compact row, `*DetailCard` = carousel) |
| Change carousel routing / node → pane | `explore/AgentTurnDetailPane.tsx` |
| Change turn grouping or timeline nodes | `explore/message/groupIntoTurns.ts`, `explore/agentTurnTimeline.ts` |
| Chat composer, attachments, slash commands | `explore/ChatInput.tsx`, `explore/slash-commands.ts` |
| Interactive tool prompts (Clarify, confirmations) | `explore/UserInputComponent.tsx`, `explore/PendingClarifyPanel.tsx`, `remote/RemoteSessionPrompts.tsx` |
| Dashboard grid / tiles | `views/DashboardView.tsx`, `views/dashboard/WindowedTile.tsx`, `views/dashboard-assets.ts` |
| Dashboard iframe surface / capture self-containment | `views/shared/DashboardSurface.tsx` |
| Story iframe, embeds, WYSIWYG write-back | `views/shared/AgentHtml.tsx`, `views/shared/StoryJsxBody.tsx`, `views/shared/StoryEmbeds.tsx` |
| Question workbench (SQL, params, viz panel) | `views/QuestionViewV2.tsx`, `question/QuestionVisualization.tsx`, `query-builder/SqlEditor.tsx`, `params/ParameterRow.tsx` |
| Notebook cells | `views/NotebookView.tsx`, `views/notebook/NotebookSqlCell.tsx` |
| shadcn primitive (also the story component registry) | `components/kit/*` |
| Empty / new-file hero | `views/shared/empty-states.tsx` |
| Right sidebar & app chrome | `app-shell/RightSidebar.tsx`, `app-shell/Sidebar.tsx`, `app-shell/DataLoader.tsx` |

**The WYSIWYG text host freezes its subtree while focused.** `StoryJsxBody` treats a focused editable host as prop-equal so React bails out and never reconciles it — without that, any upstream re-render (an embed refetch, a param change, a Redux update elsewhere) reconciles mid-keystroke and clobbers what the user is typing. A render that must happen anyway commits the in-progress edit first. Edits commit on blur by writing back into the JSX **AST** by `data-mx-ast` path, never by scraping the rendered DOM, and only after real user input — programmatic focus churn does not commit. Because the host is rich `contentEditable`, the write-back has to preserve inline elements (`<strong>`, `<em>`, links); a plaintext-only commit silently strips them. The parsed result runs through the same `validateJsxSource` and prop deny list as agent-authored markup — pasted HTML is untrusted input, and there is no editor-trusted parse.

**The format toolbar mutates the live DOM first and the source second — both, every time.**
`components/views/story/StoryTypographyToolbar.tsx` renders in the PARENT document (the iframe's rect
offsets the anchor) and, on every control, computes the next class string from the host element's
*live* attributes via the pure algebra in `lib/data/story/typography.ts`, writes it straight onto the
element, and only then emits it through `applyFormatEdit` → `applyFormatEditsToJsx`. The DOM
write is not an optimisation: the focused text host is render-frozen by the memo guard, so a React
re-render cannot deliver the change at all. The commit path is deliberately whole-value — the full
resolved `className` — so a stale AST read can never merge two partial edits. Text colour and fill
persist as important Tailwind arbitrary-value utilities (`text-[#rrggbb]!` / `bg-[#rrggbb]!`): the
important suffix preserves the old manual-override semantics. A temporary DOM-only inline value
previews the unbounded color immediately; `compiledCss` changing removes it once the story-specific
Tailwind rule lands. Touching a picker also removes that property's legacy inline declaration.

The toolbar anchors to one of **three** target kinds, and they do not offer the same controls.
`'text'` is a focused contenteditable host and gets everything. `'text-element'` is a click-selected
`div`/`p`/heading/`span` parent — also full typography, because setting it on the parent is how a
style inherits into all its children. `'element'` is any other click-selected container, which hides
font size, B/I/U and text colour, since those are meaningless on a container; alignment, fill, width,
spacing, padding and bleed remain. Click-selection marks the target `data-mx-selected`, with
`data-mx-hover` previewing what a click would take; embeds are never selectable, since their chrome is
interactive. A breadcrumb of the selectable ancestor chain (outermost first, labelled via `crumbHint`)
re-anchors the selection up the tree — the reason the toolbar can style a wrapper the user cannot
easily click. Both marker attributes are render artifacts caught by the `data-mx-*` prefix strip in
`jsx-edit.ts`, so neither can reach stored source.

**Every agent edit remounts the story iframe, and two defenses keep the page still.** `AgentHtml` is
keyed on the story hash, so an edit tears the iframe down; the fresh one measures ~0px and regrows
asynchronously as embeds hydrate, and the browser clamps the scroll container toward the top on the
way through. `lib/hooks/use-story-rebuild-stability.ts` owns both defenses under one `ResizeObserver`:
the story box's `min-height` is pinned to the last stable measured height during render
(adjust-state-during-render, so the style lands in the same commit as the child's remount), and the
pre-rebuild `scrollTop` is snapshotted in an **insertion** effect — the only phase that still sees the
old position, since layout effects run after the fresh iframe has already sized to zero. The pin
releases only once the rebuilt content has regrown past it or after `MAX_PIN_MS`, never on a mere gap
in the resize stream: embeds waiting on query results stop resizing for far longer than the settle
debounce, and releasing there is exactly what used to clamp scroll to the top. A user scroll during
the rebuild cancels the restore. Separately, `preloadStoryFonts` registers the theme's faces once in
the TOP document via the FontFace API: the iframe's `@font-face` rules are `font-display: swap`, so a
cold cache repainted fallback text on every single edit.

**The agent authoring surface.** `components/context/AgentsTabContent.tsx` is the Agents tab of
`ContextEditorV2` (a structural mirror of `SkillsTabContent`): saved agents, read-only inherited ones
from `fullAgents`, and a raw-JSON variant. `components/context/AgentBuilder.tsx` is a four-step builder
(Identity → Prompt → Skills → Review) that **saves only at the end**, and whose Review step renders the
very component the saved card uses, `components/context/AgentReadView.tsx` — so what an author approves
is byte-for-byte what is stored, with no second formatting path to drift. The feature is alpha-gated on
`uiSlice.enableCustomAgents`: with the flag off the editor tab is not rendered *and* the chat picker
receives an empty option list, so no `custom_agent` pointer is ever sent. The gate is on both the
authoring and the sending side, not just the visible one.

**`components/settings/GatewayBillingCard.tsx` renders `null`, not an empty card, when there is no
gateway.** A self-hosted install is not in an error state — it simply has no billing — and an empty
card would be noise on every one of those settings pages. Two consequences of the same rule: a fetch
failure is treated as "unreachable" rather than thrown into the settings page, and a non-admin gets a
403 whose body carries no `data` key, which falls through to `{enabled: false}` and renders nothing.
The heading is "Plan & balance", never "Credits" — the credit-limits card sits directly below it, and
two adjacent cards with the same heading showing different numbers is unreadable.

**The inline `<Number>` query editor is a light-DOM dialog on purpose.** The story body renders inside the surface iframe, where Monaco's floating widgets (suggest, hover) mis-anchor, so `views/story/NumberQueryEditor.tsx` mounts the shared `query-builder/SqlEditor.tsx` in a Chakra `Dialog` at the `StoryView` level and hands the edited query back through the request's `apply` callback. Reuse rather than a hand-rolled `<textarea>` is the point: `SqlEditor` is a deep module (Monaco plus schema and `@`-reference autocomplete plus validation, behind `value`/`onChange`/`schemaData`), and the modal is the constraint the iframe imposes, not a styling choice.

**A parameter's declaration and its value are stored separately, and each file type declares differently.** A question declares in `QuestionContent.parameters` (`{ name, type: 'text'|'number'|'date', label, source }`) and holds values in `parameterValues`. A dashboard *auto-derives* its declarations by merging its questions' params on name+type. A story has no `params` field at all — but it has **two** storage shapes. A legacy story derives its declarations from `<div data-param-name=…>` placeholders inside `content.story` (inline-SQL sources ride along as a JSON `data-param-source-sql` attribute); a `format:'jsx'` story stores the `<Param/>` element **verbatim** in the body and has no placeholders anywhere. `markupToContent` picks the codec from the file's *stored* content, never from the incoming markup. Anything reading a story's params must therefore go through `extractStoryParams` (`lib/data/story/story-params.ts`), which scans placeholders *and* parses `<Param>` nodes out of JSX — a placeholder-only regex silently returns zero params for every new-format story. Either way the control lives exactly where the author placed it — values again in `parameterValues`. Because values are a separate name-keyed dict, a control can be moved or re-themed without touching them.

**One story `<Param>` drives every embed that uses it, by two different routes.** A LEGACY story goes through `views/shared/AgentHtml.tsx`, which scans the body for `[data-param-name]` into `paramTargets` (`paramFromPlaceholderEl`), holds the values in React state seeded from `content.parameterValues`, and portals a `StoryParamControl` per param. A `format:'jsx'` story has no placeholders to scan: `views/shared/StoryJsxBody.tsx` collects the declarations from the AST (`collectStoryParams`) and renders each `<Param>` through its own `ParamControlAdapter` → `StoryParamControl` **in place in the interpreted tree** — no DOM scan, no portal. Both then pass every embed `externalParameters` (`storyParamToQuestionParameter`, wired in `views/shared/StoryEmbeds.tsx`) plus `externalParamValues`; that contract onto the embeds is identical, and only the collection and mounting differ. Changing one control re-renders the story and re-executes each affected embed. Dashboards reach `SmartEmbeddedQuestionContainer` through the *identical* `externalParameters`/`externalParamValues` props from `DashboardView` — only the derivation of the controls differs.

**A `<Param>` names its SQL binding, and everything else about it is presentation.** `name` is always
the stable `:name` binding. Autocomplete comes from one of two sources: `<Param id={N} column="c">`
imports question N's column, and `<Param query={`SELECT DISTINCT city FROM customers ORDER BY city`}
connection="warehouse">` runs story-local SQL and uses its first result column
(`components/params/InlineSqlDropdownWidget.tsx`). With no `label` the control humanizes the binding —
`generateLabel` turns `immediate_parent` into "Immediate Parent" — and a custom `label` changes
**only** the reader-facing text, never the binding; `labelStyle={{…}}` styles that text. When
`nullable` is true (**the default** — it is opt-out) the control grows a separate **Any** pill in its
label row that stores `null`, which `applyNoneParams` turns into predicate removal downstream. Any is
a sibling of the control, not an entry inside the dropdown, and that is deliberate: an in-list option
is unreachable the moment the source query errors or returns no rows, and it can collide with a real
value in the data.

A query-backed `<Param>` is an embed run too, contributing its own run with **empty params** — a
suggestion query populates the control rather than consuming its value, so binding the story's current
values into it would re-execute the dropdown on every keystroke and key its cache against a moving
target. The same extraction feeds `extractInlineFileQueries`, which is what puts the source query on
the guest allowlist in `lib/query-cache/guest-query.server.ts`, so an anonymous share viewer can
populate the dropdown without gaining the ability to run anything else.

- **A portal must target the anchor's document, not `document.body`.** `DrillDownCard` takes the `Document` the drill click happened in (`DrillDownState.doc`) and portals there, because its `position` is in *that* document's viewport space — inside the dashboard surface iframe the top `document.body` is the wrong coordinate space, and a `position: fixed` backdrop is broken inside `foreignObject` anyway. Anything floating that a dashboard tile can open follows the same rule, and must also carry `data-mx-theme-host` so shadcn token classes resolve in the document it lands in.

---
