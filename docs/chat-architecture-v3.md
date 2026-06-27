# Chat Architecture v3 — Conversations as a First-Class Resource

> Status: **IMPLEMENTED** (PR #513). All **browser-initiated** chat runs on v3 (dedicated tables +
> LISTEN/NOTIFY streaming): Explore, side-chat, edit-and-fork, and the /view-context-size estimate.
> The 502 existing conversations were ported by the backfill migration (run locally).
>
> **v2 is intentionally retained** (not deleted) because it still backs HEADLESS conversation
> creation that the browser then views/continues:
> - **Slack** threads (`app/api/integrations/slack/events` → `runChatOrchestrationV2`, writes v2 files)
> - **Benchmark import** (`app/api/benchmark/import`)
> - the **connection wizard** onboarding agents (kept on v2 — flipping them gained nothing since the
>   above already block full deletion, and added risk to the onboarding flow)
>
> Deleting v2 (`/api/chat/*` routes, run-registry, `runChatTurnV2`/`runChatTurnStreamV2`, the v2
> chat-listener branches) is a clean follow-up that first requires migrating those headless flows to
> write the v3 store. The shared orchestration core (`setupOrchestration`, `recordLlmCalls`,
> `estimateNextChatContextV2`) stays — v3 depends on it. The browser read path is already v3-first
> (`useConversation` tries `/api/conversations/:id`, falls back to the v2 file), so a v2-file Slack
> thread still loads + continues correctly today.

---

## Manual browser test checklist

Drive the dev server; use the side-chat **Debug Info** (collapsed messages) to inspect the exact
LLM request/response per turn.

- [x] **New conversation** — open `/explore`, send a message → streams, replies, Debug Info shows the LLM call. (verified: conv 1531, "2+2 equals 4")
- [x] **Tool-using turn** — a data question runs Search/ReadFiles/ExecuteQuery and answers with file refs. (verified on 1514)
- [x] **Continue a migrated conversation** — open an old chat (now v3), send a follow-up → continues, no "legacy" banner. (verified: 1514, 8→12 rows)
- [x] **Persistence** — `GET /api/conversations/:id` shows contiguous `seq`, `runStatus:idle`, lease released after a turn. (verified)
- [x] **Backfill migration** — `POST /api/admin/migrate-conversations-v3?dry=1` then live. (verified: 502 migrated, 0 failed, ids preserved)
- [ ] **Stop** mid-turn → run halts (POST `/api/conversations/:id/interrupt`). (covered by QA `chat-flow.spec` interrupt test)
- [ ] **Reconnect** — drop the network mid-turn → the reply still lands (turn runs server-side; client resumes via `?since=`). (covered by e2e `chat-stream-reconnect.spec`)

---

## 1. Why

Today a conversation is a **file** (`type:'conversation'`) whose `content.log` holds the orchestrator's append-only pi `ConversationLog`, and live streaming is held together by an **in-memory map** (`lib/chat/run-registry.server.ts`). Both are the wrong shape:

**Conversations aren't files.** They're append-only event logs, not user-authored documents. Forcing them through the file CRUD model (save/dirty/publish/references/markup/paths) created the whole pi↔legacy translation layer we just untangled, and overloads the `files` table.

**The in-memory map is a liability.**
- It buffers every stream frame of every run for a 5-minute retention window → **unbounded memory growth / OOM risk** under load.
- It is **per-process**, so any deploy or crash drops every in-flight turn → the client falls back to file-recovery and usually just shows an error. **Bad UX.**
- It is **single-instance by construction** (its own comment says it needs "sticky sessions or an external buffer" to scale).

**v3 fixes both:** conversations get dedicated tables and a dedicated API; the durable **`messages` table becomes the single source of truth**; live streaming uses **Postgres `LISTEN/NOTIFY`** (supported on both PGLite and hosted Postgres) purely as a low-latency wakeup. The in-memory map is **retired**.

---

## 2. Goals & non-goals

**Goals**
- Conversations + messages as dedicated tables in the **same documents DB** (PGLite for OSS, Postgres for hosted).
- A minimal, reusable **`/api/conversations`** surface.
- **Resilient streaming**: a client can disconnect and reconnect — across network blips *and* server restarts — and continue exactly where it left off.
- **Idempotent resume**: a crashed turn is detected (lease/heartbeat) and re-driven without duplicating messages.
- **Greenfield**: new conversations use v3; existing file-conversations keep rendering via the legacy read path; a backfill migration comes later.

