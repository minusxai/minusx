# Story ↔ Dashboard Integration: `<Grid>` / `<GridItem>` drag-and-drop layout for JSX stories

A registered story component pair that gives `format:'jsx'` stories the dashboard's
drag-and-drop grid: the agent authors layout as static JSX props, and in story edit mode the
user drags/resizes items exactly like dashboard tiles. Layout changes persist by AST
write-back into the story source — the same mechanism the WYSIWYG text and typography edits
use.

```jsx
<Grid>
  <GridItem x={0} y={0} w={8} h={5}>
    <Question id={12} viz={...} />   {/* no height — the cell (h × 86px) IS the height */}
  </GridItem>
  <GridItem x={8} y={0} w={4} h={5}>
    <Card className="h-full">...</Card>
  </GridItem>
</Grid>
```

---

## Verified architecture facts this plan builds on

- Dashboards use `react-grid-layout` (`^1.5.2`, already a dependency) via
  `components/views/DashboardView.tsx` — `Responsive` grid, `cols={{lg:12, md:12, sm:6}}`,
  `rowHeight={80}`, `margin` 6, `compactType="vertical"`, width from `useSurfaceWidth()`
  (`lib/dashboard-surface/surface-width.tsx`) because RGL's `WidthProvider` is deaf inside
  the iframe realm.
- Story components are registered in **two** files that a drift test keeps in sync:
  `lib/story-ui/registry.ts` (name → React component) and
  `lib/story-ui/component-names.ts` (`STORY_UI_COMPONENT_NAME_LIST`, names-only for
  server-side validation).
- `StoryJsxBody.tsx` overrides registry entries with context-aware adapters
  (`Question`/`Number`/`Param`) via `STORY_JSX_REGISTRY`; adapters read
  `props[AST_PATH_ATTR]` — every element's `data-mx-ast` path.
- WYSIWYG edits are staged in an imperative `EditSession` (StoryJsxBody) holding two edit
  maps — `edits` (innerHTML) and `formatEdits` (className/style) — composed against the
  **current** source on every commit; `onChange` fires with the composed source, and
  `serialize()` is the Save-time drain.
- `lib/data/story/jsx-edit.ts` already exports the write-back primitives:
  `updateJsxElementAtPath(source, astPath, tag, mutate)` (stale/hostile-path-safe no-op) and
  `setStaticJsxAttr(el, name, json)`.
- Component chrome Tailwind classes are extracted from `components/kit/**` source text by
  `scripts/generate-story-ui-classes.ts` into `lib/story-ui/recipe-classes.ts`
  (`STORY_RECIPE_UNION` — compiled into **every** story's CSS), freshness-gated by
  `lib/story-ui/__tests__/recipe-classes.test.ts`. `generate-dashboard-chrome-css` unions
  the same sources.
- Styles the surface needs must live **inside `surface.root`** (never `<head>`) or captures
  lose them. Grid-item `transform` **transitions** must be off inside `foreignObject`
  (Chromium repaint bug); `DashboardView` injects `transition: none` for `.react-grid-item`.
- The agent learns the component vocabulary from `skill_stories` in
  `orchestrator/prompts/prompts.yaml` (component list around the "Components" bullet) and
  from the story content-schema description (`lib/validation/atlas-schemas.ts` →
  `{schema_story}`); `lib/validation/__tests__/story-schema-components.test.ts` asserts every
  Capitalized tag mentioned in the schema text is a registered component.
- `test/setup/vitest.setup.ui.ts` already patches/handles react-grid-layout for jsdom (the
  DashboardView ui tests exercise it), so grid ui tests are feasible.

---

## Design decisions

### 1. View mode renders with pure CSS — RGL only mounts in edit mode

In read/view/capture contexts, `<Grid>`/`<GridItem>` render as plain divs positioned by CSS
custom properties + literal Tailwind arbitrary-value classes (compiled through the existing
recipe-class pipeline). No RGL, no width measurement, nothing to go stale in a capture:

- `Grid` renders **two divs**: an outer `@container w-full` div and an inner `relative` div
  carrying the height `calc(var(--g-rows) * var(--g-rh))` (`--g-rows` = max(y+h) over
  children, computed by the component and set as an inline CSS var, alongside `--g-cols` and
  `--g-rh`). Two divs because `@container` rules style *descendants*, never the container
  itself — the inner div's `@max-2xl:h-auto` (and the GridItems' stacking variants) respond
  to the outer div.
