# Remote Agent Sessions ("Copy to Agent") — Architecture & Implementation Plan

**Status:** ✅ Implemented (Phases 1–4), browser-verified end-to-end · PR #583 · **Scope:** design + phased implementation plan (kept in sync with the implementation)
**Feature:** A "Copy to Agent" button in the chat sidebar copies a single line — `Fetch https://<host>/s/<code>` — that the user pastes into any external agent (Claude Code, Codex, a chat, …). The external agent fetches that URL, receives a self-describing skill document, and can then drive the user's MinusX session over plain HTTP: executing the same tools our own agent uses, editing files, running queries, and receiving results (including chart images). While the remote session is active, the side chat input is frozen and every remote action renders live in the side chat. The user can stop the session at any time and resume normal chat.

---

## 1. Core framing

**The external agent replaces the LLM, not the user.** MinusX's architecture already separates *deciding* the next tool call (the `MXAgent.run()` LLM loop) from *executing, logging, pausing and resuming* tool calls (`Orchestrator.dispatch()` / `resume()`, the append-only conversation log, SSE, the browser tool bridge). A remote session swaps the decider: instead of our LLM emitting tool calls, an external agent authors them over HTTP. Everything downstream is reused unchanged:

- **Server tools** (`ExecuteQuery`, `SearchDBSchema`, `SearchFiles`, …) execute in-process and return results in the HTTP response.
- **Frontend-bridged tools** (`EditFile`, `CreateFile`, `Navigate`, `Screenshot`, `PublishAll`, `ReadFiles`) pause exactly as today (`UserInputException`), round-trip through the user's browser via the existing SSE stream + Redux tool handlers, and the result flows back to the waiting HTTP request. (`ClarifyFrontend` is deliberately **excluded** from the remote toolset — the external agent has its own human channel; see §12.)
- **The conversation log is the audit trail and the render source**: every remote tool call and result is a normal log row, so the side chat renders remote activity with the existing display components, and the whole session is replayable/inspectable like any chat.

Because the orchestrator is reconstructed from the durable log on every request (see §5), the server side of a remote session is **fully stateless** — no in-memory session object, no heartbeat interval, no instance pinning. This works identically on single-process PGLite and multi-instance Postgres.

---

## 2. Transport (decided)

**External agent → server:** plain HTTP request/response (long-poll on the tool endpoint, `202` + poll fallback). Any agent with `fetch`/`curl` can drive it — no client library.
**Server → browser:** the existing resumable SSE stream (durable rows + seq cursor + LISTEN/NOTIFY). **Browser → server:** the existing `/turns` POSTs. This feature adds zero new requirements to the browser transport; the only new browser work is the observer mode (§9.1), a pure client-side change.

---

## 3. What exists today (scouting summary, with file references)

### 3.1 Turn / lease / stream mechanics
- `POST /api/conversations/[id]/turns` starts a turn (`userMessage`) or resumes one (`completedToolCalls`); the turn runs **detached** and clients tail `GET …/stream` (resumable SSE, cursor = `seq`). (`app/api/conversations/[id]/turns/route.ts`)
- `runConversationTurn` (`lib/chat/conversation-turn.server.ts:153`) claims a run lease (`acquireRunLease`), heartbeats every 30 s while running (`HEARTBEAT_MS`, lease TTL `RUN_LEASE_TTL_MS = 90_000` in `lib/data/conversations.server.ts:231`), commits new log entries incrementally (`appendMessages` + `notifyMessage`), and settles to `runStatus ∈ 'idle' | 'paused' | 'error'`.
- **A paused turn holds no server memory.** Resume is a fresh invocation: `setupOrchestration` maps `completed_tool_calls` tuples through `legacyToolResultToPi` → `orchestrator.resume(...)` (`lib/chat/orchestration-core.server.ts:436`), which **re-runs the paused agent's LLM loop**.
- LISTEN/NOTIFY: channel `conv_<id>`; payloads are seq pointers only (`ConversationNotify`, `lib/data/conversations.types.ts:88`). `subscribe(conversationId, handler)` (`conversation-stream.server.ts:80`) fans one LISTEN out to in-process handlers. Works on **both** PGLite (in-process, `pglite-adapter.ts:116`) and Postgres (cross-process, dedicated listen client, `postgres-adapter.ts:183`). NOTIFY is lossy-when-unlistened — correctness must always come from a SELECT, the NOTIFY is only a wakeup.
- `RunStatus = 'idle' | 'running' | 'paused' | 'error'` (`lib/data/conversations.types.ts:17`). Status is threaded through: turns-route concurrency guard (`turns/route.ts:51`), stream-route branching (`stream/route.ts:106-142`), `isRunLeaseStale` (`conversations.server.ts:258`), `interruptRun` (`conversations.server.ts:276`), turn settle (`conversation-turn.server.ts:275`).

### 3.2 Orchestrator & tools
- **`Orchestrator.dispatch(assistantMessage, parentAgent)` is the reusable primitive** (`orchestrator/orchestrator.ts:329`): takes a (possibly hand-built) `AssistantMessage` containing `toolCall` blocks; validates params against the tool's TypeBox schema (`validateParameters`, `orchestrator/utils.ts:71`); executes leaf tools in-process, appending assistant + `ToolResultMessage` entries to `orchestrator.log`; frontend-bridged tools throw `UserInputException` after a `pending` event — the exact pause semantics used in production. A server tool that throws a *real* error becomes an `isError: true` tool result (recoverable), not a pause.
- `getPendingToolCalls()` (`orchestrator.ts:88`) and `resume(completed)` (`orchestrator.ts:257`) are log-driven; reconstruction from a saved log is a first-class operation (`reconstructAgent`, `orchestrator.ts:508`). `run()`/`resume()` are single-use per instance — so we reconstruct a fresh orchestrator per remote request.
- `lib/chat/tool-inspector.server.ts:64` (`executeRegisteredTool`) already proves standalone in-process leaf-tool execution, but discards log entries and rejects bridged tools — we reuse its structure, not the function.
- Registries: `REGISTRABLES` / `HEADLESS_REGISTRABLES` + swap tables (`orchestration-core.server.ts:106-223`). The swap pattern (`ReadFiles → ServerReadFiles` for headless) is exactly how a remote session decides per-tool "in-process vs bridge".
- Toolsets are declared per agent: `WebAnalystAgent.tools` (`agents/web-analyst/web-analyst.ts:52`) is the 14-schema list we expose. `GET /api/tools/schema` is admin-only and dumps *all* registrables including agents — not suitable; the skill doc serves a filtered per-session list instead.
- Server tools need a **full `RemoteAnalystContext`** (`effectiveUser`, `connections`, `whitelistedTables`, `resolvedContextDocs`, `schema`, `homeFolder`, …) as built in `setupOrchestration` (`orchestration-core.server.ts:505`); a minimal `{effectiveUser}` breaks `ExecuteQuery`/`SearchDBSchema` in production mode.
- Completed tool result content is a unified `(TextContent | ImageContent)[]` — text blocks plus image blocks (`url` or `{data, mimeType}` base64) — for both server-executed and browser-bridged tools (`legacyToolResultToPi` / `toolResultContentToPi`, `lib/chat-translator/index.ts:478,502`).