**Non-goals (for this pass)**
- Multi-instance fan-out tuning. The design is multi-instance-*ready* (NOTIFY crosses instances on hosted Postgres), but hosting is single-instance today and we don't optimize for replicas yet.
- Changing the orchestrator's internal execution model. We only change its **persistence boundary** (where it reads/writes the log).

---

## 3. Core principles

1. **The DB is the source of truth.** Every finalized pi log entry is a durable `messages` row. Nothing durable lives in process memory.
2. **NOTIFY is a wakeup, never the data.** Correctness comes from a cursor + catch-up `SELECT`; `NOTIFY` only tells listeners "there's something new, go read it." A NOTIFY lost while nobody is listening is harmless.
3. **Streaming is a resumable read, decoupled from the turn.** Producing output (running the turn) and receiving output (the SSE stream) are separate. The client always *receives* via a resumable `GET …/stream?since=<cursor>`.
4. **One transport on both backends.** `LISTEN/NOTIFY` works on PGLite (`db.listen`) and Postgres alike. No dual code path.
5. **Shared, stable IDs.** Conversation IDs live in the same global ID space as files, so they never collide and can be preserved across the later migration.

---

## 4. Schema (first)

Added to `POSTGRES_SCHEMA` (`lib/database/postgres-schema.ts`); applies to **both** PGLite and Postgres via `CREATE TABLE IF NOT EXISTS`.

### 4.1 `conversations` — one row per conversation

```sql
CREATE TABLE IF NOT EXISTS conversations (
  id              INTEGER     NOT NULL,          -- shared ID space with files (see §6)
  owner_user_id   TEXT        NOT NULL,          -- whose conversation (auth boundary)
  mode            TEXT        NOT NULL DEFAULT 'org',  -- org | tutorial | …
  title           TEXT        NOT NULL DEFAULT 'New Conversation',
  agent           TEXT        NOT NULL,          -- root agent name (e.g. 'WebAnalystAgent')

  -- Run/turn liveness — how we detect a dead server and resume idempotently (§7.3).
  run_status      TEXT        NOT NULL DEFAULT 'idle', -- idle | running | paused | error
  run_lease_owner TEXT,                           -- instance id holding the active turn
  run_heartbeat_at TIMESTAMP,                      -- bumped every few seconds while running
  run_started_seq INTEGER,                         -- message seq the active turn started at

  meta            JSONB       NOT NULL DEFAULT '{}', -- version, firstMessage, forkedFrom, benchmark cfg…
  forked_from     INTEGER,                          -- parent conversation id on OCC fork
  created_at      TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
);
CREATE INDEX IF NOT EXISTS idx_conversations_owner ON conversations(owner_user_id, mode, updated_at DESC);
```

### 4.2 `messages` — one row per pi `ConversationLog` entry (source of truth)

```sql
CREATE TABLE IF NOT EXISTS messages (
  id              BIGSERIAL   PRIMARY KEY,        -- own id space; stable FK target (feedback etc.)
  conversation_id INTEGER     NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  seq             INTEGER,                         -- 0-based, contiguous = the pi "log index" + cursor; NULL for kind='error' rows (see §4.3)

  kind            TEXT        NOT NULL,           -- 'toolCall' | 'assistant' | 'toolResult' | 'error' (denormalized for queries)
  pi_id           TEXT,                            -- the pi entry's own id (for parent threading)
  parent_pi_id    TEXT,                            -- pi parent_id; NULL for the root invocation

  content         JSONB       NOT NULL,           -- the FULL pi ConversationLogEntry, verbatim
  created_at      TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,

  UNIQUE (conversation_id, seq)                    -- enforces contiguous append + powers OCC/fork
);
CREATE INDEX IF NOT EXISTS idx_messages_conv_seq ON messages(conversation_id, seq);
```

Key point: `content` stores the pi entry **unchanged**, so orchestrator reconstruction is `SELECT content … ORDER BY seq` → the exact `ConversationLog` array it already consumes. No new message schema is invented; `seq` doubles as the log index and the stream cursor.

### 4.3 Error stream — `kind='error'` rows in `messages`

Mirrors today's `errors[]` array, but lives **in `messages`** rather than a separate table. An error is a row with `kind='error'` and **`seq = NULL`**, so it never consumes a pi-log index. The payload (`source`, `message`, `details`) lives in `content`; `parent_pi_id` ties it to a log entry.