- `GridItem`: `absolute`, `left: calc(var(--gi-x)/var(--g-cols)*100%)`,
  `width: calc(var(--gi-w)/var(--g-cols)*100%)`, `top: calc(var(--gi-y)*var(--g-rh))`,
  `height: calc(var(--gi-h)*var(--g-rh))`, with `p-[3px]` inner padding forming the gutter.
- **Responsive stacking**: `@max-2xl:` container-query variants flip items to
  `position: static; width: 100%` and the Grid's inner div to `h-auto` — on phones the grid
  degrades to a vertical stack in source order, which matches the stories skill's
  fluid-first mandate. Items **keep** their computed px height when stacked (only
  position/left/top/width change): embeds inside fill the cell at 100% (§2b), so an
  auto-height stacked item would collapse them. (Authors order GridItems top-left →
  bottom-right; `serializeJsx` preserves author order, and the write-back never reorders
  children.)

All positioning classes are **literal strings in the kit source**, so the existing extractor
picks them up; only the numbers travel through CSS vars set from props.

### 2. Geometry: margin 0 + inner padding, so view CSS and edit RGL are pixel-identical

RGL's default margin model (`margin=[6,6]`) positions items with absolute-px margins that a
percentage CSS model cannot reproduce exactly. Instead:

- RGL config: `margin={[0,0]}`, `containerPadding={[0,0]}`, `rowHeight = 86` (the
  dashboard's 80 + 6 rhythm), `cols = 12`, `compactType="vertical"`.
- The visual gutter is `p-[3px]` **inside** `GridItem` (6px between cards), identical in
  both modes.
- With margin 0, RGL's placement is exactly `left = x/cols·width`, `top = y·rowHeight` — the
  same arithmetic as the view-mode CSS. Defaults mirror the dashboard: `--g-cols: 12`,
  `--g-rh: 86px`.

`Grid` accepts optional `cols` (default 12) and `rowHeight` (default 86) props for the
agent; `GridItem` takes `x`, `y`, `w`, `h` (missing values default `x=0,y=0,w=6,h=4`,
clamped to `1 ≤ w ≤ cols`, `h ≥ 1`).

### 2b. The cell is the single source of height — embeds inside a GridItem fill it

`h` on the GridItem and `height=` on an embedded `<Question>`/`<Number>` would be two
truths for one dimension, and they *will* disagree. Resolution, mirroring dashboard tiles:
`components/kit/grid.tsx` exports a `GridItemContext` (a boolean "inside a grid cell"
context that `GridItem` provides); the `QuestionEmbedAdapter` / `NumberEmbedAdapter` in
`StoryJsxBody` consume it and, when set, **ignore any authored `height`** and render
`height: 100%` so the embed fills the cell (GridItem is `overflow-hidden`, so a stray
authored height can't break the layout either way). The skill teaches: inside a Grid,
never author `height` on embeds — `h` is the height. Import direction is fine (adapters
already import from `components/kit` via the registry; kit imports nothing back).

### 3. Edit mode: an adapter in `STORY_JSX_REGISTRY`, like the embeds

`Grid` in the base registry (`lib/story-ui/registry.ts`) is the pure CSS component — that is
what legacy mounts, captures and the share page get. `StoryJsxBody` overrides it with a
`GridAdapter` (same pattern as `QuestionEmbedAdapter`) that:

- reads `ctx.editable` from `StoryJsxEmbedContext`; when false, renders the pure component
  unchanged;
- when editable, reads `useSurfaceWidth()` and renders `react-grid-layout` (non-responsive
  `GridLayout` — the story grid has one breakpoint; stacking below it is view-mode-only
  behavior and editing happens on desktop) with `isDraggable`, `isResizable`;
- derives `layout` from its children's props: each child GridItem element carries
  `props[AST_PATH_ATTR]` (the interpreter passes it to components) plus `x/y/w/h` — the RGL
  item key **is the AST path**, so `React.Children` mapping gives `{i: astPath, x, y, w, h}`
  with no registry of ids (non-element / non-GridItem children are filtered out);
- wraps each child in a **plain keyed div** RGL positions (the DashboardView pattern), and
  `cloneElement`s the GridItem inside it with an `editing` prop that switches the GridItem
  to `static w-full h-full` (classes literal, so the extractor sees them) — otherwise the
  GridItem's own absolute positioning and RGL's transform would fight. `GridItem` still
  spreads props, so `data-mx-ast` lands in the DOM in both modes;
- injects a `<style>` node with `STORY_GRID_EDIT_CSS` (see §5) as its first child while
  editable;
- on `onDragStop` / `onResizeStop` (NOT `onLayoutChange`, which also fires at mount):
  diff the callback's full layout against the children's current attrs and stage every
  changed item (vertical compaction moves siblings, so all changed items commit together).

`Grid` must render nothing draggable when `editable` is false — reader interactions
(tooltips, params, drilldown) must be completely unaffected in view mode.

### 4. Persistence: a third edit kind in `EditSession`

New pure function in `lib/data/story/jsx-edit.ts`:

```ts
export interface JsxLayoutEdit { astPath: string; x: number; y: number; w: number; h: number }
/** Set x/y/w/h on the <GridItem> elements at the given AST paths. One parse, one serialize.
 *  Unresolvable/stale paths and non-GridItem elements are skipped (same contract as
 *  applyFormatEditsToJsx). */
export function applyLayoutEditsToJsx(source: string, edits: JsxLayoutEdit[]): string
```

`EditSession` (StoryJsxBody) grows `layoutEdits: Map<astPath, {x,y,w,h}>` and an
`applyLayoutEdit(edits: JsxLayoutEdit[])` method; `composed()` becomes
innerHTML → format → layout, all against the current source prop, and `serialize()` drains
all three. `applyLayoutEdit` fires `onChange` immediately (like `applyFormatEdit`), so the
container's dirty/save flow is untouched. The adapter reaches the session through a new
optional `onLayoutEdit` member on `StoryJsxEmbedContext` (wired only when
`editable && !readOnly`).

Layout edits are attribute-only, so **AST paths of every pending edit stay valid** — no
composition-order hazards with text/format edits. After `onChange`, the body re-parses and
RGL remounts with layout == committed source; the no-op diff guard prevents an echo commit.

### 5. CSS delivery

- **View mode**: nothing new at runtime — the kit classes land in `STORY_RECIPE_UNION` via
  `npm run generate-story-ui-classes` (+ `npm run generate-dashboard-chrome-css`, which
  unions the same file list). Adding `components/kit/grid.tsx` to the extractor's scan is
  automatic (it scans `components/kit/*`). **Note:** growing the union flips
  `storyCssCompileVersion()` — every stored story recompiles at read time once. Expected
  and safe.
- **Edit mode**: a new `lib/story-ui/grid-css.ts` exporting `STORY_GRID_EDIT_CSS` — a small
  vendored subset of `react-grid-layout/css/styles.css` (item positioning, placeholder,
  resize handle) **plus** `.react-grid-item { transition: none !important; }` (the
  foreignObject repaint rule) — rendered by the adapter inside the surface root. Never in
  `<head>`. It is render output, not authored markup, so the `tailwind-only` style policy
  and the DOM→JSX sanitizer (`data-mx-*`/AST write-back never scrapes DOM) are unaffected.

### 6. Width provision: `AgentHtml` provides `SurfaceWidthContext`

`AgentHtml` already owns the iframe and its `autoSizeStorySurface` wiring but does not
provide a width context. Add, mirroring `DashboardSurface`:

- a `useState<number | null>` surface width, seeded from `iframe.clientWidth` at build;
- a `ResizeObserver` on the **iframe element** (top-document target — the only realm-reliable
  trigger), trailing-debounced 60 ms, updating the state;
- `<SurfaceWidthContext.Provider>` wrapped around the portaled `StoryJsxBody`.

Import the context from `lib/dashboard-surface/surface-width` (it is already the shared,
realm-safe width primitive; module move is not worth the churn — document the shared use in
both CLAUDE.mds). The `GridAdapter` falls back to `STORY_CANVAS_WIDTH` (1280) when the
context is null, same as `DashboardView`.

### 7. Advertisement (registration is not advertisement)

- `skill_stories` (`orchestrator/prompts/prompts.yaml`): add `Grid`/`GridItem` to the
  Components bullet and a short usage block — when to reach for it (dashboard-like KPI/chart
  arrangements, magazine layouts), the 12-col / 86px-row model, "GridItem height is
  `h × 86px`; embeds inside a GridItem fill the cell — never author `height` on them",
  items stack vertically on phones in source order (so order items reading-order), don't
  nest Grids.
- Story content-schema description (`lib/validation/atlas-schemas.ts`, the text behind
  `{schema_story}`): mention `<Grid>`/`<GridItem>` — the drift test requires any mentioned
  tag to be registered, which this change satisfies.

### 8. Not in scope (v1)

- No drag-in of *new* items / no palette — the agent (or Markup tab) adds GridItems; drag
  only rearranges/resizes existing ones.
- No per-breakpoint authored layouts (`sm` overrides) — one layout + CSS stacking fallback.
- No nested grids (guidance-level ban, not validator-enforced).
- No dashboard-side changes at all.
- Dragging items **between** a Grid and the surrounding flow, or between two Grids.

---

## Implementation plan (TDD order — contracts → red tests → green → verify)

### Phase 1 — Contracts

1. `components/kit/grid.tsx` — `Grid` / `GridItem` component signatures (props typed;
   pure-CSS implementation stubs). Literal Tailwind classes per §1/§2. `GridItem` takes the
   internal `editing?: boolean` prop (§3) — never authored, only set by the adapter's
   `cloneElement` — and provides the exported `GridItemContext` (§2b).
2. `lib/data/story/jsx-edit.ts` — declare `JsxLayoutEdit` + `applyLayoutEditsToJsx`
   signature.
3. `lib/story-ui/grid-layout.ts` — pure helpers, unit-testable without DOM:
   - `gridItemLayout(props, cols)` → clamped `{x,y,w,h}` (the single defaulting/clamping
     rule, used by both the CSS component and the adapter);
   - `diffLayouts(next: Layout[], current: Map<astPath, {x,y,w,h}>)` → `JsxLayoutEdit[]`
     (the no-echo guard);
   - `gridRows(items)` → `--g-rows`.
4. `lib/story-ui/grid-css.ts` — `STORY_GRID_EDIT_CSS` constant (content in Phase 3).
5. Type additions: `onLayoutEdit?: (edits: JsxLayoutEdit[]) => void` on
   `StoryJsxEmbedContextValue`; `applyLayoutEdit` on `EditSession`/`StoryJsxEditApi` is
   internal (session only — the toolbar API doesn't need it).

### Phase 2 — Tests, confirmed RED before implementing

1. `lib/data/story/__tests__/jsx-edit-layout.test.ts` (node):
   - sets x/y/w/h on the GridItem at a path; other attrs/children byte-identical;
   - stale path → source unchanged; path resolving to a non-GridItem → unchanged;
   - multiple edits in one call = one parse/serialize;
   - composes with `applyFormatEditsToJsx` output (layout after format, paths stable).
2. `lib/story-ui/__tests__/grid-layout.test.ts` (node): clamping/defaults, `diffLayouts`
   returns `[]` for identical layouts (the mount-echo case), `gridRows`.
3. `components/views/__tests__/story-grid.ui.test.tsx` (jsdom, `aria-label` queries only):
   - `StoryJsxBody` over Grid markup renders GridItems with the expected CSS vars and
     stamped `data-mx-ast`;
   - `editable`: RGL mounts (drag handles present), `STORY_GRID_EDIT_CSS` style node inside
     the surface root; NOT editable: no RGL artifacts;
   - simulated `onDragStop` (via the RGL jsdom setup the DashboardView tests use) → session
     `onChange` fires with source whose GridItem attrs changed — assert on the **serialized
     JSX**, not the DOM;
   - a text edit + a drag in one session compose (both survive in `serialize()`);
   - a `<Question height="420px">` inside a GridItem renders at 100% cell height (the
     authored height is ignored — §2b); the same markup outside a Grid keeps its px height.
4. Registry drift + schema drift + recipe-classes freshness tests: updated expectations go
   red until Phase 3/5 lands them.

### Phase 3 — Implementation

1. Implement `Grid`/`GridItem` (pure CSS), `grid-layout.ts` helpers,
   `applyLayoutEditsToJsx` (build on `parseJsx` + `resolveJsxNodeAtPath` + `setStaticJsxAttr`
   + `serializeJsx` — one parse for the batch, per-item tag check `'GridItem'`).
2. Register: `lib/story-ui/registry.ts` + `lib/story-ui/component-names.ts` (both files —
   the drift test enforces it).
3. Write `STORY_GRID_EDIT_CSS` (vendor the needed RGL rules + transition kill).
4. `StoryJsxBody`: extend `EditSession` (third map, composed order innerHTML → format →
   layout), extend `StoryJsxEmbedContext`, add `GridAdapter` to `STORY_JSX_REGISTRY`
   (children → layout via `AST_PATH_ATTR` keys; `onDragStop`/`onResizeStop` → `diffLayouts`
   → `ctx.onLayoutEdit`).
5. `AgentHtml`: surface-width state + iframe RO (60 ms trailing debounce) +
   `SurfaceWidthContext.Provider`; consider copying `DashboardSurface`'s post-resize
   compositor nudge if stale pixels appear during drag QA (see Risks).
6. Codegen: `npm run generate-story-ui-classes` && `npm run generate-dashboard-chrome-css`.

### Phase 4 — Full suite + validate

`cd frontend && npm run validate && npm test`. The recipe-classes and chrome-css freshness
gates confirm the codegen ran; the schema/registry drift tests confirm advertisement and
registration agree.

### Phase 5 — Advertisement

1. `prompts.yaml` `skill_stories` — components list + Grid usage block (§7). Check every
   `renderPrompt` slot rule: this is prose-only, no new `{slot}`, so no other renderers are
   affected.
2. `atlas-schemas.ts` story schema description mention.
3. Re-run the drift tests (now green).

### Phase 6 — Docs consistency (same change, per repo policy)

- `frontend/lib/story-ui/CLAUDE.md` — registry additions, `grid-layout.ts`/`grid-css.ts`,
  the adapter, the third edit kind.
- `frontend/lib/story-surface/CLAUDE.md` — `AgentHtml` now provides `SurfaceWidthContext`;
  `surface-width.tsx` is shared by both surfaces.
- `frontend/components/CLAUDE.md` — StoryJsxBody adapter list + EditSession edit kinds.
- `docs/content/**` — if the published docs enumerate story components, add Grid/GridItem;
  verify with a grep before assuming they don't.

### Phase 7 — Commit, push, browser-verify

On the dev server (port 3010): create a jsx story with a `<Grid>` via the Markup tab; verify
view-mode placement, phone-width stacking (devtools narrow viewport), edit-mode drag +
resize; **verify persistence by reading the artifact** — the Markup tab / stored
`content.story` must show updated `x/y/w/h`, and a reload must render the dragged layout.

**Capture fidelity is verified, not assumed.** View-mode positioning serializes by
construction (compiled classes live in-root; CSS vars/positions are inline `style`
attributes, which `XMLSerializer` keeps; `position: absolute` is not banned CSS — only
`fixed`/`sticky` are). The one genuinely browser-dependent piece is container-query
stacking inside the rasterized-SVG path — add a Grid story case to the real-browser
capture-matrix guard (`scripts/b2-surface-matrix.ts` / `b2-surface-drivers.tsx`) and
verify a share-card/screenshot of a Grid story at desktop and phone widths.

---

## Risks / gotchas to watch during implementation

- **Mount-echo commits**: RGL fires `onLayoutChange` on mount and vertical compaction can
  normalize authored positions. Using `onDragStop`/`onResizeStop` + `diffLayouts` avoids
  writing to the file when the user only opened edit mode. If compaction *visually*
  normalizes on mount without a commit, edit-mode display and source disagree until the
  first drag — acceptable (the next drag commits the normalized truth), but confirm in QA.
- **Stale pixels after drag** (Chromium foreignObject): transitions are killed by
  `STORY_GRID_EDIT_CSS`; if QA still shows stale tiles after a drag-triggered relayout, port
  `DashboardSurface`'s `translateZ(0)` nudge into `AgentHtml`'s resize path.
- **Interactive children vs. drag**: RGL drags on mousedown anywhere in the item. The
  dashboard lives with this in edit mode; if param dropdowns inside GridItems become
  unusable while editing, add `draggableCancel` for `input, select, button, [role="combobox"]`.
- **Story iframe remounts on content change**: each committed drag changes `content.story`,
  and `AgentHtml`'s build effect re-runs on `bodySource`. `use-story-rebuild-stability`
  already pins height/scroll for exactly this; verify the pin holds for a drag commit (same
  path as a text-edit commit today).
- **`w` on narrow view widths**: percent-width items with px-height children can overflow
  text; the `@max-2xl` stack handles phones, but mid-width (tablet) keeps the grid — QA a
  ~800px viewport.
- **Do not add Grid to legacy allowlists**: `JSX_COMPONENT_NAMES` (legacy stories) stays
  untouched; only `STORY_UI_COMPONENT_NAME_LIST` (new-format) grows.

## Decisions taken without asking (veto if wrong)

1. **12 cols / 86px row / 6px gutter fixed defaults**, `cols`/`rowHeight` overridable on
   `<Grid>` — mirrors the dashboard's rhythm.
2. **View mode is pure CSS** (no RGL outside edit mode) — capture-safe and cheaper than a
   static RGL mount.
3. **Phone behavior is stack-in-source-order** via container query, not a second authored
   layout.
4. **`SurfaceWidthContext` stays in `lib/dashboard-surface`** and is imported by the story
   surface — shared primitive, not moved.