### 3.3 Frontend chat UI & browser tool execution
- SSE client: `store/conversation-stream-client.ts` — `runV3Turn` (line 224) always **POSTs `/turns` first**, then tails via XHR (`readStreamOnce`, not exported). **There is no passive "observe an externally-driven turn" mode in the browser today** — this is the #1 frontend work item.
- Browser tool execution: `store/chatListener.ts` — on `paused`, pending calls are derived from the reloaded durable log (`derivePendingToolCalls`) and dispatched into Redux; the auto-exec listener (`chatListener.ts:489`) executes them via `executeToolCall` (`lib/tools/tool-handlers.ts:64`, handlers in `lib/tools/handlers/*`), then the `completeToolCall` listener (`chatListener.ts:438`) POSTs `completedToolCalls` back to `/turns`. Both listeners guard on `executionState === 'EXECUTING'`.
- **The UI freeze cannot key off `RunStatus`** — that type never reaches the client `Conversation` object; the UI reads `executionState` (`store/chatSlice.ts:90`). Freeze requires a new Redux flag + gates at `ChatInterface.tsx:363` (`isAgentRunning`), `ChatInput.tsx:173` (`chatLocked` — must hard-freeze, ignoring `allowChatQueue`), and the banner render site (`ChatInterface.tsx:1079`).
- Stop: `interruptChat` (`chatListener.ts:615`) aborts locally *and* POSTs `/api/conversations/[id]/interrupt` — the server half works even when this tab didn't start the turn.
- Message rendering needs **no** turn structure in detailed mode: `SimpleChatMessage` → `ToolCallDisplay` renders rows independently keyed on `tool_call_id` (`SimpleChatMessage.tsx:300`). Remote entries render as-is once in Redux.
- Chart images on demand: `renderFileChartImageBlocks` (`lib/tools/handlers/chart-images.ts:16`) → off-screen ECharts render (`lib/chart/ChartImageRenderer.client.ts:117`) → `uploadChartOrEmbed` (presigned PUT, or base64 sentinel under `USE_BASE64_UPLOADS`). Already invoked by the `ReadFiles`/`EditFile` handlers — callable outside message-send.
- "Copy to Agent" button slot: `ChatHeaderBar.tsx` already has a "Copy link" button (`LuShare2`, lines 208-225) — natural sibling.

### 3.4 Tokens, sharing, object store, auth
- `/s/` is **unused** (stories share via `/l/[shareId]`). No route conflicts.
- Proven token patterns: revocable random nonce + DB lookup (`lib/auth/share-tokens.ts`, `crypto.randomBytes(12)` → base36, stored on file `meta.shares[]`, GIN-indexed lookup) vs stateless HMAC with baked-in expiry (`lib/object-store/key-token.ts`, `timingSafeEqual`). Bearer-route template: `withCronAuth` (`lib/http/with-auth.ts:30`).
- Middleware public admit-list: `lib/middleware/create-middleware.ts:44-79` — add `/s/` (and only the exact remote API paths) mirroring `isSharePublicPath`.
- `EffectiveUser` for a background caller: `getUserEffectiveUser(email, mode)` (`lib/auth/auth-helpers.ts:123`) builds the **owner's** real user (Slack already uses this) — unlike story guests, who are folder-scoped viewers with frozen SQL (`guest-query.server.ts`); that model does *not* transfer here because the remote agent must run new SQL as the owner.
- Conversations already carry `owner_user_id` + `mode` (`postgres-schema.ts:401-467`) — exactly the scoping a session code needs — plus a `meta JSONB` column for the session record.
- Object store: `createObjectStore()` (`lib/object-store/index.ts:68`) → `S3Adapter` (absolute public URLs) or `LocalFsAdapter` (**`/api/object-store/serve/<key>` — relative and auth-gated, NOT externally fetchable**; documented in `local-fs-adapter.ts:16-21`). Base64 image blocks are supported end-to-end (`AgentAttachment`, `agents/analyst/types.ts:59`; `normalizeAttachments`, `lib/chat/attachments.server.ts:15`).

---

## 4. Data model & contracts

### 4.1 Session record and code

The code is `<conversationIdBase36>-<nonce>` (nonce = `crypto.randomBytes(16)` → base36, mirroring `share-tokens.ts` but longer). The id part makes lookup O(1) without a new index; the nonce is the only secret. Only a **hash** of the nonce is stored (a DB leak must not leak live capability URLs).

```ts
// lib/data/remote-sessions.types.ts  (new)

/** Stored under conversations.meta.remoteSession */
export interface RemoteSessionRecord {
  nonceHash: string;        // sha256(nonce), hex — compared via timingSafeEqual
  createdAt: string;        // ISO
  expiresAt: string;        // ISO — hard TTL (default 4h, REMOTE_SESSION_TTL_MS)
  lastActivityAt: string;   // ISO — bumped on every authenticated remote request
  revoked?: true;           // set by Stop / re-mint; soft revoke like ShareRecord
  createdBy: number;        // userId that minted (== conversation.ownerUserId)
  toolset: string;          // e.g. 'web-analyst' — names the exposed leaf-tool list
}

export type RemoteSessionDenial =
  | 'not_found' | 'revoked' | 'expired' | 'idle_expired' | 'conversation_busy';
```

**Liveness rule** (no heartbeats — see §5.4): a session is live iff `!revoked && now < expiresAt && now - lastActivityAt < REMOTE_SESSION_IDLE_MS` (default 30 min). `runStatus: 'remote'` is set on mint and cleared (→ `'idle'`) on stop/expiry.

### 4.2 New `RunStatus` value

```ts
// lib/data/conversations.types.ts
export type RunStatus = 'idle' | 'running' | 'paused' | 'error' | 'remote';
```

`run_status` is a plain TEXT column (verify no CHECK constraint in migrations before shipping). Threading sites — each gets explicit handling, enumerated in §8 blocker B6.

### 4.3 HTTP contracts