Why this is safe: NULLs are distinct under a UNIQUE constraint, so `UNIQUE(conversation_id, seq)` still guards the pi log while permitting many `seq=NULL` error rows; `MAX(seq)` and all seq-ordered reads (`loadLog`, the stream cursor `seq > since`) ignore NULLs, so errors never leak into the reconstructed `ConversationLog` or the orchestrator's context. Reads:
- `loadLog` → `WHERE seq IS NOT NULL ORDER BY seq` (the pi log)
- `loadErrors` → `WHERE kind='error' ORDER BY created_at, id` (the error stream)

```sql
-- in the messages table (see §4.2): seq is nullable; an error row is
--   kind='error', seq=NULL, content={ source, message, details }, parent_pi_id=<tie>
CREATE INDEX IF NOT EXISTS idx_messages_errors
  ON messages(conversation_id, created_at) WHERE kind = 'error';
```

> Earlier drafts used a dedicated `conversation_errors` table; it was folded into `messages` to keep conversation data in one place. The schema self-heals existing DBs via `ALTER TABLE messages ALTER COLUMN seq DROP NOT NULL` + `DROP TABLE IF EXISTS conversation_errors`.

> **Token deltas are NOT a table.** Live "typing" deltas are ephemeral (§7.2) — streamed via NOTIFY, never persisted. Durability is at message granularity.

---

## 5. Types

```ts
// lib/conversations/types.ts  (new)
import type { ConversationLogEntry } from '@/orchestrator/types';

export type RunStatus = 'idle' | 'running' | 'paused' | 'error';

export interface Conversation {
  id: number;
  ownerUserId: string;
  mode: string;
  title: string;
  agent: string;
  runStatus: RunStatus;
  meta: ConversationMeta;        // { version: 3, firstMessage?, forkedFrom?, … }
  forkedFrom?: number;
  createdAt: string;
  updatedAt: string;
}

export interface MessageRow {
  id: number;
  conversationId: number;
  seq: number;                   // = pi log index = stream cursor
  kind: 'toolCall' | 'assistant' | 'toolResult';
  content: ConversationLogEntry; // verbatim pi entry
  createdAt: string;
}

// Rebuilding the pi log the orchestrator consumes:
//   const log: ConversationLog = rows.sort(by seq).map(r => r.content)
```

SSE event envelope (the wire format the client reads). Every event carries the cursor so reconnect is exact:

```ts
type StreamEvent =
  | { type: 'message'; seq: number; message: ConversationLogEntry }  // a committed, durable entry
  | { type: 'delta';   seq: number; text: string }                   // ephemeral token chunk for the in-flight msg
  | { type: 'pending'; seq: number; toolCalls: PendingToolCall[] }   // turn paused on a frontend tool
  | { type: 'status';  runStatus: RunStatus }                        // idle/running/paused/error transitions
  | { type: 'done';    seq: number }                                 // turn finished; cursor is final
  | { type: 'error';   error: string };
```

---

## 6. IDs (shared space, preserved across migration)

`files.id` is app-allocated as `GREATEST(MAX(id)+1, 1000)` under `pg_advisory_xact_lock` (`documents-db.ts:~101`) — used on PGLite in OSS today, so the advisory lock is safe on both backends. Conversation IDs must keep sharing that space:

- **New conversation id** = `GREATEST(MAX(files.id), MAX(conversations.id), 999) + 1`, taken under the same advisory lock. (Cleaner long-term: one global sequence both tables draw from; either works.)
- **Why:** a new conversation id never collides with a file id, and the later backfill can insert each old conversation into `conversations` with its **existing** id — so every `/explore/1514` link, `conversation_id` analytics row, etc. keeps resolving.
- **Keep them `INTEGER`.** Routes and `feedback_events.conversation_id INTEGER NOT NULL` assume ints; do **not** introduce UUIDs for new conversations.

Shared, unique IDs also make the dual-read window unambiguous (§9): resolve by id → try `conversations`, else fall back to the legacy file.

---

## 7. Streaming & resume — the core

Three layers, kept strictly separate:

| Layer | What | Durable? | Transport |
|---|---|---|---|
| **Log** | committed pi entries (`messages` rows) | ✅ yes | DB |
| **Wakeup** | "conversation N has new rows / a delta" | ❌ no | `LISTEN/NOTIFY` |
| **Live deltas** | token chunks for the in-flight message | ❌ no | `NOTIFY` (batched) |

### 7.1 Write path (the running turn)

As the orchestrator finalizes each pi entry:

1. `INSERT INTO messages (…seq = prevSeq+1…)`.
2. `NOTIFY conv_<id>, '{"seq": <N>}'` — pointer only (NOTIFY payload ≤ ~8 KB; never send content).
3. Every few seconds while running: bump `conversations.run_heartbeat_at`.

