# Story authoring — JSX as data

How authored markup becomes a renderable tree: `lib/jsx` (static JSX parsed to inert data, with the
prop deny-list and validation) and `lib/story-ui` (the component registry and interpreter).

These two are grouped because they share consumers — `components/views`, `lib/data/story`,
`lib/validation`.

The three tiers, in order: **authoring (here) → mounting → capture.** The surface these trees mount
into is `frontend/lib/story-surface/CLAUDE.md`, which also carries the render-path/save-path
interactions and the gotchas shared by all three. Turning a mounted surface into an image is
`frontend/lib/screenshot/CLAUDE.md`.

> Part of the MinusX project documentation. The root `CLAUDE.md` carries the system
> overview, the module map and the development principles that apply everywhere.

## `lib/jsx` — static JSX as inert data

`parseJsx` (acorn + acorn-jsx, isomorphic) wraps the source in `<>…</>` so multiple roots are legal,
offset-corrects positions back, and normalizes to `JsxElement | JsxText | JsxExpression`. Attribute
and child `{…}` expressions are resolved to JSON literals where possible (literals, `+`/`-` numbers,
arrays, plain objects, and a **single-quasi template literal** — which is how SQL and CSS survive as
data); **non-static expressions are recorded, not thrown**, so `validateJsx` can reject them with a
precise span. A spread attribute is recorded as the pseudo-attribute `...`. Only an acorn syntax
error yields `{ ok: false }`.

`validate.ts` is the security boundary — a JSX parser gives no "static" guarantee for free. It
rejects: non-JSON attribute values and spreads, `on*` handlers, name-denied attrs
(`dangerouslySetInnerHTML`, `ref`, `key`, `srcdoc`, `is`), dangerous tags
(`script`/`iframe`/`object`/`embed`/`base`/`meta`/`link`/`form`/`frame`/`frameset`/`applet`/`noscript`),
unregistered Capitalized tags, tags outside an optional HTML allowlist, and dangerous URL schemes in
URL-bearing attributes (`href`, `src`, `action`, `formaction`, `poster`, `background`, `cite`,
`data`, `xlink:href`, `ping`). Scheme checking strips `[\x00-\x20]` first because browsers do
(`java\tscript:` resolves as `javascript:`); `srcset`/`ping` are checked per list entry;
`data:image/*` is allowed, other `data:` is not. An unknown-component error always lists the
registered set, and names the legacy trap when the tag is a retired design-system component — the
message is the model's only route to self-correction.

The optional `stylePolicy:'tailwind-only'` adds the Story authoring boundary: it rejects `<style>`,
`style`, and the historical `<Param labelStyle>` alias with recovery guidance pointing to literal
`className` utilities. `file-markup.ts` applies it to new and already-clean JSX stories. A JSX story
that already stores authored CSS uses an explicit compatibility context until migrated, so an
unrelated edit cannot lock an existing file; legacy HTML is unchanged.

`serialize.ts` is the inverse and the round-trip is load-bearing: strings are entity-escaped
(`&`, `"`, `<`, `>` in attributes; plus `{`/`}` in text), because acorn-jsx *decodes* entities and
does **not** process backslash escapes — `JSON.stringify`ing an attribute containing `"` would
terminate the attribute and lock the file out of every subsequent edit. Static string expression
children re-emit as template literals so SQL/CSS keep `<`, `>`, `{` raw.

`lenient.ts` (`sanitizeLooseJsx`) rewrites the three HTML-isms agents actually produce — comments,
unclosed void tags, a stray `<` in prose — skipping template-literal spans. It is applied **only as
a retry after a strict parse failure** (`lib/data/story/content-jsx.ts`); a document that already
parses is never altered. Comment stripping runs to a fixpoint (one pass can splice a new `<!--`).

`components.ts` binds the two allowlists: `JSX_COMPONENT_NAMES` (legacy stories: embeds + the
invented design components in `lib/data/story/story-components.ts`) and
`JSX_STORY_COMPONENT_NAMES` (new `format:'jsx'` stories: embeds + `STORY_UI_COMPONENT_NAME_LIST`).
Both start with the three live embeds `Question` / `Param` / `Number`. Names only — no React
import — so server-side save validation stays headless.

## `lib/story-ui` — registry and interpreter

