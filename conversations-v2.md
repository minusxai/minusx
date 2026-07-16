# Conversations V2 — Display-Grade Wire Projection

## Problem

The conversation read path ships the **verbatim pi log** to the browser. The log is written
for the LLM (full replay fidelity), not for rendering — so the client downloads, JSON-parses,
and holds in Redux megabytes it never displays. Measured on a real story-editing conversation
(3 user turns, 10 log entries, **3.2MB** on the wire):

| Payload | Size | Needed to render? |
|---|---|---|
| `context.appState.state.fileState` (full story state, **per turn**) | ~465KB × turn | No — dev inspector only |
| `context.resolvedContextDocs` (identical every turn) | ~139KB × turn | No |
| EditFile/ReviewFile screenshot, stored **twice** (image content block + `details.screenshotUrl`) | ~250KB × 2 × edit | One copy (`details`) |
| `details.__status` / result-text echoes (markup) | up to ~150KB each | No — `details.diff` suffices |
| Assistant text/thinking, user messages, tool args, diffs | ~20–40KB total | **Yes** |

Display-relevant content is ~1–2% of the wire. It compounds: after **every turn** the client
re-fetches the **entire** conversation (`ConversationsAPI.get`), re-parses it, and replaces the
Redux copy — so long conversations re-download megabytes per message and Redux permanently
holds multi-MB strings. This is the reported slowness while editing stories.

## Contract

> **`content` is the LLM's channel. `details` is the client's channel.**

- **Storage is untouched.** The full log remains the source of truth; the agent replays it
  verbatim (`loadLog`). Double-stored screenshots in `content` + `details` are an accepted
  storage tradeoff (jsonb is compressed at rest; some deployments mandate base64, so an
  object-store URL is not always possible).
- **The wire has two views:**
  - `display` (default): entries are slimmed per the rules below. This is what non-dev users get.
  - `full` (`?view=full`): the verbatim log. Requested by the client **only when `ui.devMode`
    is on** (the single existing "Show Debug Options" flag — all `showDebug` usages alias it).
    This is a bandwidth knob, not a security boundary: the data is the requester's own
    conversation either way.
- The deepest debug data (exact LLM request/response) already lazy-loads via
  `/api/llm-calls/{callId}` and is unaffected.

## Slimming rules (`display` view)

Applied per entry by a pure projection. **Entry count, order, ids, `parent_id`, and timestamps
are always preserved** — the client uses `piLog.length` as `log_index` (resume/fork/interrupt)
and derives pending frontend-tool calls by matching toolCall ids. We shrink entries, never drop them.

| Entry kind | Rule |
|---|---|
| Root agent invocation (`type: 'toolCall'`, `parent_id: null`) | Keep `arguments` (userMessage), id, timing. In `context`, keep `currentTime` + `attachments` (transcript thumbnails); **drop everything else** (`appState`, `resolvedContextDocs`, `schema`, `whitelistedTables`, user/mode plumbing). |
| Assistant entry | Keep content blocks (reply text, thinking, toolCall blocks — displays read tool args from them). **Drop `usage`/debug fields** (the wire-side "debug messages" are derived from these; UI never renders them with devMode off). |
| ToolResult — `EditFile`, `ReviewFile`, `Screenshot` (health) | **Drop `content` entirely** (image block + status/markup echo are LLM-only). Keep `details` minus `__status` (cap `diff` at 32KB). `details.screenshotUrl` is the display copy and stays. |
| ToolResult — search/read family (`SearchDBSchema`, `SearchFiles`, `ReadFiles`, `CreateFile`, `FuzzyMatch`, `ExploreDataset`, `ListDBConnections`, `PublishAll`, `LoadContext`, `Clarify`, …) | Their displays parse the result string today and their tools don't populate `details`. Projection **derives `details` from `content` at read time** (parse + cap at 32KB) and drops `content`. Works retroactively for existing conversations — no write-path change. |
| ToolResult — `ExecuteQuery` | Drop `content` (the markdown table for the LLM, ≤100KB). Keep `details.queryResult` (chart/table card renders from it). |
| ToolResult — unknown tool | Conservative: keep `details`, cap `content` at 8KB (fallback display truncates gracefully). |
| Error rows | Unchanged (already small). |

## API changes

- `GET /api/conversations/:id?view=display|full&since=<seq>`
  - `view` defaults to `display`. `full` returns verbatim rows.
  - `since` (optional): return only messages with `seq > since` — the incremental reload.
    Seqs are contiguous; the response also carries `maxSeq` so the client detects a
    truncate-and-replay tail (manual/auto retry) that `since` alone can't see, and falls back
    to a full fetch on any mismatch. Errors are always returned in full (small, not seq-cursored).
- `GET /api/conversations/:id/stream?since=…&view=…` — `flushCatchup` applies the same
  projection per message unless `view=full`. The client doesn't request `full` on the live
  stream: streamed rows are ephemeral (finalize reloads from GET), and the live tool cards
  render from `details`, which the slim view carries.
- Both routes share one projection module: `frontend/lib/data/conversation-projection.ts`
  (pure, no `server-only` import, unit-testable; used only by server routes).

## Client changes

- `ConversationsAPI.get(id, { view?, since? })`; `view: 'full'` iff `selectDevMode`. Same for
  the stream URL (`conversation-stream-client.ts`).
- `parseToolContent()` (`DetailCarousel.tsx`) gains a fallback: no `content` on the message →
  return `msg.details`. Since derived `details` for the search family *is* the parsed content,
  all existing tool displays keep working unchanged (old and new conversations).
- **Incremental post-turn reload:** `store/conversation-log-cache.ts` keeps a per-conversation
  raw-log cache (module map, not Redux) with the view it was fetched in. Finalize fetches
  `?since=<cachedMaxSeq>`, verifies contiguity + the response `maxSeq`, appends, re-parses the
  (now slim) full log — cheap — and dispatches. Invalidated on manual/auto retry (server
  truncates-and-replays the tail), on any mismatch, and on every devMode toggle (slim and full
  entries must never mix).
- Toggling devMode **on** re-renders the active, settled conversation from the verbatim log
  (chatListener `setDevMode` listener) so the per-turn appState inspector has data without a
  page reload.

## Invariants / non-goals

- Entry count & ids identical across views (`log_index`, pending-derivation, fork all safe).
- Headless/Slack/benchmark paths read via `loadLog` server-side — untouched.
- Non-goals (future work, separate PRs): lazy-loading `details.screenshotUrl` behind a URL
  (drops slim view to tens of KB even with base64 mandates); write-path screenshot dedup;
  migrating tool displays to a formal `details`-only contract.

## Test plan (TDD order)

1. **Projection unit tests** (`lib/data/__tests__/conversation-projection.test.ts`): count/id
   preservation; appState/resolvedContextDocs stripped; EditFile content dropped + diff capped +
   screenshotUrl kept; search-family details derived; ExecuteQuery queryResult kept; assistant
   text kept + usage dropped; unknown-tool conservatism; idempotence (projecting a projected
   entry is a no-op).
2. **Route tests** (`app/api/conversations/[id]/__tests__/`): default GET is slim; `view=full`
   byte-identical to stored rows; `since` returns only new rows; stream catch-up slim vs full.
3. **Client tests**: `parseToolContent` fallback; chatListener incremental reload
   (storeE2E-style: turn → finalize fetches with `since`, Redux messages correct); devMode →
   `view=full` requested.
4. Red before green; full suite; browser-verify both modes on the dev server (network payload
   size, every card type renders, debug info intact in dev mode).