On pause (frontend tool): `run_status='paused'`. On finish: `run_status='idle'`. On failure: `run_status='error'` + a `kind='error'` row in `messages`.

### 7.2 Live token deltas

Sub-message token streaming is **ephemeral**: the producer batches chunks (~every 50 ms / N chars) and `NOTIFY conv_<id>_delta, '<chunk>'`. **Do not NOTIFY per token** — it floods Postgres and, worse, saturates PGLite's single serialized connection and starves real queries. A lost delta is harmless: the full message is committed durably, so a reconnect simply replays the committed message.

### 7.3 Read path — `GET /api/conversations/:id/stream?since=<cursor>`

```
1. Authorize: conversation.owner_user_id === effectiveUser (+ mode).   ← per-user protection
2. Catch-up:  SELECT … FROM messages WHERE conversation_id=:id AND seq > :cursor ORDER BY seq
              → emit one {message} event per row; advance local cursor.
3. Subscribe: LISTEN conv_<id>  and  LISTEN conv_<id>_delta.
4. Loop:
     • on conv_<id> NOTIFY      → SELECT rows past cursor → emit {message}; advance cursor.
     • on conv_<id>_delta NOTIFY→ emit {delta} (ephemeral).
     • on run_status → 'paused' → emit {pending}.
     • on run_status → 'idle'/'error' and cursor at end → emit {done}/{error}; close.
5. Liveness: if run_status='running' but run_heartbeat_at is stale (> TTL) → re-drive (§7.4).
```