`registry.ts` maps ~60 tag names to the vendored shadcn components in `components/kit/*`
(`STORY_UI_COMPONENTS`; `STORY_UI_COMPONENT_NAMES` is its `Object.keys`).
`component-names.ts` is the same list as data only (`STORY_UI_COMPONENT_NAME_LIST`) plus
`STORY_HTML_TAGS`, the explicit HTML allowlist for new-format stories; `__tests__/registry-names.test.ts`
asserts the two never drift. Adding a component means editing **both** files.

## The story grid — `Grid` / `GridItem`

`components/kit/grid.tsx` is the dashboard-style positioned layout for jsx stories (registered
like any other component; the name collides with the retired LEGACY `Grid` in
`lib/data/story/story-components.ts` deliberately — separate allowlists, same precedent as `Card`).
View mode is **pure CSS**: items are absolutely positioned from CSS variables consumed by literal
Tailwind arbitrary-value classes (spaceless `calc()` — the recipe-class extractor splits string
literals on whitespace), so captures serialize by construction and no JS measures anything.
Below the `@2xl` container width items stack in source order, KEEPING their px height (embeds
inside fill the cell at 100% via the exported `GridItemContext`, so auto height would collapse
them). `lib/data/story/__tests__/story-css-grid.test.ts` pins that the per-story Tailwind compile
actually EMITS these rules — candidates being extracted is not proof of emission.

`grid-layout.ts` is the pure geometry (12 cols × 86px rows — the dashboard's 80+6 folded; the
gutter is `p-[3px]` INSIDE each item so edit-mode react-grid-layout runs `margin [0,0]` and both
modes place with identical arithmetic). It owns the single defaulting/clamping rule
(`gridItemRect`) and the drag-commit diff (`diffLayouts` — empty diff = the mount-echo guard).
`grid-css.ts` is the hand-vendored RGL structural CSS for edit mode (transitions killed — the
foreignObject repaint bug), injected inside the surface root by `StoryJsxBody`'s `GridAdapter`.
Edit-mode drag/resize commits are the edit session's THIRD edit kind: `applyLayoutEditsToJsx`
(`lib/data/story/jsx-edit.ts`) writes x/y/w/h back by AST path, composed after text and format
edits. The RGL item key IS the GridItem's `data-mx-ast` path.

## The slide deck — `SlideDeck` / `Slide`

`components/kit/slides.tsx` is the presentation layout for jsx stories (the `deck` template's
slide recipe as a component). Pure stacked flow: each `Slide` is a full-viewport flex column
(`min-h-[var(--mx-vh,760px)]` — `--mx-vh` is the host viewport height stamped on the surface
root; vh units are broken inside `foreignObject`), so captures serialize by construction and
nothing measures anything. `Slide` deliberately sets no `w-full`: an explicit 100% width breaks
the full-bleed divider recipe (negative side margins over a fixed width).

Each rendered slide is stamped `data-mx-slide` (+ `data-mx-slide-title` when authored) — render
artifacts (covered by the `data-mx-*` write-back strip), and the discovery contract for the
PARENT-document chrome: `slide-nav.ts` (pure math — discovery + title fallback, the
iframe→parent coordinate mapping, the active-slide rule) and `use-slide-nav.ts` (the hook:
bounded discovery poll re-armed per content rebuild, scroll-tracked active index, imperative
`goTo`). Consumers are `components/views/story/StorySlideRail.tsx` (birds-eye rail while browsing
and editing; edit sessions add inline title rename, written back by AST path via
`lib/data/story/story-slides.ts`) and `StoryPresentControls.tsx` (paging + keyboard while
fullscreen via `PresentationContext` — presenting shows only the pill). Navigation always scrolls a parent-document container — the iframe is
content-sized and never scrolls itself — and the scroller is re-resolved on use because
presentation mode changes which ancestor scrolls.

The rail's content thumbnails are `slide-thumbs.ts` + `use-slide-thumbs.ts`: ONE surface
serialization per content rebuild (the same `serializeStorySvg` → `svgToImage` pipeline as the OG
share card), rasterized once and cropped per slide into small JPEG data URLs — never the multi-MB
SVG URL per entry. The capture debounces after mount and re-arms on iframe resize (embeds hydrate
late and each hydration grows the surface; resizes stopping is the recapture signal, and they stop
once hydration settles). Every failure path returns null and the rail falls back to its title list.

`interpreter.tsx` turns a validated AST into React elements over an injected registry:

```
JsxNode[] ──renderStoryNodes(nodes, { components, decorateElement })──▶ React.ReactNode
             per node: buildProps → React.createElement(Component ?? tag.toLowerCase())
```

It is **defense in depth, not a second validator**: even on an unvalidated AST it drops `on*` props,
`DENIED_PROPS`, dangerous URL schemes and non-static values, so nothing executable reaches React.
Unknown Capitalized tags render nothing. Author-side HTML spellings are mapped (`class`→`className`,
`for`→`htmlFor`); `style` accepts a CSS string or an object and is sanitized to string/number values.
Object/array values are kept on components (the `viz`/`params` envelopes) and dropped on HTML tags,
where React would stringify them into attributes to no purpose. Controlled props are rewritten to
their uncontrolled forms, but `value`→`defaultValue` **only on `Tabs`/`Accordion`** — elsewhere
`value` names a pane (`TabsTrigger`, `AccordionItem`) or is the displayed number (`Progress`), and
rewriting it breaks the component.

The interpreter and `validateJsxSource` are two *independent* gates with the *same intent*, and
neither may be relaxed on the assumption that the other caught it: the interpreter runs on stored
markup that was validated by an older version of the rules, and the validator runs server-side where
React is never imported. The two deny/URL lists are hand-mirrored, so **edit them together** —
`DENIED_ATTRS`/`URL_ATTRS`/`URL_LIST_ATTRS` in `lib/jsx/validate.ts` and
`DENIED_PROPS`/`URL_PROPS`/`URL_LIST_PROPS` in `interpreter.tsx`. They already diverge on one entry:
the validator sees the authored spelling `xlink:href` while the interpreter sees the React prop name
`xlinkhref`, so neither list catches the other's form.

Every element is stamped `data-mx-ast="<path>"` (dot-separated child indexes counting *all* nodes).
That stamp is how `lib/data/story/jsx-edit.ts` maps a WYSIWYG DOM edit back to the JSX source node;
`decorateElement` is the hook `components/views/shared/StoryJsxBody.tsx` uses to wrap editable text
hosts — implementations must preserve the element's `key`, which carries the same path.

`floating.ts` exports `STORY_FLOATING_CSS`, injected into the story root: inside `foreignObject`
`position: fixed` resolves against the SVG viewport, not the page, so Radix's popper wrapper
(`[data-radix-popper-content-wrapper]`) is forced to `absolute`. The vendored popover never portals,
and the vendored tooltip drops its portal when `TooltipProvider` is `portalled={false}` (what
`StoryJsxBody` sets), so floating content stays inside the serialized subtree. `cn.ts` re-exports
`components/kit/cn.ts`.

## The compiled-CSS candidate set

`recipe-classes.ts` is **generated**, not hand-written: a Tailwind-candidate union extracted from
`components/kit` + `EMBED_CHROME_FILES` sources by `scripts/generate-story-ui-classes.ts`
(`npm run generate-story-ui-classes`), guarded for freshness by `__tests__/recipe-classes.test.ts`.
The extractor tokenizes **raw source text**, so even a comment edit to one of those files changes
the candidate set and trips the gate — regenerate after touching them, whatever you changed.

`lib/data/story/story-css.server.ts` compiles a story's CSS from that union plus the story's own
extracted candidates. The union is `STORY_RECIPE_UNION` = `STORY_UI_RECIPE_CLASSES` ∪
`STORY_WYSIWYG_CLASSES` (`lib/data/story/typography.ts`), and it is **also the hash source for
`storyCssCompileVersion()`** — so growing the format toolbar's palette flips the version and every
previously-saved story recompiles at read time
(`lib/data/story/__tests__/story-css-typography.test.ts`).

`lib/data/story/typography.ts` is that second half and the single source of truth for the WYSIWYG
format toolbar: which Tailwind classes it may apply (a curated token-based palette — the `text-*`
size scale, `font-bold`/`italic`/`underline`, the four alignments, curated `mt-*`/`mb-*`/`p-*` steps,
`max-w-prose`, and the full-bleed recipe) plus the pure class-string algebra that the live DOM
mutation and the AST write-back both call, so instant feedback and persisted source can never
diverge. `story-css.server.ts` pre-bakes that finite palette into every story's sheet, so applying
one of those classes is a DOM attribute change with zero recompile latency. Picker colors are the
deliberate unbounded exception: they persist as important arbitrary-value Tailwind utilities and
use a DOM-only inline preview until the story-specific CSS compile lands. Stepping is **relative
and in place** — every size/spacing token shifts one step including
variant-prefixed ones (`text-3xl @2xl:text-5xl` → `text-4xl @2xl:text-6xl`), because the story skill
mandates responsive type and a stepper that only rewrote the base token would leave the `@2xl:`
variant winning the cascade and masking the click.

