# Story authoring — JSX as data

How authored markup becomes a renderable tree: `lib/jsx` (static JSX parsed to inert data, with the
prop deny-list and validation) and `lib/story-ui` (the component registry and interpreter).

These two are grouped because they share consumers — `components/views`, `lib/data/story`,
`lib/validation`. The surface these trees mount INTO is `frontend/lib/story-surface/CLAUDE.md`.

> Part of the MinusX project documentation. The root `CLAUDE.md` carries the system
> overview, the module map and the development principles that apply everywhere.

### `lib/jsx` — static JSX as inert data

`parseJsx` (acorn + acorn-jsx, isomorphic) wraps the source in `<>…</>` so multiple roots are legal,
offset-corrects positions back, and normalizes to `JsxElement | JsxText | JsxExpression`. Attribute
and child `{…}` expressions are resolved to JSON literals where possible; **non-static expressions
are recorded, not thrown**, so `validateJsx` can reject them with a precise span. Only an acorn
syntax error yields `{ ok: false }`.

`validate.ts` is the security boundary — a JSX parser gives no "static" guarantee for free. It
rejects: non-JSON attribute values and spreads, `on*` handlers, name-denied attrs
(`dangerouslySetInnerHTML`, `ref`, `key`, `srcdoc`, `is`), dangerous tags
(`script`/`iframe`/`object`/`embed`/`base`/`meta`/`link`/`form`/`frame`/`frameset`/`applet`/`noscript`),
unregistered Capitalized tags, tags outside an optional HTML allowlist, and dangerous URL schemes in
URL-bearing attributes. Scheme checking strips `[\x00-\x20]` first because browsers do
(`java\tscript:` resolves as `javascript:`); `srcset`/`ping` are checked per list entry;
`data:image/*` is allowed, other `data:` is not.

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
Names only — no React import — so server-side save validation stays headless.

### `lib/story-ui` — registry and interpreter

`registry.ts` maps ~60 tag names to the vendored shadcn components in `components/kit/*`.
`component-names.ts` is the same list as data only (`STORY_UI_COMPONENT_NAME_LIST`) plus
`STORY_HTML_TAGS`, the explicit HTML allowlist for new-format stories; `__tests__/registry-names.test.ts`
asserts the two never drift.

`interpreter.tsx` turns a validated AST into React elements over an injected registry:

```
JsxNode[] ──renderStoryNodes(nodes, { components, decorateElement })──▶ React.ReactNode
             per node: buildProps → React.createElement(Component ?? tag.toLowerCase())
```

It is **defense in depth, not a second validator**: even on an unvalidated AST it drops `on*` props,
`DENIED_PROPS`, dangerous URL schemes, and non-static values, so nothing executable reaches React.
Unknown Capitalized tags render nothing. Author-side HTML spellings are mapped (`class`→`className`,
`for`→`htmlFor`); `style` accepts a CSS string or an object and is sanitized to string/number values.
Controlled props are rewritten to their uncontrolled forms, but `value`→`defaultValue` **only on
`Tabs`/`Accordion`** — elsewhere `value` names a pane (`TabsTrigger`, `AccordionItem`) or is the
displayed number (`Progress`), and rewriting it breaks the component.

Every element is stamped `data-mx-ast="<path>"` (dot-separated child indexes counting *all* nodes).
That stamp is how `lib/data/story/jsx-edit.ts` maps a WYSIWYG DOM edit back to the JSX source node;
`decorateElement` is the hook `components/views/shared/StoryJsxBody.tsx` uses to wrap editable text
hosts — implementations must preserve the element's `key`, which carries the same path.

`floating.ts` exports `STORY_FLOATING_CSS`, injected into the story root: inside `foreignObject`
`position: fixed` resolves against the SVG viewport, not the page, so Radix's popper wrapper
(`[data-radix-popper-content-wrapper]`) is forced to `absolute`. `cn.ts` re-exports
`components/kit/cn.ts`. `recipe-classes.ts` is a generated Tailwind-candidate union extracted from kit
sources (`npm run generate-story-ui-classes`), unioned with per-story candidates when
`lib/data/story/story-css.server.ts` compiles a story's CSS. The compile candidate set is actually
`STORY_RECIPE_UNION` = these classes ∪ `STORY_WYSIWYG_CLASSES` (`lib/data/story/typography.ts`), and
that union is also the hash source for `storyCssCompileVersion()` — so growing the format toolbar's
palette flips the version and every previously-saved story recompiles at read time
(`lib/data/story/__tests__/story-css-typography.test.ts`).

`lib/data/story/typography.ts` is that second half and the single source of truth for the WYSIWYG
format toolbar: which Tailwind classes it may apply (a curated, token-based palette — the `text-*`
size scale, `font-bold`/`italic`/`underline`, the four alignments, curated `mt-*`/`mb-*`/`p-*` steps,
`max-w-prose`, and the full-bleed recipe) plus the pure class-string algebra that the live DOM
mutation and the AST write-back both call, so instant feedback and persisted source can never
diverge. It is curated rather than free-form for two reasons: `story-css.server.ts` pre-bakes the
whole palette into every story's sheet, so applying a class is a DOM attribute change with zero
recompile latency, and a bounded palette can never author a declaration the banned-CSS guard would
strip. Stepping is **relative and in place** — every size/spacing token shifts one step including
variant-prefixed ones (`text-3xl @2xl:text-5xl` → `text-4xl @2xl:text-6xl`), because the story skill
mandates responsive type and a stepper that only rewrote the base token would leave the `@2xl:`
variant winning the cascade and masking the click.