**One shared listener connection per process** fans NOTIFYs out to the in-process set of open SSE writers (bounded by live connections, rebuildable, emptied on disconnect — *not* the durable buffer we're removing). On Postgres this also means a NOTIFY reaches every instance; on PGLite it's in-process.

> Authorization is at the **endpoint**, not the channel. Channel-per-conversation is routing, not a security boundary.

### 7.4 Crash detection & idempotent resume

`LISTEN/NOTIFY` is transport, not liveness. The **lease + heartbeat** is how we know the server died:

- Starting a turn acquires the lease: `run_status='running'`, `run_lease_owner=<instance>`, `run_heartbeat_at=now`, `run_started_seq=<len>`.
- If a stream attaches (or a new turn request arrives) and finds `run_status='running'` with a **stale** heartbeat, the lease is expired → safe to **re-drive**: rebuild the orchestrator from `messages` and resume the incomplete step.
- **Idempotency:** appends are OCC'd by `UNIQUE(conversation_id, seq)`. A re-driven step can only commit the *next* seq once; a duplicate loses the race and forks (existing behavior). The only cost of re-drive is repeating the in-flight LLM call (acceptable; nothing double-commits).
- `POST …/turns` carries a client `turn_key` (idempotency key) so a retried POST after a blip doesn't start two turns.

### 7.5 Why this is resilient (the property you want)

Because correctness lives in `messages` + cursor and not in process memory:

- **Client blip** → reconnect with last cursor → catch-up SELECT replays the gap → rejoin live. No loss.
- **Server restart mid-turn** → committed messages are durable; the new process serves the stream from the DB; the lease shows stale → re-drive finishes the turn. The frontend just reconnects and continues. **No dead UX, no OOM, no lost conversation.**

---

## 8. APIs (minimal, reusable)

Behind the existing `/api/conversations` façade. All enforce owner + mode.

| Method & path | Purpose | Notes |
|---|---|---|
| `POST /api/conversations` | Create a conversation | → `{ id }`. Allocates shared id (§6). |
| `GET /api/conversations` | List the user's conversations | owner+mode scoped, paginated. |
| `GET /api/conversations/:id` | Conversation + messages | `?since`/`?limit` for pagination of long chats. |
| `GET /api/conversations/:id/stream?since=<cursor>` | **Resumable SSE** | The only receive path (§7.3). Reconnect = same call with last cursor. |
| `POST /api/conversations/:id/turns` | Start a turn / resume | Body: `{ userMessage }` **or** `{ completedToolCalls }`, + `turnKey`. Kicks off the run; output arrives on the stream. |
| `POST /api/conversations/:id/interrupt` | Stop the active run | Cancels the lease-holding turn. |
| `DELETE /api/conversations/:id` | Delete | cascades to messages/errors. |

**Mutation vs read are split on purpose.** `POST …/turns` *causes* work and returns quickly; `GET …/stream` *receives* it and is independently resumable. That split is exactly what makes reconnect-after-restart work — the frontend's stream no longer depends on the same request (or process) that's running the turn.

---

## 9. Orchestrator persistence boundary

The only orchestrator change is **where it reads/writes the log**:

- **Load** (`setupOrchestration`): `SELECT content FROM messages WHERE conversation_id=:id ORDER BY seq` → `ConversationLog`. (Was: `file.content.log`.)
- **Append** (per finalized entry, *incrementally* — not once at turn end): `INSERT` one `messages` row at `seq=prev+1` + `NOTIFY`. Incremental commit is what makes a crash leave a consistent partial log.
- **Reconstruction** (resume/fork) is unchanged: it still rebuilds agents/tools from `V2_REGISTRABLES` by `schema.name`, threading on `parent_id`. It just gets the array from rows instead of a JSON blob.
- **Fork on conflict** maps to a `UNIQUE(conversation_id, seq)` violation → new `conversations` row with `forked_from`, seeded by copying rows `0..seq` (existing semantics).

---

## 10. What gets retired

- ❌ `lib/chat/run-registry.server.ts` (the `runs` Map, frame buffering, 5-min retention, `attach`/`resume_miss`). Replaced by DB cursor + `LISTEN/NOTIFY`.
- ❌ `tryRecoverConversationFromFile` heuristic (file-length comparison). Replaced by deterministic cursor replay.
- ❌ The pi↔legacy translation for v3 conversations (they're pi-native end to end). `piLogToLegacy` stays only for legacy file-conversations during the dual-read window.

Retained, intentionally: a **small, ephemeral** per-instance set of "currently open SSE writers" that the shared listener fans out to. It's bounded by live connections and rebuildable — not the leaky source-of-truth buffer being removed.

---

## 11. Greenfield now, migrate later

- **New conversations** → `conversations`/`messages` (`meta.version = 3`).
- **Old conversations** → keep rendering via the legacy file read path. The list endpoint UNIONs both stores; a fetch by id tries `conversations` first, falls back to the conversation file (unambiguous because IDs are globally unique, §6).
- **Backfill migration:** for each `type:'conversation'` file, insert a `conversations` row **with its existing id**, explode `content.log` into `messages` rows (`seq = index`, `content = entry`), and `errors[]` into `kind='error'` rows. Implemented as a standalone idempotent backfill (`npm run migrate-conversations-to-v3` / `POST /api/admin/migrate-conversations-v3`) — not a `MIGRATIONS` entry, since it does live cross-table writes the InitData-based framework can't express. Source files are left intact (re-runnable). Schema is self-healing via `CREATE TABLE IF NOT EXISTS` + the ALTER/DROP guards in §4.3.

Conversation-id couplings that keep working because IDs are preserved: `llm_call_events.conversation_id`, `feedback_events.conversation_id` (+ `user_message_log_index`, which a `message_id` FK can later replace), `app_events`, and `/explore/:id` URLs.

---

## 12. Phased rollout

1. **Schema + types + shared-id allocator.** Tables, `Conversation`/`MessageRow` types, the global id helper. (TDD: allocator never collides with `files`; round-trip a pi log → rows → log.)
2. **Conversations data layer + REST.** `ConversationsAPI` (client + server, mirroring the `FilesAPI` dual-impl pattern) and the CRUD/list endpoints. No streaming yet; turns run and persist to rows.
3. **Streaming via LISTEN/NOTIFY.** The resumable `GET …/stream`, the shared listener + fan-out, batched deltas, `POST …/turns`. Retire the run-registry.
4. **Crash-resume.** Lease/heartbeat + stale-lease re-drive + `turnKey` idempotency.
5. **Backfill migration** + reads DB-first; drop the file path for conversations.

Each phase: contracts → failing tests → impl → browser-verify, per the repo's TDD rule.

---

## 13. Open questions

- **Heartbeat TTL** before a lease is "stale" (balance: too short re-drives healthy slow turns; too long delays recovery). Start ~30 s heartbeat, ~90 s TTL?
- **Delta batching cadence** — 50 ms vs N-chars; tune for PGLite's single connection.
- **`message_id` for feedback** — adopt now (cleaner) or keep `conversation_id + seq` until the backfill?
- **Global id sequence vs cross-table `MAX`** — introduce a real shared sequence in phase 1, or defer?
- **Turn execution location** — keep running inside the `POST …/turns` request context (as today, detached), or move to a background worker so the turn is fully independent of any request? (Worker is the cleanest end state but out of scope here.)