All `/s/<code>` endpoints are public in middleware and authenticated **solely by the code** via a new `withRemoteSessionAuth` wrapper (modeled on `withCronAuth`): decode code → load conversation → `timingSafeEqual(sha256(nonce), record.nonceHash)` → liveness check → build owner `EffectiveUser` from `conversation.ownerUserId` + `conversation.mode` (via the same machinery as `getUserEffectiveUser`) → bump `lastActivityAt`. Failures return 404 (uniformly — don't distinguish revoked/expired/missing to a token guesser; the *skill doc* endpoint may be friendlier since the agent legitimately needs to know the session ended).

```
GET  /s/<code>                     → 200 text/markdown   (the skill document, §6)
POST /s/<code>/tool                → tool call
GET  /s/<code>/result/<toolCallId> → poll a pending result
GET  /s/<code>/context             → 200 JSON            (current session context snapshot)
POST /s/<code>/end                 → agent-initiated polite end (== revoke)
```

```ts
// POST /s/<code>/tool — request
interface RemoteToolCallRequest {
  tool: string;                          // must be in the session's leaf-tool allowlist
  args: Record<string, unknown>;         // validated against the tool's TypeBox schema
  callId?: string;                       // optional idempotency key supplied by the agent
}

// Content blocks are the orchestrator's own (TextContent | ImageContent)[],
// serialized with the image policy of §7.
type RemoteContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; url: string }                       // publicly fetchable (S3/CDN)
  | { type: 'image'; data: string; mimeType: string };   // base64 (local deployments)

// POST /s/<code>/tool — responses
// 200: completed within the long-poll window (~55s)
interface RemoteToolCallCompleted {
  status: 'completed';
  toolCallId: string;
  isError: boolean;                      // tool-level failure (agent can read and recover)
  content: RemoteContentBlock[];
}
// 202: still executing in the user's browser — poll GET /s/<code>/result/<toolCallId>
interface RemoteToolCallPending {
  status: 'pending';
  toolCallId: string;
  pollAfterMs: number;                   // suggested poll interval
}
// 4xx errors (protocol-level, distinct from isError):
//   400 unknown tool / args failed schema validation (body: { error, validationErrors? })
//   404 session not found/revoked/expired
//   409 another remote call is in flight (one call at a time), or the browser
//       resumed a normal turn — body: { error: 'busy', detail }
//   (pending past the browser timeout → 202 with browserMaybeUnreachable: true — advisory
//    only; a pending user confirmation is never force-closed. See §8 B10.)
```

```ts
// GET /s/<code>/context — what the agent can ask for orientation
interface RemoteSessionContext {
  conversationId: number;
  mode: string;
  agentName: string;
  currentPage?: { fileId?: number; fileType?: string; path?: string }; // last known app state
  connections: { name: string; dialect: string }[];
  toolNames: string[];
}
```

### 4.4 Mint / stop (owner-authenticated, normal session auth)

```
POST   /api/conversations/[id]/remote-session   → mint (revokes any prior code),
                                                  sets runStatus='remote',
                                                  returns { url, code, expiresAt, copyText }
DELETE /api/conversations/[id]/remote-session   → revoke + release runStatus → 'idle'
GET    /api/conversations/[id]/remote-session   → current session status (for UI banner)
```

`copyText` is the exact clipboard payload, e.g.:
> `Fetch https://app.minusx.ai/s/k3x9-a8f2m1... and follow its instructions to operate my MinusX session.`

**Mint guard: minting requires `runStatus === 'idle'`.** `running` → 409 "finish or stop the current turn first"; `paused` → 409 "pending tool calls must resolve first"; `error` → allowed after the error is acknowledged (it releases to `idle`); already `remote` → re-mint (revokes the prior code, §9.4 E10). This is one half of the mutual-exclusion invariant; see §9.4 for the full matrix.

---

## 5. Server mechanics

### 5.1 The remote turn: session start

On mint, in addition to flipping `runStatus`, we append a **root invocation** entry to the conversation log (exactly what `Orchestrator.run()` does at `orchestrator.ts:218`): an `AgentInvocation` for the session's root agent (name e.g. `RemoteAgentSession`, `parent_id: null`, `arguments: { source: 'remote-agent' }`, context built as in §5.2). This gives every subsequent remote tool call a valid `parent_id`, keeps the log shape invariants intact (a later *normal* turn on the same conversation must still `loadLog` cleanly), and gives the UI a turn boundary to render ("Remote agent session started").

### 5.2 Per-request execution (stateless)

Each `POST /s/<code>/tool`:

1. **Auth + liveness** (§4.3), bump `lastActivityAt`.
2. **Single-flight guard**: reject 409 if the log has an unresolved remote tool call (same predicate as `derivePendingToolCalls`), unless it's the `callId`-idempotent retry of that very call (then behave like the poll endpoint).
3. **Build context**: construct the full `RemoteAnalystContext` the same way `setupOrchestration` does (`orchestration-core.server.ts:505`) — owner `EffectiveUser`, connections, whitelisted tables, resolved context docs, home folder. **Refactor note:** extract this from `setupOrchestration` into a shared `buildAgentContext(user, conversation, agentArgs)` so both paths use one implementation (it's currently inlined against `ChatRequest`).
4. **Reconstruct** a fresh `Orchestrator(REMOTE_REGISTRABLES, savedLog)` (the engine is single-use; the log is the state). `REMOTE_REGISTRABLES` = `REGISTRABLES` filtered to **leaf tools only** (`static type !== 'Agent'` — dispatching a registered agent name would trigger a nested LLM run; see §8 B8), **minus `ClarifyFrontend`** (§12), with the same swap-table mechanism as `HEADLESS_TOOL_SWAPS` available for future per-tool policy (headless variants, §12).
5. **Validate & dispatch**: check `tool` against the session toolset; synthesize an `AssistantMessage` whose `content` is a single `toolCall` block (`id` = fresh uuid or the supplied `callId`; provider/model fields stamped `provider: 'remote-agent'`, `model: session code's toolset`, zero usage — these fields are display/accounting metadata, nothing dereferences them for control flow); call `orchestrator.dispatch(assistantMsg, rootAgent)` where `rootAgent` is reconstructed from the §5.1 invocation via `reconstructAgent`.
6. **Commit + notify**: append the new log entries (diff of `orchestrator.log` past the saved length — same pattern as `commitNew` in `conversation-turn.server.ts:206`) via `appendMessages`, then `notifyMessage`. `ConcurrentAppendError` → 409 (another writer won; the lease/status should prevent this, OCC is the backstop).
7. **Server tool** → `dispatch` returned with the `ToolResultMessage` already in the log → serialize its content (§7) → **200 completed**.
8. **Frontend-bridged tool** → `dispatch` threw `UserInputException` → the pending tool call is in the committed log; the browser's observer (§9) picks it up off the stream and executes it. The handler now **waits** (§5.3). Result within the window → 200; else → **202 pending**.
9. **Error mirroring**: real tool errors already become `isError` tool results in the log (dispatch semantics); protocol-level failures append a `kind:'error'` row (`appendError`) so the UI error stream stays truthful, mirroring `mirrorErrors` in the turn runner.
10. **Metering**: publish an app-event (`AppEvents.REMOTE_TOOL_CALL` — new) via `appEventRegistry` with tool name, duration, isError. The per-LLM-call credit gate (`beforeLlmCall`) never fires in a remote session — LLM costs are the *external* agent's; our metering is for audit/rate-limiting (see §8 B9).

### 5.3 The waiter (frontend tool completions)

```
subscribe(conversationId, wake)            // BEFORE checking, so no lost-notify window
check := loadMessages(conversationId, sinceSeq) has toolResult with toolCallId === X
loop: check() now; on each 'message' notify → check(); every 5s → check()   // NOTIFY is lossy
resolve on found; timeout at ~55s → respond 202 { status:'pending', toolCallId }
finally: unsubscribe
```

`GET /s/<code>/result/<toolCallId>` runs the same predicate once (plus a short optional wait), so agents that can't hold connections still converge. Works cross-process on Postgres (any instance can serve the poll); on PGLite everything is one process anyway.

**How the completion lands in the log**: the browser posts `completedToolCalls` to the *existing* `POST /api/conversations/[id]/turns` (unchanged client code path). The route gains a short-circuit: **when `runStatus === 'remote'`, map the tuples through `legacyToolResultToPi`, append the `ToolResultMessage` rows + `notifyMessage`, and return — do NOT invoke `runConversationTurn`/`orchestrator.resume`** (which would re-enter the LLM loop; §8 B4). This keeps `chatListener`'s resume cycle byte-identical on the client.

**Completion dedupe (first write wins):** before appending, the short-circuit drops any tuple whose `toolCallId` already has a `toolResult` in the log (same predicate as `derivePendingToolCalls`, inverted) and returns `{ ok: true, deduped: [...] }`. This makes completions idempotent against multi-tab double-execution (§9.4 E7) and client retries.

### 5.4 Lease & liveness (why there are no heartbeats)

The existing lease heartbeat lives inside `runConversationTurn`'s `setInterval` — there is no standalone lease holder, and pinning one to a process (`INSTANCE_ID = pid-…`) breaks multi-instance Postgres. Instead, `'remote'` is **not** a heartbeat-bearing status:

- `isRunLeaseStale` continues to consider only `'running'` — a remote session is never "stale-running".
- Remote liveness is data-driven: `expiresAt` / `lastActivityAt` on the session record (§4.1). Any reader (stream route, turns route, remote endpoints, the UI status endpoint) that observes an expired record performs a lazy release: clear `runStatus → 'idle'`, mark `revoked`, `notifyStatus('idle')`. No background reaper needed.
- During a remote tool call's actual execution we are inside one HTTP request — no long-lived lease required. `run_started_seq` is set once at mint (the session's rollback-anchor semantics don't apply — auto-retry never runs for remote sessions) and never overwritten mid-session.

### 5.5 Interrupt / stop

`DELETE …/remote-session` (user's Stop button) and `POST /s/<code>/end` (agent's polite end) both: mark `revoked`, set `runStatus → 'idle'`, **append an `isError` toolResult ("session ended") for any still-unresolved remote tool call** (the log must never be left with an unanswered call — a later normal turn must load cleanly), `notifyStatus('idle')`, and `notifyInterrupt` (wakes any in-flight waiter, which responds 404-gone to the agent). `interruptRun` (`conversations.server.ts:276`) gains a `'remote'` arm so the generic interrupt route also clears remote sessions. Lazy expiry (§5.4) runs the same cleanup.

---

## 6. The skill document (`GET /s/<code>`)

Returned as `text/markdown` (agents fetch and read it; humans can too). Assembled per-request from live data — never cached, so a revoked session immediately serves a "this session has ended" page instead. Contents:

1. **What this is** — one paragraph: "You are operating a live MinusX analytics session on behalf of its owner. Actions you take are visible to the user in real time and are logged."
2. **Session context** — conversation id, mode, connection names/dialects, current page/file if known (same data as `/s/<code>/context`).
3. **Protocol** — the §4.3 contract, with concrete `curl` examples for a server tool (`ExecuteQuery`) and a frontend tool (`EditFile`, showing the 202→poll flow). Explicit guidance: one call at a time; treat `isError: true` as a recoverable tool failure; call `POST /s/<code>/end` when finished.
4. **Tool schemas** — the session toolset (`WebAnalystAgent.tools` filtered to leaf tools), each as `name` + `description` + JSON-Schema `parameters` (TypeBox schemas are plain JSON Schema; descriptions like `EditFile`'s ~2 KB markup guide come along and are exactly what the agent needs).
5. **Skill/markup pointers** — the per-file-type markup docs the tool descriptions reference (`skill_questions`, `skill_dashboards`, …) inlined or linked as additional fetchable sections, so the agent can author file markup correctly.
6. **MCP alternative (later phase)** — a line noting `claude mcp add --transport http <host>/s/<code>/mcp` once the MCP adapter ships (§12).

---

## 7. Rich outputs: image & result semantics

**Principle: reuse the existing attachment semantics** — tool results are already `(TextContent | ImageContent)[]` where images are `{url}` or `{data, mimeType}` — and apply the same configuration-dependent policy the app already uses for uploads (`USE_BASE64_UPLOADS`, `isLocalObjectStore()`):

| Deployment | Chart/image produced by a tool | What the external agent receives |
|---|---|---|
| Hosted / S3 configured | uploaded via presigned PUT → absolute public URL | `{ type:'image', url }` (fetchable) |
| Open-source / local FS | `publicUrl` is `/api/object-store/serve/<key>` — relative **and auth-gated**, unreachable externally | `{ type:'image', data, mimeType }` — the serializer detects a non-absolute or serve-route URL and inlines it as base64 by reading the blob server-side (`ObjectStore.get(key)`) |
| `USE_BASE64_UPLOADS=true` | already a `data:` URL end-to-end | base64 block, passed through |

The serializer is one pure function (`serializeRemoteContent(blocks): RemoteContentBlock[]`) used by both the tool endpoint and the poll endpoint. `data:` URLs inside `image_url`-style blocks are split into `{data, mimeType}` exactly as `imageContentFromUrl` does today. Row-data results (`ExecuteQuery`) are text blocks (JSONL/markdown table) unchanged — same as what our own LLM sees. Server-side `ExecuteQuery` can already render a viz JPEG (`_renderVizJpeg`, `db-tools.server.ts:96`); Phase 4 adds a browser-side `RenderChartImage` frontend tool reusing `renderFileChartImageBlocks` for live-state charts.

---

## 8. Blockers found & their resolutions

| # | Blocker (with source) | Resolution |
|---|---|---|
| B1 | **Lease heartbeat is welded to `runConversationTurn`'s lifetime**; no standalone lease holder; `INSTANCE_ID` pins to a pid — broken for a session spanning many requests and for multi-instance Postgres | Don't hold a heartbeat lease at all. `'remote'` is a non-heartbeat status; liveness = `expiresAt`/`lastActivityAt` with lazy release (§5.4). Fully stateless per request. |
| B2 | **Orchestrator is single-use** (`run`/`resume` guarded by `this.used`); can't keep one instance across round-trips | Reconstruct from the durable log per request (`new Orchestrator(registry, savedLog)` + `reconstructAgent`) — reconstruction is already a first-class, log-driven operation. |
| B3 | **Log shape invariants**: entries need valid `parent_id`; pending-derivation requires tool calls to live inside an assistant message; malformed hand-appended rows corrupt later normal turns (`resume` throws `no parent_id found`) | Append a proper root invocation at session start (§5.1) and only ever add entries *through* `dispatch` (which builds well-formed assistant + toolResult entries). Never hand-write raw rows. |
| B4 | **The existing completion path re-enters the LLM**: `completedToolCalls` → `setupOrchestration` → `orchestrator.resume` → paused agent's `run()` loop | Turns-route short-circuit: `runStatus === 'remote'` ⇒ append toolResult rows + notify, return without invoking the orchestrator (§5.3). Client resume path untouched. |
| B5 | **No passive stream observer in the browser**: `runV3Turn` always POSTs `/turns` first; `readStreamOnce` unexported; nothing tails an externally-driven turn | New `observeConversation(...)` client mode (§9.1) — the #1 frontend work item. |
| B6 | **`RunStatus` handling is hard-coded in ~6 places** | Thread `'remote'` explicitly: type union (`conversations.types.ts:17`); turns-route guard (`turns/route.ts:51` — block `userMessage`/`autoRetry` turns, allow the B4 short-circuit); stream route (`stream/route.ts:106-142` — treat `'remote'` like `running` for tailing, but stale-check via session record, not lease heartbeat); `isRunLeaseStale` (unchanged — excludes remote by design); `interruptRun` (`conversations.server.ts:276` — add remote arm); turn settle (unreachable for remote — assert). Check for a DB CHECK constraint on `run_status` before shipping. |
| B7 | **Local object-store URLs aren't public** (`local-fs-adapter.ts:16-21`) — external agent can't fetch chart images in open-source deployments | Base64 inlining in the result serializer (§7). Base64 image blocks are already supported end-to-end. No new public serve route needed. |
| B8 | **Agents live in the same registry as tools**; dispatching e.g. `WebAnalystAgent` by name would silently run a nested LLM loop on our credits | `REMOTE_REGISTRABLES` filters to `static type !== 'Agent'`; the endpoint additionally validates against the session's explicit tool allowlist. |
| B9 | **Credit/metering gap**: `beforeLlmCall` only meters LLM calls, which don't happen in remote sessions | LLM cost is genuinely external. Add tool-call metering via `appEventRegistry` (new `AppEvents.REMOTE_TOOL_CALL`) + a simple per-session rate limit (e.g. 60 calls/min) in the auth wrapper. |
| B10 | **Browser tab closed mid-session** ⇒ frontend-bridged tools never complete | *(Revised after browser verification — a pending USER CONFIRMATION can legitimately wait minutes, so polls must never force-close.)* Long-poll times out → 202; past `~90 s` the 202 carries `browserMaybeUnreachable: true` (advisory — agent tells its user to open the app). The stale call is actually closed (isError "superseded") only when the agent issues its NEXT tool call, or at session end — so the log never wedges and single-flight unwedges exactly when the agent moves on. `ReadFiles` could swap to `ServerReadFiles` headlessly, but v1 keeps semantics uniform: remote sessions assume a live browser. |
| B11 | **UI freeze can't key off `RunStatus`** — never reaches the client `Conversation`; UI reads `executionState` | New `remoteSession` flag in `chatSlice` + hard-freeze gates (§9.2). |
| B12 | **`/api/tools/schema` is admin-only and dumps everything** incl. agents | Not reused. The skill doc serves the filtered per-session toolset (§6). |
| B13 | **Race: remote agent vs. local tab both POST `/turns`** (tab resumes frontend tools while agent issues calls) | Single-flight guard (§5.2 step 2) + OCC on `appendMessages` (`ConcurrentAppendError` → 409) + the B6 turns-route guard blocking user-message turns while `'remote'`. The tab only ever POSTs *completions*, which the short-circuit handles append-only. |

No blocker is unresolved; none require schema migrations beyond using the existing `conversations.meta` JSONB (no new tables in v1).

---

## 9. Frontend changes

### 9.1 Observer mode (new)
`observeConversation(conversationId, sinceSeq, signal, cb)` in `conversation-stream-client.ts`: opens `GET …/stream?since=…` **without** the initiating POST (export/reuse `readStreamOnce` + the existing reconnect/backoff), and a `chatListener` effect that starts observing when a conversation enters remote mode (from the mint response, or from `ConversationsAPI.get` showing `runStatus === 'remote'` on load — covers refresh/second tab). It mirrors `runV3TurnInListener`'s dispatches: `addStreamingMessage` on message events, `loadConversation` on settle, and — critically — on a pending frontend tool: `updateConversation` with derived `pending_tool_calls` **and `executionState: 'EXECUTING'`**, because the auto-exec (`chatListener.ts:489`) and resume (`chatListener.ts:438`) listeners both guard on `EXECUTING`. From there, browser execution and the `completedToolCalls` POST are the existing code, byte-identical (the server short-circuit B4 makes that POST append-only).

### 9.2 Freeze UX
- `chatSlice`: add `remoteSession?: { active: boolean; expiresAt?: string }` to `Conversation`; actions `startRemoteSession` / `endRemoteSession`.
- `ChatInput.tsx:173`: `chatLocked = remoteActive || (isAgentRunning && !allowChatQueue)` — remote is a **hard** lock (no queueing), placeholder: "Remote agent connected — input disabled".
- Banner replacing/augmenting `ThinkingIndicator` at `ChatInterface.tsx:1079`: "🔗 Remote agent session active · expires <t>" + **Stop** button → `DELETE …/remote-session` + `interruptChat` (the server half of `interruptChat` already works for turns this tab didn't start). On `status: 'idle'` from the stream (session ended anywhere), clear the flag.
- **Copy to Agent** button in `ChatHeaderBar.tsx` next to the existing Copy-link button (`aria-label="Copy to agent"`): POST mint → `navigator.clipboard.writeText(copyText)` → dispatch `startRemoteSession` → toast. Per product decision, copying is what starts the session and freezes input.

### 9.3 Rendering
Detailed view renders remote tool calls with zero changes (`SimpleChatMessage`/`ToolCallDisplay` are row-independent). The grouped view's `groupIntoTurns` treats the §5.1 root invocation as a turn boundary; a small labeled header ("Remote agent") on that turn group is a Phase-3 polish item.

### 9.4 Session exclusivity & UX edge-case matrix

**The invariant: a conversation is driven by exactly one decider at a time — MinusX's LLM (`running`/`paused`) or the external agent (`remote`) — and switching is always an explicit, user-visible transition.** Enforced at three layers: the mint guard (§4.4, can't enter `remote` unless `idle`), the turns-route guard (while `remote`, `userMessage`/`autoRetry`/`manualRetry` turns are rejected 409 — only the append-only completion short-circuit is allowed), and the hard UI freeze (§9.2). Switching *back* always means ending the remote session: Stop (or agent `/end`, or expiry) → `idle` → input unfreezes. There is no "pause the agent, chat a bit, hand back" in v1.

| # | Edge case | Behavior (and where it's enforced) |
|---|---|---|
| E1 | **User types while remote active** | Input hard-frozen client-side (§9.2; no queueing — `allowChatQueue` ignored). Defense-in-depth: turns route rejects `userMessage` with 409 while `remote`, so a stale tab can't start an LLM turn either. |
| E2 | **User clicks Stop mid-remote-tool-call** | DELETE revokes + `runStatus → 'idle'` + `notifyInterrupt`. The in-flight waiter wakes and returns 404-gone to the agent. If a frontend-bridged call is pending unexecuted, the revoke path appends an `isError` toolResult ("session ended") so the log is never left with an unanswered call (§5.5) — a later normal turn loads cleanly. Input unfreezes on the `idle` status event. |
| E3 | **User tries to send a *new* chat message right after Stop** | Allowed — `idle` is the normal entry state. The remote agent's next call gets 404; nothing races because the turns-route guard and mint guard are status-checked transactionally against the conversation row. |
| E4 | **Mint attempted while agent is running/paused** | 409 per the mint guard (§4.4). The Copy-to-Agent button is also disabled in the UI while `executionState` is `WAITING/STREAMING/EXECUTING` — the server guard is the source of truth, the disabled button is UX. |
| E5 | **User closes the tab mid-session** | Server tools keep working (no browser needed). A frontend-bridged call stays pending with the `browserMaybeUnreachable` hint (§8 B10); the session stays live until idle/TTL expiry, so reopening the tab reattaches the observer (E6) — the still-pending call then executes; if the agent already moved on, its next call superseded it. |
| E6 | **Page refresh / navigating between pages mid-session** | On conversation load, `runStatus === 'remote'` (from `ConversationsAPI.get`) re-dispatches `startRemoteSession` and re-attaches the observer — freeze, banner, and bridged-tool execution survive refresh and navigation. The observer resumes from its seq cursor; missed rows replay. |
| E7 | **Two tabs open on the same conversation** | Both observe and both may auto-execute a pending frontend tool. Harmless-but-wasteful duplicate execution; correctness is guaranteed by the server-side completion dedupe (first `toolCallId` write wins, §5.3). Documented as accepted v1 behavior; a tab-election refinement is possible later if duplicate `EditFile` executions prove annoying (they operate on the same Redux state, so results are identical). |
| E8 | **Session expires (TTL or idle) while user is away** | Lazy release on next touch (§5.4): any reader flips `idle`, notifies; the banner clears and input unfreezes when the tab next receives the status event. The agent's next call gets 404; the skill doc tells it what that means. |
| E9 | **Agent calls after user stopped / session expired** | Uniform 404 (§4.3). The skill-doc URL itself also flips to a "session ended" page, so a confused agent that re-fetches its instructions learns the state. |
| E10 | **Re-mint (Copy to Agent clicked again)** | Revokes the prior code, mints a fresh one, stays `remote`. Old link dies instantly (nonceHash replaced). |
| E11 | **Conversation fork while remote** | Fork UI is disabled during `remote` (same gate as E4). Regardless, fork must **strip `meta.remoteSession`** from the copied row — the fork is a normal conversation and must never inherit a live capability hash. (Red test in Phase 1.) |
| E12 | **Crash-recovery paths (`autoRetry`)** | Auto-retry only fires for crashed `running` turns; `remote` never enters `runConversationTurn`, so retry logic is unreachable — asserted, and the turns route rejects `autoRetry` while `remote` (E1 guard). |
| E13 | **Slack / other in-process chat surfaces** | Slack drives its *own* conversations (separate rows), never a browser conversation — no interaction. If that ever changes, the mint/turns guards are status-checks on the row, so they hold for any caller. |
| E14 | **Stream route sees `remote`** | Treated like `running` for tailing (subscribe + forward), but staleness is judged by the session record (expiry), never by lease heartbeat (§5.4) — so a quiet remote session doesn't trip `failStale`. |

---

## 10. Security model

- **Capability semantics**: the URL is a bearer capability to act as the owner in one conversation. Copy UI includes a caution line ("Anyone with this link can operate your session until it expires or you stop it").
- **At rest**: only `sha256(nonce)` stored; comparison via `timingSafeEqual`. Nonce is 16 random bytes (~83 bits base36) — unguessable; uniform 404 on all auth failures at the tool endpoints.
- **Scope**: exactly one conversation; effective user is the conversation's owner in the conversation's stored `mode`; toolset is an explicit leaf-tool allowlist; no session cookie is ever minted; the middleware admit-list covers only `/s/` (everything else the code can reach goes through `withRemoteSessionAuth`).
- **Lifetime**: hard TTL (`REMOTE_SESSION_TTL_MS`, default 4 h) + idle timeout (`REMOTE_SESSION_IDLE_MS`, default 30 min) + explicit revoke (user Stop, agent `/end`, re-mint). All lazy-enforced (§5.4).
- **Rate limiting**: per-session cap in the auth wrapper (in-memory token bucket; conservative default ~60 calls/min).
- **Audit**: every action is a durable conversation-log row rendered in the UI in real time — the session is fully replayable. Plus `AppEvents.REMOTE_TOOL_CALL` for analytics/alerting.
- **Blast-radius notes**: `ExecuteQuery` runs as the owner against whitelisted connections — same power the owner's own chat has, no escalation. `mode` is pinned from the conversation row, so a tutorial-mode session can't write to org. `Navigate`/`Screenshot` act on the owner's own browser tab, which the owner is watching.

---

## 11. Implementation plan (TDD, per CLAUDE.md — contracts → red tests → green → validate → browser-verify)

### Phase 1 — Sessions & skill doc (server foundation) ✅ (PR #583)
- [x] **Contracts**: `lib/data/remote-sessions.types.ts` (§4.1), `RunStatus` union extension, HTTP types (§4.3); verified: no DB CHECK constraint on `run_status` (plain TEXT).
- [x] **Red tests** (`node` project): `lib/data/__tests__/remote-sessions.unit.test.ts` (codec/hash/liveness, 10 tests) + `app/api/conversations/[id]/__tests__/remote-session-routes.test.ts` (mint/stop/status/skill-doc/fork/lazy-expiry, 10 tests) — confirmed red before implementing, green after. Note: a RE-MINTED code returns the uniform 404 (its nonce no longer matches the stored hash — indistinguishable from a guess); 410 "ended" is reserved for codes that still prove session ownership (Stop/expiry).
- [x] **Implement**: `lib/data/remote-sessions.server.ts` (codec + hashed record on `conversations.meta.remoteSession`), `lib/chat/remote-session.server.ts` (mint = root `RemoteSessionAgent` invocation + context via `buildServerAgentArgs`; end = revoke + dangling-call closure + release; `resolveRemoteSession` = decode→hash-verify→liveness→owner EffectiveUser + lazy expiry release), `agents/remote-session/remote-session-agent.ts` (toolset = WebAnalyst leaf tools minus ClarifyFrontend; registered in REGISTRABLES), `lib/http/with-remote-session-auth.ts` (uniform 404 + 60/min rate limit), mint/stop/status routes, `app/s/[code]/route.ts` skill doc, middleware `/s/` admit, fork strips `meta.remoteSession`, `REMOTE_SESSION_TTL_MS`/`REMOTE_SESSION_IDLE_MS` in `lib/config.ts`. (Design note: the shared context builder is `buildServerAgentArgs` directly — no `setupOrchestration` refactor needed; its inline code is client-args unpacking that doesn't apply to remote sessions.)
- [x] Full suite green (4071 passed; one pre-existing parallelism flake in `chat-listener-inflight` passes in isolation on clean main too), `npm run validate` clean, pushed.

### Phase 2 — Remote tool execution (the engine) ✅
- [x] **Contracts**: `RemoteToolCallRequest/Completed/Pending` (+ agent-controllable `waitMs`), `serializeRemoteContent` (`lib/chat/remote-session-content.server.ts`), `REMOTE_REGISTRABLES` (leaf-only + `RemoteSessionAgent` for root reconstruction, minus `ClarifyFrontend` via the toolset allowlist). Context building reuses `buildServerAgentArgs` directly (no `setupOrchestration` refactor needed — its inline code is client-args unpacking that doesn't apply here).
- [x] **Red tests** (`lib/chat/__tests__/remote-session-engine.test.ts` + `remote-content.unit.test.ts`, 15 tests, red→green): server tool (`SearchFiles`) executes in-process with well-formed assistant+toolResult rows threaded to the session root; failing server tool (`ExecuteQuery`, bad connection) → `isError`, not a protocol error; **log-invariant regression** (normal faux-LLM turn after a remote session loads + runs + settles idle); unknown tool / agent name / `ClarifyFrontend` / non-coercible args → 400 (pre-validated — junk never touches the log); `EditFile` → 202 pending → browser `completedToolCalls` POST through the REAL turns route unblocks the poll (faux LLM never called; status stays `remote`); completion dedupe by `toolCallId`; single-flight 409; turns route rejects `userMessage`/`manualRetry` while `remote`; Stop mid-pending appends the `isError` closure + kills the code; browser-timeout closes with `browser_unreachable` (410); serializer passes public URLs, splits `data:` URLs, inlines local serve-route URLs as base64, degrades unreadable images to text.
- [x] **Implement**: engine `lib/chat/remote-session-engine.server.ts` (`executeRemoteToolCall` = reconstruct-from-log → synthesize assistant msg → `Orchestrator.dispatch` → commit diff + NOTIFY → waiter; `getRemoteToolResult`; `waitForToolResult` = subscribe-before-check + poll, NOTIFY treated as lossy; `appendRemoteToolCompletions`; `callId` idempotency), routes `app/s/[code]/{tool,result/[toolCallId],context,end}/route.ts`, turns-route guard + append-only short-circuit, interrupt-route remote arm, stream-route `'remote'` handling (tail + pending re-derive + quiet-session lazy expiry in the stale check), `isRemoteSessionLive` helper, `AppEvents.REMOTE_TOOL_CALL`, rate limit (Phase 1's wrapper).
- [x] Full suite green (4087 passed), validate clean, pushed.

### Phase 3 — Frontend (observer + freeze + button) ✅
- [x] **Red tests**: `store/__tests__/remote-session-listener.test.ts` (node — completeToolCall's remote branch POSTs completions append-only through the REAL turns route: toolResult lands, status stays `remote`, no LLM; `setRemoteSession(false)` clears freeze+pending) + `components/__tests__/remote-session-ui.ui.test.tsx` (ui — `ChatInput` hard-locks on `remoteSessionActive` even with `allowChatQueue`; banner + Stop; Copy-to-Agent mints + writes `copyText` to clipboard; button disabled while agent busy). The full observer XHR loop is jsdom-untestable by design — covered by Playwright in Phase 4 (§13.1).
- [x] **Implement**: `observeConversation` (passive GET-stream tail, infinite capped-backoff reconnect, progress-reset) in `conversation-stream-client.ts`; observer listener on `setRemoteSession` in `chatListener.ts` (streamed rendering of remote activity, pending → `updateConversation` with new-id dedupe → existing auto-exec; finalize-from-durable-log + flag clear on session end/abort); `completeToolCall` remote branch (append-only POST, no stream); `chatSlice.remoteSession` flag + `setRemoteSession` action; cold-load re-attach in `useConversation` (refresh/second tab, §9.4 E6); `RemoteSessionBanner` (Stop = DELETE + `interruptChat`); `ChatInput.remoteSessionActive` hard lock + placeholder; `ChatInterface` wiring; `ChatHeaderBar` "Copy to agent" button (`aria-label="Copy to agent"`, disabled while busy, caution toast).
- [x] Full suite green (4094 passed), validate clean, pushed.
- [x] **Manual browser-verify (§13.2) — done against the real dev server** (agent = curl; browser = real Chrome tab): Copy-to-Agent mint → banner + hard freeze; skill doc/context served with live data; `SearchFiles` in-process; `Navigate` → 202 → confirmation card in the side chat → Allow → the tab actually navigated; `EditFile` full round-trip in **2.7 s** with the draft edit visible on the file page; refresh re-attach (E6); re-mint kills the old code (E10); agent `/end` and the Stop button both unfreeze cleanly; dead code → skill doc 410 / tool 404. **Three real defects found & fixed only by browser verification** (see §11a below).

### Phase 3a — Defects found by browser verification (fixed, with regression tests)
- [x] **Remote activity didn't render**: the observer streamed only tool RESULTS; the assistant tool-call rows (and Navigate/PublishAll confirmation cards) never appeared. Fix: the observer re-renders from the durable log (debounced, serialized on a chain) on every message batch and before each pending dispatch — one source of truth, same rows a reload shows.
- [x] **Poll force-closed pending user confirmations** (the original B10 design was wrong): `Navigate` legitimately sat minutes awaiting the user's Allow; the age-based 410 closed it as `browser_unreachable` and the real completion got deduped away. Fix: **polling never force-closes** — 202 carries an advisory `browserMaybeUnreachable: true` past the browser timeout; the stale call is closed (isError, "superseded") only when the agent issues its NEXT tool call, or at session end. §4.3 contract updated accordingly (410 removed).
- [x] **Stop stamped a spurious "Interrupted by user" error**: Stop now relies on the server-side DELETE (revoke → notify idle → observer finalize), and the remote finalize clears stale client-side error banners (durable errors[] remain the truth).

### Phase 3b — Second browser-verification round: story-from-dashboard in TUTORIAL mode (user-directed)
Driven end-to-end on the real dev server: tutorial-mode Top Level Metrics dashboard → side-chat mint → external agent (curl) `ReadFiles` the dashboard → `Navigate newFileType:"story"` (user Allowed) → `EditFile` writes the full story body with live `<Question>` embeds → second `EditFile` changes the headline → `PublishAll` opens the Review modal → user approves → story saved (`/tutorial/growth-story-top-level-metrics`). Two more real defects found & fixed:
- [x] **Mode propagation**: the Copy-to-Agent / Stop fetches didn't go through `patchApiUrl`, so in tutorial mode the mint hit as org → 403 (owner/mode check correctly refused). Both now use `patchApiUrl` like every other client call.
- [x] **`PublishAllDetailCard` mis-rendered a PENDING publish as "Published successfully"** (pre-existing: unlike `NavigateDetailCard` it had no pending-user-input branch). Now renders the publish prompt / a waiting state / the real result. Reconfirmed in-browser: an unapproved-then-closed modal correctly shows "Publish failed — cancelled".
- [x] **FIXED (was "known gap"): remote approval prompts were invisible unless the session's conversation happened to be the visible side-chat conversation.** Root cause found by a second repro: the publish/navigate approval UI mounts via `UserInputComponent` inside the session conversation's rendered chat — but the agent routinely navigates the user to FILE pages whose side chat shows a different (or new) conversation, so the prompt (and the auto-opened Publish modal) never mounted; "Save All did nothing" was actually "the approval flow wasn't on screen / remounted under it". Fix: **`components/remote/RemoteSessionPrompts.tsx`** — a GLOBAL floating approval host (mounted in `LayoutWrapper`, `aria-label="Remote session prompts"`) that renders every remote-active conversation's unresolved user inputs on ANY app page, driven by the new `selectRemoteSessionPrompts` selector; the inline chat renderers (`ToolCallDisplay`, `NavigateDetailCard`, `PublishAllDetailCard`) suppress their copy while `remoteSession.active` (two mounts would stack two auto-opened Publish modals). Browser-verified end-to-end: Navigate Allow + PublishAll Review both surfaced as floating cards on the file page; Save All → prefilled Save Story dialog → Save; the agent's poll resolved `"Published 1 file successfully."`; the story persisted. (The Save Story dialog itself was never broken — it prefills name + location; it just wasn't reachable.) 3 new ui tests.
- Design note confirmed in practice: **`PublishAll` never persists anything itself** — it opens the Review modal and the USER approves; the remote agent waits on 202/poll (and correctly received `success:false "Publish cancelled"` for the close-without-save, then the user's later manual save landed).

### Phase 4 — Rich outputs, E2E, polish ✅
- [x] **Rich outputs — resolved by existing tools, no new tool needed**: `ExecuteQuery` already accepts `vizSettings` and renders a chart JPEG server-side; the frontend `ReadFiles`/`EditFile` handlers already attach live chart images. All image blocks flow through `serializeRemoteContent` (§7): public URL on S3 deployments, base64 inline on local ones. A separate `RenderChartImage` tool would duplicate `ReadFiles`' live-state rendering — dropped deliberately.
- [x] **Playwright E2E spec** `test/e2e/remote-agent-session.spec.ts` — green (~12 s): faux turn → mint via real click (mint response captured; clipboard equals `copyText`) → banner + contenteditable-off freeze → skill doc assertions → server tool 200 → **frontend `EditFile` round-trips through the real browser** (observer → auto-exec → completions POST → waiter) → user-message turn 409 while remote → Stop unfreezes with no error artifact → dead code 410/404 → normal faux turn afterwards (log invariant, end-to-end). The spec itself plays the external agent — no LLM anywhere in the remote loop.
- [x] Turn-boundary rendering: the session root's "Remote agent session" bubble + tools timeline render via the existing components (verified in the real browser); no extra grouped-view work needed.
- [x] User docs: `docs/content/docs/remote-agent-sessions.mdx` (+ nav entry).

### Phase 5 (optional / later) — MCP adapter (not started, deliberately)
- [ ] `app/s/[code]/mcp/route.ts`: streamable-HTTP MCP server over the same toolset (thin adapter over Phase-2 internals; `/api/mcp` public-prefix precedent exists). Ship only after the HTTP protocol stabilizes — the skill doc makes HTTP-only agent-friendly already.

---

## 13. Full browser E2E verification

### 13.1 Automated: Playwright spec (`test/e2e/remote-agent-session.spec.ts`)

The decisive property of this feature for E2E: **no LLM is involved anywhere** — the "external agent" is just HTTP calls, which the Playwright test itself can make via `request`/`fetch` while `page` plays the user's browser. So a single spec exercises the entire loop with fully deterministic behavior (no faux-LLM choreography needed):

1. **Mint via real clicks**: open a conversation page, click the Copy-to-Agent button (`getByLabel('Copy to agent')`), read the minted URL from the clipboard (grant `clipboard-read` permission in the Playwright context) or from the mint response.
2. **Assert the freeze**: chat input is disabled with the remote placeholder; banner visible with a Stop button (`getByLabel('Stop remote session')`).
3. **Play the agent** (test-side `fetch`): `GET /s/<code>` → assert markdown contains the toolset schemas and protocol; `GET /s/<code>/context` → assert connections present.
4. **Server tool round-trip**: `POST /s/<code>/tool` with `ExecuteQuery` against the seeded data → assert 200 `completed` with row text; assert the tool row appears in the side chat (`page` locator on the tool display).
5. **Frontend-bridged round-trip — the money test**: `POST /s/<code>/tool` with `EditFile` on the open question → the browser (via the observer + auto-exec listeners) executes it → assert the HTTP response (or 202→poll) returns the completed result, **and** assert the edit is visible in the page (Monaco content / Redux via `window.__MX_STORE__`).
6. **Edge cases in the same spec family**: second `POST` while one is in flight → 409; user message POST while remote → 409; Stop mid-pending-call → agent poll gets 404, `isError` row in log, input unfreezes; refresh mid-session → banner + freeze persist and a subsequent bridged call still round-trips (observer re-attach, §9.4 E6); after Stop, a normal faux-LLM chat turn works (proves the log invariant end-to-end in a real browser).
7. **Post-session sanity**: `GET /s/<code>` now serves the "session ended" page.

Runs under the standard `E2E_MODE` harness (store on `window.__MX_STORE__`, seeded workspace); the faux LLM channel is only needed for step 6's final normal-turn check. All element queries by `aria-label`, per house rules — the new button, banner, and Stop control must ship with labels.

### 13.2 Manual: drive it with a real agent (Phase-3 exit criterion)

1. `npm run dev`, open a question page, click **Copy to Agent**.
2. Paste the copied line into a real Claude Code session on the same machine: `Fetch http://localhost:3000/s/<code> …`.
3. Watch the agent fetch the skill doc and drive the session; verify in the browser: input frozen, each tool call rendering live in the side chat, `EditFile` visibly mutating the open question, `Screenshot`/`ReadFiles` returning current UI state to the agent.
4. Open the side-chat **debug message** view and confirm the appended log rows are exactly the synthesized assistant/toolResult entries (per CLAUDE.md's browser-verification rule: read the exact payloads, don't assume).
5. Click **Stop**; confirm the agent's next call fails cleanly, input unfreezes, and a normal chat turn on the same conversation works.
6. Repeat once against a local **prod build** (`npm run build && npm run start`) with the S3 env unset, to verify the base64 image path (§7) with a `RenderChartImage`/chart-bearing result.

---

## 12. Decisions on formerly-open questions (resolved)

- **Frozen input is fully disabled** — decided: yes, v1 has no user→agent forwarding. (If ever wanted, a long-polled `GET /s/<code>/events` is the shape — not a socket.)
- **TTL defaults** — decided: 4 h hard / 30 min idle, env-tunable (`REMOTE_SESSION_TTL_MS`, `REMOTE_SESSION_IDLE_MS` via `lib/config.ts`).
- **Multiple concurrent sessions per user** — decided: allowed across different conversations (scoping is per-conversation); never two live codes for the *same* conversation (re-mint revokes, §9.4 E10).
- **Headless remote sessions** (no browser tab) — deferred, but **all the pieces are in place by design**: `REMOTE_REGISTRABLES` is built on the same swap-table mechanism as `HEADLESS_TOOL_SWAPS` (§5.2 step 4), so a future headless mode is "apply server-variant swaps where they exist" plus dropping the 410 path; the 410 `browser_unreachable` contract (§8 B10) already gives agents a defined behavior when no tab is attached; and per-request statelessness (§5.4) means nothing else changes.
- **`ClarifyFrontend`** — decided: **excluded from the remote toolset.** The external agent has its own human channel (its terminal/chat) and should ask there; a MinusX modal popping while the side chat is frozen would be confusing double-UX, and dropping it removes the only user-input-requesting tool from the session — every bridged tool left is fully automatic in the browser, which keeps the freeze semantics clean.
