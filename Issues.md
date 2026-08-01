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

### 2. Tutorial mode takes minutes to load; queries time out
**Status:** Open — root cause identified, fix not written.

Every tutorial card sits on "Executing query.." and times out at ~2 min; chat sits on "Loading
connections and context...".

**Root cause.** The tutorial `static` connection is `type: csv` with 20 parquet files addressed by
`s3_key`. `lib/connections/csv-connector.ts:110` creates a **VIEW** per file
(`CREATE OR REPLACE VIEW … AS SELECT * FROM read_parquet('s3://…')`) — a view, not a table, so
**DuckDB re-reads the object from S3 on every single query**. Nothing is materialised or cached
locally.

The tutorial dataset is **173 MB across 20 parquet files**. The `Top Level Metrics` dashboard fires
**11 questions at once** on open. With `OBJECT_STORE_*` pointing at a real bucket, each query pays
full WAN latency to re-read its parquet; the queries queue behind `MAX_CONCURRENT_QUERIES` and blow
the client timeout.

**Options, cheapest first.**
1. **Materialise on instance init** — `CREATE TABLE AS SELECT * FROM read_parquet(...)` instead of
   `CREATE VIEW` for this connector. `instanceCache` already keeps one DuckDB instance per
   connection, so the download happens once per process instead of once per query. Costs 173 MB of
   process memory for the tutorial, which is the thing to check before committing to it.
2. **Materialise only small files**, keep views above a size threshold, so a customer's large CSV
   connection is unaffected.
3. **Ship the tutorial parquet in the image** and read from local disk (`isLocal` branch), removing
   the network entirely for the demo path.
4. **DuckDB httpfs caching** — least code, but least control over when it warms.

Option 2 is probably the right shape: the bug is specifically that a *demo* dataset is re-fetched
per query, and a size threshold fixes that without changing behaviour for real connections.

### 3. Story edits change unrelated parts of the document
**Status:** Open — two hypotheses to test.

a. The agent is not told to focus on where the user is looking.
b. The agent reaches for global styles where local ones would do, so one change lands everywhere.

The app *does* send viewport position (`_currentTime`/`<Viewport>` in `lib/projection/messages.ts`),
so the raw signal exists — the question is whether any prompt tells the agent to *use* it. Both
halves need verifying against the actual assembled prompt.

### 4. Screenshot is not identical to the rendered story
**Status:** Open. Font, spacing and text wrap differ between the capture and the live surface.
To be reproduced directly by capturing a story and diffing against the live render — not waiting
on a hand-supplied example.

### 5. Hydration errors in the app shell
**Status:** Open — found, not chased. Next.js dev overlay reports 3 recoverable hydration
mismatches ("server rendered HTML didn't match the client") on a Chakra `<Stack>`.
`lib/utils/error-utils.ts` already classifies hydration errors in order to *suppress* them from
reports, so these are known and muted rather than fixed.

### 6. Lost rationale comment in `file-edit.ts`
**Status:** Open — one line. `lib/file-state/file-edit.ts:318` sets `assets = undefined` and the
comment now says only *what* it does. The deleted *why* is load-bearing:
`store/filesSlice.ts:991` merges with a spread (`{...content, ...persistableChanges}`), and a
spread cannot delete a key — so `delete` would silently stop clearing the field. Restore the
rationale next time the file is touched.

---

## Not reproducible

### 7. Search bar (top right) does not work
**Status:** Not reproducible — works end to end.

Verified in the browser against a healthy dev server: typed a query → dropdown with 5 ranked
results (name, path, snippet) → clicked one → navigated to `/f/1010`.

Two earlier claims that it was broken were both investigation errors, recorded so they are not
repeated: a `grep | head -5` truncation hid the mount at
`components/file-browser/Breadcrumb.tsx:284`, and a later "reproduction" was actually a wedged dev
server, not the product.

### 8. App fails to load
**Status:** Not reproducible as a product bug.

A frozen renderer with a permanent spinner was reproduced, but the cause was a wedged Next.js dev
server (stale `.next`). `rm -rf .next` + restart cleared it completely. Worth knowing this is what
that failure looks like, since it mimics an application hang convincingly.

---

## Watch list — same shape as #1, not yet a problem

The all-or-nothing hash in `FacetMemo` applies to every facet, not just markup. The others are
survivable today for specific reasons, which are worth knowing because those reasons could change:

- **Query-result `data`** — same all-or-nothing behaviour, but bounded by `enforceQueryLimit`
  (1000/10000 rows) and stripped from app state entirely by `stripQueryData`, so only explicitly
  requested tool results carry rows.
- **Query-result facet keys are content-derived.** `queryResultId` is a hash of query + params +
  database, so an edited query produces a brand-new key and its rows are always sent in full, even
  when almost every row is unchanged. Inherent to keying by content; only worth addressing if
  result payloads start dominating.
- **`finalQuery`** — same shape, already truncated when huge.
- **Images are diffed on `key`, never the payload**, so base64 is never hashed or re-sent. This is
  the pattern the other heavy facets should be measured against.
