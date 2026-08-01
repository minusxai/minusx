# Open Issues

Working tracker. Nothing is removed from this list when it turns out to be a non-bug — it is marked
**Not reproducible** with the evidence, because "we looked and it was fine" is a result worth keeping.

Source: the `mx-jul` doc, plus items found while investigating it.

Status key: **Open** · **In progress** · **Fixed** · **Not reproducible** · **Needs repro**

---

## Fixed

### 1. Context bloat — ~8k tokens per story edit
**Status:** Fixed — PR #683. Unit-verified; the delta path is NOT yet observed firing end-to-end.

`FacetMemo` diffs every facet by exact hash: identical -> a 42-token `{unchanged:true}` marker,
different by one character -> the **whole value**. `project.ts` had one facet key
(`file:<id>:content`) for the entire document, and the agent edits one line at a time, so every
edit re-sent the whole story.

Measured on a 40-section story: **5,498 tokens/turn while editing vs 42 tokens/turn while idle** —
a 131x gap. Fix emits a line diff (`<file_markup_delta>`) against the last full copy: **400
tokens/turn, a 13.7x reduction**. Three invariants keep it safe (only a FULL emission records a
delta base; `reset()` clears bases with hashes; a delta over `MAX_DELTA_RATIO` falls back to full
and rebases).

**Verification.** Two layers, plus one live run.

- `lib/projection/__tests__/markup-incremental.test.ts` drives `renderAppState` and measures the
  reduction. Confirmed RED before the fix (`expected 21993 to be less than 5528.5`).
- `lib/projection/__tests__/markup-delta-e2e.test.ts` drives **`projectMessages`** — the function
  that actually assembles what the model receives — over a multi-turn log: the document is sent
  once, each subsequent small edit is a `<file_markup_delta>` under a quarter the size, an unchanged
  turn still collapses to `{unchanged:true}`, and the block carries its own "this is a LINE DIFF /
  strip the prefix before using a line in oldMatch" instruction. These tests cannot pass on `main` —
  the tag does not exist there.
- A live session against a real model (conversation 1031, gpt-5.6-terra) created an 8-section story
  and edited it; the app behaved correctly and the agent's edit was properly scoped. Reading the
  real requests via `/api/conversations/<id>/llm-calls`, the markup facet went 45 -> 2111 chars
  (empty draft -> full story) and the projection correctly **declined** a delta, because that change
  exceeds `MAX_DELTA_RATIO`. That is the guard working, and it is now pinned as its own case in the
  e2e test.

**Residual gap:** a `<file_markup_delta>` has not been observed in live production traffic — the
follow-up small-edit turn did not record an LLM call before the local dev environment became
unusable (its proprietary tenancy module started throwing at the login path, unrelated to this
branch). The behaviour is proven through the real assembly function and by reading the rendered
prompt; it is not proven by a captured live request. To close it: open a story with substantial
markup, ask for a one-line change, then check
`(await (await fetch('/api/conversations/<id>/llm-calls')).json())` for `file_markup_delta`.

---

## Open

### 2. Story edits change unrelated parts of the document
**Status:** Partially fixed — the confirmed mechanism is addressed; one contributor is documented
and deliberately NOT changed.

**(a) "the agent isn't told to focus on where the user is looking" — RULED OUT.** The nudge already
exists twice. `orchestrator/prompts/prompts.yaml:34` explains the `<Viewport>` block; `:866` says
*"Default to the user's current viewport … do not propagate them into off-screen sections just
because similar markup appears elsewhere."* Two further bullets already demand minimal, scoped
edits. More prompt on scope would be redundant.

**(b) global vs local styling — CONFIRMED, and now addressed.**
`lib/data/story/file-markup.ts:58` `hasAuthoredStoryStyles()`: a stored JSX story containing a
`<style>` element or any `style`/`labelStyle` attribute is routed to `JSX_STORY_STYLE_COMPAT_CTX`
with `stylePolicy: 'allow'` rather than the `'tailwind-only'` policy new stories get. A `<style>`
rule is document-scoped, so editing one restyles every matching element — including off-screen
sections. The compat is **sticky**: once a story has authored CSS it keeps `allow` forever.

*Fix applied:* a new bullet in the "Editing an existing story" prompt section states that a
`<style>` rule is global and a class is local, that older stories still carry authored CSS where
editing a rule silently restyles everything matching the selector, and that a localized change
belongs on utility classes. Reaching for a `<style>` rule now requires the user to have asked for a
story-wide change, and the agent must say so.

**A second contributor — diff noise, not render change. Documented, not changed.** The markup
round-trip canonicalises the WHOLE document on every edit: quote style (`'x'` -> `"x"`), void
elements (`<br>` -> `<br />`), and the `<story>` wrapper joining its first child. Class whitespace
and entities are preserved, so **rendering is unaffected** — but on the first edit of a
non-canonical story the diff touches every section, which reads as "it changed the whole document".
Deliberately left alone: that canonical round-trip is what makes the echoed diff authoritative and
`oldMatch` reliable (`store/CLAUDE.md:133`), so moving it is a change to the edit surface for a
purely cosmetic gain. Fix it by canonicalising once on write if it becomes worth the risk.