## Key files

| Task | File |
|---|---|
| Add/deny a JSX attribute or tag | `frontend/lib/jsx/validate.ts` (+ mirror in `frontend/lib/story-ui/interpreter.tsx`) |
| Add a component stories can use | `frontend/lib/story-ui/registry.ts` **and** `frontend/lib/story-ui/component-names.ts` |
| Change grid geometry / drag-commit diff | `frontend/lib/story-ui/grid-layout.ts` (+ `frontend/components/kit/grid.tsx` classes) |
| Change slide sizing / stamps | `frontend/components/kit/slides.tsx` |
| Change slide discovery / navigation math | `frontend/lib/story-ui/slide-nav.ts`, `frontend/lib/story-ui/use-slide-nav.ts` |
| Change slide thumbnail capture / crop geometry | `frontend/lib/story-ui/slide-thumbs.ts`, `frontend/lib/story-ui/use-slide-thumbs.ts` |
| Grid items misplaced in edit mode vs view mode | `frontend/lib/story-ui/grid-css.ts`, the `GridAdapter` in `frontend/components/views/shared/StoryJsxBody.tsx` |
| Allow another raw HTML tag | `frontend/lib/story-ui/component-names.ts` (`STORY_HTML_TAGS`) |
| Story CSS candidate list is short a class | `frontend/lib/story-ui/recipe-classes.ts` → `npm run generate-story-ui-classes` |
| Add a class the format toolbar can apply | `frontend/lib/data/story/typography.ts` (auto-unions into the compile and flips the CSS version) |
| Fix an agent's markup failing to parse | `frontend/lib/jsx/lenient.ts`, `frontend/lib/jsx/parse.ts` |
| A saved story loses its SQL/CSS or breaks on re-edit | `frontend/lib/jsx/serialize.ts` (entity escaping / template-literal children) |

## Design decisions

**Do not fork a JSX parser, and do not reach for MDX.** A post-parse validator over `acorn` +
`acorn-jsx` is less code and less maintenance than a dialect-specific parser, and it yields precise
diagnostics ("attribute `viz` uses a call expression — not allowed") instead of an opaque parse
failure, which is what lets the agent self-correct. MDX is the wrong shape at a deeper level: it
*compiles JSX to an executable JavaScript module*, reinstating the "it is code, not data" problem the
interpreter exists to avoid. The markup stays an inert AST that is interpreted, never evaluated.

**Prop filtering has to be a deny list, and that is forced by the component library.** Every one of
the 20 vendored kit components spreads `{...props}` onto its root element and enumerates nothing, so
there is no allow list of props that could be expressed — an unknown attribute reaches the DOM by
construction. Hence the global denials: `on*` handlers, `ref`, `key`, `dangerouslySetInnerHTML`,
`srcdoc`, `is`, style sanitized to string/number values, and scheme filtering on every URL-bearing
attribute. This matters because `content.story` is editable by any org user and rendered to other
viewers including anonymous guests — it is a real XSS boundary, not a lint.

**No story-side JavaScript, and no query tool that would need it.** The interpreter runs in the
*parent* React tree and portals into the story root, which is only possible because the iframe stays
same-origin: one React tree, one Redux store, direct events, no in-iframe bundle and no
`postMessage` bridge. Shipping arbitrary story JS would only be safe under an opaque-origin sandbox,
which kills the parent's `contentDocument` access and forces both the embeds and the interpreter into
an in-iframe bundle behind a bridge — an entire second architecture in service of one feature. If the
need returns, the shape is a closed-verb API executed by trusted parent-side code: never `eval`,
never a sandboxed realm.

**`format:'jsx'` story bodies are stored as jsx TEXT**, not as a stored AST. The AST is a transient in
every edit path, and the `data-mx-ast` stamps are render output only — `jsx-edit.ts` strips **any**
`data-mx-*`-prefixed attribute (matched by prefix, not by an enumerated list) plus `contenteditable`
before writing back, so a new render artifact is covered without an edit there.
