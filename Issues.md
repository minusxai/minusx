# Open Issues

Working tracker. Nothing is removed from this list when it turns out to be a non-bug — it is marked
**Not reproducible** with the evidence, because "we looked and it was fine" is a result worth keeping.

Source: the `mx-jul` doc, plus items found while investigating it.

Status key: **Open** · **In progress** · **Fixed** · **Not reproducible** · **Needs repro**

---

## Fixed

### 1. Context bloat — ~8k tokens per story edit
**Status:** Fixed — PR #683 (`MISC/fixes-v7`), not yet merged, not yet LLM-verified.

`FacetMemo` diffs every facet by exact hash: identical → a 42-token `{unchanged:true}` marker,
different by one character → the **whole value**. `project.ts` had one facet key
(`file:<id>:content`) for the entire document, and the agent edits one line at a time, so every
edit re-sent the whole story.

Measured on a 40-section story: **5,498 tokens/turn while editing vs 42 tokens/turn while idle** —
a 131× gap. Fix emits a line diff (`<file_markup_delta>`) against the last full copy: **400
tokens/turn, a 13.7× reduction**.

Remaining: browser-verify with a live model that the agent handles delta blocks correctly when
building `oldMatch`. A provider is now configured, so this is unblocked.

---

## Open

### 2. Story edits change unrelated parts of the document
**Status:** Open — both hypotheses tested; (a) ruled out, (b) confirmed structurally.

**(a) "the agent isn't told to focus on where the user is looking" — RULED OUT.** The nudge already
exists, twice. `orchestrator/prompts/prompts.yaml:34` explains the `<Viewport>` block and tells the
agent to use it to ground "this" / "here" / "what I'm looking at". `prompts.yaml:866` is explicit:
*"Default to the user's current viewport … Keep ordinary copy, styling, and content adjustments
localized to those visible sections — do not propagate them into off-screen sections just because
similar markup appears elsewhere."* Adding more prompt here is unlikely to help.

**(b) global vs local styling — CONFIRMED as a real structural path.**
`lib/data/story/file-markup.ts:58` `hasAuthoredStoryStyles()`: a stored JSX story containing a
`<style>` element, or any `style`/`labelStyle` attribute, is routed to
`JSX_STORY_STYLE_COMPAT_CTX` with `stylePolicy: 'allow'` instead of the `'tailwind-only'` policy
that new stories get. A `<style>` block is **document-scoped by definition** — editing one rule in
it changes every section matching the selector, which is exactly the reported symptom.

The compat is **sticky**: once a story has authored CSS it keeps `allow` forever, so legacy stories
are never pushed toward local utilities and stay permanently exposed to this.

**A second, separate contributor — diff noise, not render change.** The markup round-trip
canonicalises the WHOLE document on every edit, measured: single→double quote style
(`'text-2xl'` → `"text-2xl"`), void elements (`<br>` → `<br />`, `<img/>` → `<img />`), and the
`<story>` wrapper joining onto its first child. Class whitespace and entities are preserved. None
of this changes rendering, but on the first edit of a non-canonical story it makes the diff touch
every section — which matches "have to always check whole document" even when the render is fine.

**Suggested direction** (not yet implemented): migrate legacy authored CSS to utilities so
`stylePolicy: 'allow'` stops being sticky, and/or nudge the agent to prefer local utilities over
editing a `<style>` rule when a story is in compat mode. The canonicalisation noise is separately
worth fixing by canonicalising on write once, rather than on every edit.

### 3. Screenshot is not identical to the rendered story
**Status:** Open. Font, spacing and text wrap differ between the capture and the live surface.
To be reproduced directly by capturing a story and diffing against the live render — not waiting
on a hand-supplied example.

### 4. Hydration errors in the app shell
**Status:** Open — found, not chased. Next.js dev overlay reports 3 recoverable hydration
mismatches ("server rendered HTML didn't match the client") on a Chakra `<Stack>`.
`lib/utils/error-utils.ts` already classifies hydration errors in order to *suppress* them from
reports, so these are known and muted rather than fixed.

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