### 3. Screenshot is not identical to the rendered story
**Status:** Partially fixed — the silent-degradation path is closed; the specific reported case is
not confirmed reproduced.

The capture pipeline is already careful about fonts: `@font-face` files are inlined as `data:` URIs,
`document.fonts.ready` is awaited (bounded), and `applyInheritedTypography` bakes the root's computed
typography onto the clone precisely because otherwise "text falls back to UA serif at
`line-height: normal` and **re-wraps**".

The hole was that `inlineFontUrls` (`lib/story-surface/serialize.ts`) returned `null` on ANY fetch
failure with no log and no signal. The face then keeps its original URL, which an `<img>`-rendered
SVG cannot fetch, so the text silently renders in a fallback family — and substituting a family
changes glyph widths, so **spacing and line wrapping move with it**. One degradation presents as the
exact reported triple (font, spacing, wrap) and is undiagnosable by construction.

*Fix applied:* failures are now recorded and warned. `takeFailedFontUrls()` drains the URLs that
failed since the last call, matching the `renderPending` / `reviewNote` contract used by
`reviewFile` — a degraded capture must not read as a clean one. Covered by three tests in
`lib/story-surface/__tests__/serialize.ui.test.ts`.

**Honest limit:** this makes the most likely cause observable; it does not prove it was the cause.
The next step is a capture on a story that actually exhibits the mismatch and reading the new
warning. I could not confirm it here — the local workspace has no story with the defect.

### 4. Hydration errors in the app shell
**Status:** Open — root-caused precisely, NOT fixed. This is the one item left undone.

Reproduced on a clean dev server at `/p/org` (1 recoverable error; it does not fire on every route
or every load, which is why it looked intermittent). Full component path from the console trace:

```
RightSidebar > HStack2 > Stack2 > chakra(div) display={{base:"none", ...}}
  <Insertion>
+ <div className="chakra-stack css-1somh0n">
```

The `+` node is the HStack's OWN div rendered by the client with a different Emotion class hash than
the server produced. Two candidates were checked and eliminated: it is **not** the
`{!isCollapsed && ...}` conditional at `RightSidebar.tsx:524` — `uiSlice`'s `initialState` sets
`rightSidebarCollapsed: true` deliberately ("Start closed so hydration never flashes the expanded
sidebar", `store/uiSlice.ts:73`) and `DataLoader` only applies the persisted value after mount — and
it is **not** the responsive `display` prop, which compiles to a media query.

That leaves an Emotion style-insertion divergence between server and client render.
`components/app-shell/Providers.tsx` mounts `<ChakraProvider value={system}>` with **no Emotion
cache provider and no `useServerInsertedHTML`**, which is the documented Next.js App Router
requirement for Emotion-based libraries; without it, SSR-inserted styles are not flushed in the
order the client recreates them.

**Why it is still open.** The change belongs in the app shell and affects every route, while the
bug itself is a dev-overlay-only warning that React recovers from by regenerating that subtree.
It could not be verified here either: the local dev environment became unreachable behind its
proprietary tenancy module (every route 307s to `/login`, and `RightSidebar` does not render on the
login page), so an app-shell change could not be exercised at all. Shipping an unverifiable global
change to fix a recoverable dev warning is the wrong trade.

**The next task, fully specified.** Add an Emotion cache provider to
`components/app-shell/Providers.tsx` — a client component that creates the cache once and flushes
inserted rules through `useServerInsertedHTML` — wrapping the existing `<ChakraProvider value={system}>`.
Then load `/p/org` with the right sidebar mounted and confirm the console reports no
"Hydration failed" entry. Ruled out already, so do not re-investigate: the `{!isCollapsed && ...}`
conditional and the responsive `display` prop.

### 5. Lost rationale comment in `file-edit.ts`
**Status:** Fixed — commit on `MISC/fixes-v7`.

`lib/file-state/file-edit.ts:317` now records why `assets` is assigned `undefined` rather than
`delete`-ed: staged edits recombine with stored content by SPREAD (the save path and
`selectMergedContent`), and a spread cannot remove a key, so `delete` silently leaves the stored
manifest intact. Pinned by `lib/file-state/__tests__/story-assets-cleared.test.ts`, whose second
case asserts the `delete` form does NOT clear it — so the trap is now enforced, not remembered.

## Not reproducible

### 6. Search bar (top right) does not work
**Status:** Not reproducible — works end to end.

Verified in the browser against a healthy dev server: typed a query → dropdown with 5 ranked
results (name, path, snippet) → clicked one → navigated to `/f/1010`.

Two earlier claims that it was broken were both investigation errors, recorded so they are not
repeated: a `grep | head -5` truncation hid the mount at
`components/file-browser/Breadcrumb.tsx:284`, and a later "reproduction" was actually a wedged dev
server, not the product.

### 7. App fails to load
**Status:** Not reproducible as a product bug.

A frozen renderer with a permanent spinner was reproduced, but the cause was a wedged Next.js dev
server (stale `.next`). `rm -rf .next` + restart cleared it completely. Worth knowing this is what
that failure looks like, since it mimics an application hang convincingly.
