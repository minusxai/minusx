# Tests, QA, Evals — Architecture V2

> Status: **design spec** (pre-implementation). Captures the agreed design for a unified
> testing / production-QA / evals system. Implement against this; update it as decisions change.

---

## 1. Goal

One **flow-helper vocabulary** reused across three regimes, so a test, a CI e2e, and a prod
smoke-test read the same way and differ only where they genuinely must (driver, LLM, data origin).

| Regime | Runs against | LLM | Assertions | Determinism |
|---|---|---|---|---|
| **Unit / logic** | in-process (Node) | n/a | direct | high |
| **Node e2e** | in-process route handlers | **faux** | Redux `getState()` + LLM-received | high |
| **Playwright e2e (local/CI)** | real Next server (`webServer`) | **faux** (via test channel) | `window.__MX_STORE__` + LLM-received | high |
| **Playwright QA (prod)** | live deployment (`baseURL`) | **real** | `window.__MX_STORE__` | medium |
| **Evals** | live deployment | **real** | LLM-judge + Redux, N-run aggregate | low (stochastic) |

**Non-goals / rejected options:**
- ❌ A JSON DSL for flows. Logic (functions, variables, loops) lives in **TypeScript**; there is no
  interpreter to build. "Compose flows from reusable functions" = plain TS functions returning/awaiting steps.
- ❌ Vitest **browser mode** as the unifier. It serves code through Vite (no real Next server, can't
  black-box a remote origin), so it can't span CI-full-stack + remote-QA. Playwright does both.
- ❌ jsdom. The `ui` Vitest project (`*.ui.test.tsx`) is **removed**; those component-render tests move
  to Playwright (real browser + SVG DOM).

---

## 2. Runners after this change

- **`node` Vitest project** — *kept.* No DOM at all. Boots a real Redux store in Node, drives it by
  **dispatch**, routes through the **real API route handlers** (via `mock-fetch`) → real orchestrator →
  **faux LLM**. Reads state via `store.getState()`. Fast (ms). This is the LLM-boundary + Redux-chain layer.
- **`orchestrator` Vitest project** — *kept* (headless agent/tool tree).
- **Playwright** — *new.* Real browser, real SVG, real Next server. Replaces the jsdom `ui` project and
  serves local/CI e2e **and** prod QA from the **same flow files** (`baseURL` swap + faux-vs-real LLM).
- **`ui` Vitest project (jsdom)** — *removed.*

> Redux has nothing to do with the DOM. The DOM only (1) turns a click into a dispatch and (2) renders
> state to pixels. Node tests replace #1 with a direct dispatch and #2 with `getState()`. That is why
> the node layer stays and stays fast.

---

## 3. Foundations (prerequisites)

These are agreed as solved / easy; listed so implementation doesn't skip them.

1. **aria-label-only selectors.** Already the convention. Interactive controls get `aria-label`; Playwright
   locates exclusively via `getByLabel`. *Asterisk:* canvas can't be aria-labeled — see #2.
2. **SVG renderer for charts.** Switch ECharts to `renderer: 'svg'` everywhere so charts are real DOM nodes
   (`<path>`, `<text>`) — aria-labelable and structurally assertable. *Exception:* charts with thousands of
   points keep `canvas` for perf; assert those via Redux/query-result state, not the DOM.
3. **Expose the store in non-prod / e2e builds.** `window.__MX_STORE__ = store` gated behind
   `NEXT_PUBLIC_E2E` (reads only; `dispatch` mutates client state which server auth still guards).
4. **Tutorial-mode isolation + reset.** Tests run in `?mode=tutorial`, reset via the existing
   `POST /api/admin/reset-tutorial` in a `beforeAll`/`beforeEach` fixture. Tutorial seed = the test data.
   QA-on-prod is *forced* into tutorial (only isolated+resettable mode on a live deployment); local/CI uses
   tutorial too, for flow parity. (`reset-tutorial` is global-per-company → serialize runs or use per-deployment tenants.)

---

## 4. Shared flow vocabulary (`#1` — two parallel helper sets)

A **flow** = a named, reusable `{ action → verify → action → verify }` sequence. Verifies are steps *inside*
flows; flows compose into bigger flows.

```ts
// composes smaller flows, action+verify travel together
async function describeAndExpectChart(d: Driver) {
  await enterSideChatMessage(d, MSG_DESCRIBE);
  await assertRedux(d, 'chat.messages',  m => m.at(-1).role === 'assistant');
  await assertRedux(d, 'queryResults',   r => Object.keys(r).length > 0);
}
```

**Decision: two parallel helper sets, same names, no shared abstraction** (`#1` chosen over a `Driver`
interface). `flows/node.ts` and `flows/e2e.ts` expose the same function names; implementations differ only
in the bottom verb:

| Helper | node (`flows/node.ts`) | Playwright (`flows/e2e.ts`) |
|---|---|---|
| `enterSideChatMessage(d, msg)` | `store.dispatch(sendMessage(msg))` | `getByLabel('chat input').fill(msg)` + click |
| `assertRedux(d, path, pred)` | `pred(get(store.getState(), path))` | `pred(await page.evaluate(() => window.__MX_STORE__.getState()))` |
| `resetTutorial(d)` | call handler in-proc | `POST /api/admin/reset-tutorial` |

The shared **vocabulary** (same names, same Redux assertion paths, same message constants) gives ~90% of
"feels like one system" without a leaky abstraction. Promote to a `Driver` interface later *only* if real
flows duplicate verbatim.

---

## 5. Faux LLM — the switchboard matcher

The core of the design. Replaces a sequential queue with a **content-keyed matcher** so tests are robust to
prompt/schema churn.

### 5.1 The provider boundary

The orchestrator calls one function to reach the model — conceptually `askLLM(request) → response`. Mocking
the LLM = swapping *that one function*.

- **Node:** test and server share a process → set the fake directly (today's `setResponses`).
- **Playwright:** test (browser-driver process) and server are **separate processes** → bridge via a
  test-only HTTP endpoint. That gap is the only reason the Playwright wiring is more than the node wiring.

### 5.2 The matcher (shared, pure, unit-testable)

When `E2E_MODE=1` the server installs **one global** faux provider. On every call it:
1. **records** the request, and
2. **finds** the registered response whose key matches — else throws `UnexpectedError`.

Key = **`(user_message [, after])`**:
- **`user_message`** — the human text the test typed. Robust because the *test controls it*, unlike the
  system prompt / schema / app-state, which churn.
- **`after`** — the last tool executed before this call. Disambiguates **within-turn** tool-loops
  (`MSG → call#1 after:∅ → ExecuteQuery → call#2 after:'ExecuteQuery'`). Chosen over `userMessageLength`
  because user-message count is *constant within a turn* and so can't separate the loop steps; and because a
  tool *name* is robust to log-structure churn (counts aren't).

```ts
type FauxResponse = {
  userMessage: string;            // keyed against lastUserText(req)
  after?: string | string[];     // last tool name(s); omitted = first call of the turn (after ∅)
  match?: (req: LLMRequest) => boolean;  // escape hatch for anything exotic
  response: LLMResponseLike;      // fauxAssistantMessage(...) | fauxToolCall(...)
};

function findResponse(registered: FauxResponse[], req: LLMRequest): FauxResponse | undefined {
  const msg  = lastUserText(req);
  const tool = lastToolName(req);            // undefined on the first call of a turn
  return registered.find(r =>
    matchesMessage(r.userMessage, msg) &&
    matchesAfter(r.after, tool) &&
    (r.match?.(req) ?? true)
  );
}
```

`after` matching:
```ts
after: 'ExecuteQuery'                 // exact — DEFAULT and the norm; widest safety net
after: ['ExecuteQuery', 'Clarify']    // one-of — the REUSE form (one registration, many flows)
// (RegExp intentionally NOT used — arrays are explicit and don't accidentally partial-match)
```
> Exact `after` means "anything else here → error," which catches tool-choice regressions. Widen to an array
> **only** on registrations you deliberately reuse across flows; don't make fuzzy the default.

### 5.3 The two careful extractors

- **`lastUserText(req)` — the make-or-break line.** The request the model sees wraps the typed text in
  app-state blocks (and, on chart pages, image attachments). The extractor must return *just the human text
  block* (or match via `.includes(MSG)`), not the whole user turn. Get this right once; every test depends on it.
- **`lastToolName(req)`** — the most recent tool call/result in the conversation, or `undefined` at turn start.

### 5.4 Fail-loud guarantees (the property we rely on)

The matcher **never silently mis-routes**. It matches correctly or fails loud:
- **Registration time:** two responses with the same `(userMessage, after)` key → **rejected**. No silent shadowing.
- **Runtime:** no key matches → **`UnexpectedError`** naming the actual message + last tool. Also catches the
  app making an LLM call the test never anticipated (the old "error on unexpected input", now content-aware).

### 5.5 Named message constants (single source of truth)

One symbol drives *typing the message*, *registering the response*, and *keying the fake*:
```ts
// messages.ts
export const MSG_DESCRIBE = 'Describe this';
export const MSG_BARIFY   = 'Make it a bar chart';

// usage (identical in node and Playwright)
setFauxLLM([
  respondTo(MSG_DESCRIBE, fauxToolCall('ExecuteQuery', { /* args */ })),
  respondTo(MSG_DESCRIBE, fauxAssistantMessage('Done', { stopReason: 'stop' }), { after: 'ExecuteQuery' }),
  respondTo(MSG_BARIFY,   fauxAssistantMessage('Done', { stopReason: 'stop' })),
]);
await enterSideChatMessage(d, MSG_DESCRIBE);   // types AND keys off the same constant
```

### 5.6 Wiring per runner

**Node** (same process) — set the registered responses directly, read recorded requests directly.

**Playwright** (cross-process) — a **test-only route gated by `E2E_MODE`** (returns 404 otherwise):
```
POST /api/test/faux            body { responses } → register
GET  /api/test/faux/received                      → { received }   (assert what the model was sent)
POST /api/test/faux/reset                         → clear both     (beforeEach)
```
Thin Playwright helpers mirror node's vocabulary:
```ts
const setFauxLLM = (request, responses) => request.post('/api/test/faux', { data: { responses } });
async function assertLLMReceived(request, predicate) {
  const { received } = await (await request.get('/api/test/faux/received')).json();
  expect(received.some(predicate)).toBe(true);
}
```

**Adopt the matcher in node too** (replacing sequential `setResponses`), so node and Playwright share not
just helper names but identical mock semantics — the tightest form of `#1` parity, and it removes the
ordering brittleness from the existing suite.

### 5.7 Known edges (YAGNI until they appear)

- **Same tool twice in one turn** (`ExecuteQuery → ExecuteQuery`): both calls are `after:'ExecuteQuery'` →
  registration rejects the dup → add optional `nth: 2`. Don't build preemptively.
- **Same literal message across two turns**: identical keys → registration rejects → use distinct constants
  or a one-off `match` predicate.

Both surface as the **loud registration error**, never a silent mismatch.

---

## 6. Verification vocabulary

- **Redux assert** — `assertRedux(d, path, predicate)`; reads `getState()` (node) / `window.__MX_STORE__`
  (Playwright). The portable, deterministic default.
- **LLM-received assert** — `assertLLMReceived(predicate)`; reads the matcher's recorded requests. Opt-in
  per test, so prompt edits only break tests that *chose* to assert on wording.
- **Rendered-output assert** (Playwright) — SVG structure for charts; or Redux query-result state for
  canvas/large charts.
- **LLM-judge** (evals, §8) — rubric + threshold over captured output.

---

## 7. Compressing the existing node tests

Bodies today are dominated by *build-request → call-handler → parse-json → assert*. Extract flow+verify
helpers (`runQueryTest`, `runLlmTest`/`submitFaux`, `sendChat`, `expectResult`). Target ~40–60% off the
bodies; every new test ~3 lines. **Irreducible:** the per-file hoisted `vi.mock(...)` blocks — Vitest hoists
them above imports and the factory must be self-contained, so they can't be shared into a helper.

```ts
// before (~15 lines)  →  after (~3 lines)
const r = await runQueryTest({ questionId: Q.total, column: 'total', op: '=', expected: 42, mockRows: [{ total: 42 }] });
expectResult(r, { passed: true, actual: 42, expected: 42 });
```

These helpers use the **same vocabulary** as the Playwright `#1` set.

---

## 8. Evals extension

Same flows, Playwright driver, against prod (real LLM). Two things change vs QA:
- **Scorer** — a `verify` may be `type: 'redux'` (deterministic) *or* `type: 'llm-judge'` (rubric + threshold)
  over the captured final reply / query-result / chart. The chart→image pipeline (`buildChartAttachments`)
  already produces an image to feed a judge.
- **Run policy** — live LLM is stochastic, so evals run **N repetitions and aggregate** (score distribution),
  not a single pass/fail.

Keep these *pluggable* and *deliberately distinct* from CI: don't let unification collapse the determinism
gradient. CI stays faux-LLM + deterministic + fast; evals are real-LLM + judged + N-run.

---

## 9. Implementation checklist (suggested phasing)

1. **Foundations:** ECharts → SVG; `window.__MX_STORE__` behind `NEXT_PUBLIC_E2E`; confirm aria-labels on
   chat input / send / key controls.
2. **Faux matcher (shared, pure):** `findResponse`, `matchesMessage`, `matchesAfter`, `lastUserText`,
   `lastToolName`, registration-time dup rejection, `UnexpectedError`. **Unit-test the matcher itself.**
3. **Adopt matcher in node** (replace `setResponses`); compress node tests with flow+verify helpers (§7).
4. **Test-only faux channel:** `E2E_MODE`-gated `/api/test/faux*` route + the 3 Playwright helpers.
5. **Playwright setup:** `webServer` + tutorial reset fixture + faux-LLM fixture; `flows/e2e.ts` mirroring
   `flows/node.ts`; port the old jsdom `ui` tests; remove the `ui` Vitest project.
6. **QA config:** `baseURL`→prod project, real LLM (skip faux injection), tutorial mode, test admin per deployment.
7. **Evals (later):** `llm-judge` scorer + N-run aggregate policy.

---

## 10. Locked decisions (quick reference)

- Two runners: **node** (faux, dispatch, `getState`) + **Playwright** (faux local/CI, real QA). jsdom removed.
- Flows: **two parallel helper sets, same names** (`#1`), no `Driver` interface yet.
- Faux LLM: **switchboard matcher** keyed on **`(user_message [, after])`**; `after` is `string | string[]`
  (exact default, array for reuse, **no regex**); `match(req)` escape hatch.
- **Named message constants** shared by typer + mock.
- **`lastUserText()`** is the one extractor to get exactly right.
- **Fail-loud**: dup keys rejected at registration; no-match throws `UnexpectedError`.
- Tutorial mode + `reset-tutorial` everywhere for data isolation/parity.
- SVG charts for DOM-assertability; canvas only for large charts (assert via Redux).
- Evals = same flows + LLM-judge scorer + N-run policy; determinism gradient kept distinct from CI.

---

## 11. Implementation

Phased and independently shippable. Each phase has an **exit criterion** (how we know it's done) and lists
its **dependency**. Follow the repo TDD rule (red → green for new code, blue → red → blue for refactors).

> **Status (branch `feature/e2e-qa-system`, PR #437):** Phases 0–3 ✅ landed and CI-green.
> Phase 1 `4253ac0`, Phase 2 `f172d02`, Phase 0 `cb03a95`, Phase 3 `01b6cea`.
> Phases 4–6 are not started — they need browser CI infra, per-deployment test-admin credentials,
> prod URLs, GitHub Actions secrets, and an evals rubric (owner input required).

### Phase 0 — Foundations · *no dependency* ✅
- [x] Switch ECharts to `renderer: 'svg'` — `SVGRenderer` registered; renderer is `E2E_MODE ? 'svg' : 'canvas'`
      (canvas stays the **production** default to avoid an unreviewed visual/perf change — flipping to SVG
      everywhere is a one-line follow-up + per-chart canvas override for large data).
- [x] Expose `window.__MX_STORE__ = store`, gated behind `NEXT_PUBLIC_E2E` (`E2E_MODE`), via an effect.
- [x] `aria-label`s: chat input (`LexicalMentionEditor` forwards `ariaLabel`, default "Chat message input");
      send button already had `aria-label="Send message"`.
- [x] Confirmed `POST /api/admin/reset-tutorial` exists and is admin-gated (`withAuth` + `isAdmin`).
- **Exit:** ✅ charts render as SVG DOM under E2E; store readable in an `NEXT_PUBLIC_E2E` build; controls have aria-labels.

### Phase 1 — Pure faux matcher (TDD, node-only, no app wiring) · *depends on: none* ✅
- [x] `lastUserText(ctx)` extractor (the make-or-break line) + tests for app-state-wrapped + tool-loop requests.
- [x] `lastToolName(ctx)` extractor + tests (incl. `undefined` at turn start, turn-boundary scoping).
- [x] `findResponse`, `matchesMessage`, `matchesAfter` (`string | string[]`, exact default, **no regex**).
- [x] Registration-time duplicate-key rejection; `UnexpectedFauxLLMError` on no-match; `AmbiguousFauxLLMError` on >1.
- [x] `respondTo(msg, response, opts?)` constructor + `fauxMatcher` factory. (Named-constant `messages.ts` deferred
      to Phase 4 where the chat flows that consume them live.)
- **Exit:** ✅ 25 unit tests in the `orchestrator` project; never silently mis-routes (dup→reject, miss→throw, ambiguous→throw).

### Phase 2 — Adopt matcher in node + compress existing node tests · *depends on: Phase 1* ✅
- [x] `setFauxMatches` bridge over the consuming faux queue; matcher API re-exported from the pi-ai boundary module.
- [x] Extract flow+verify helpers: `runEval`, `buildQueryTest`, `buildLlmTest`, `expectResult`, `queryRows` (`test/flows/node.ts`).
      (`sendChat`/`assertRedux` deferred to the chat-flow consumers in Phase 4 — avoid unused helpers.)
- [x] Migrate `storeE2E.test.ts`: query tests compressed (~15→3 lines each); LLM tests moved to the matcher (keyed on the eval prompt).
- [x] Added an integration test driving the real orchestrator through a multi-step tool loop (`after:` disambiguation).
- **Exit:** ✅ node 1938 + orchestrator 477 green on the matcher; new tests ~3 lines; ordering-dependent faux removed from the migrated tests.

### Phase 3 — Test-only faux channel · *depends on: Phase 1* ✅
- [x] `E2E_MODE`-gated routes `/api/test/faux` (POST register), `/api/test/faux/received` (GET), `/api/test/faux/reset` (POST); 404 otherwise.
- [x] Channel applies the matcher to the chat agents' faux providers + records each request. **Note:** agents use
      *per-agent* faux providers (not one global), so the channel targets a list of chat-reachable agents
      (`web-analyst`, `analyst`, `benchmark-analyst`, `onboarding`) — append new chat agents there.
- [x] `model-config`: under `E2E_MODE`, agents resolve to faux even on a real server (explicit flag; prod invariant intact).
- [x] Serializable wire DTO (`FauxMatchDTO`) + `dtoToFauxMatch` (Playwright can't send functions over HTTP).
- [x] Playwright helpers `setFauxLLM` / `assertLLMReceived` / `resetFauxLLM` (`test/flows/e2e-faux.ts`).
- **Exit:** ✅ node test drives the **real** `/api/chat` route via a DTO, records the request, and fails loud on an unregistered call.
  (End-to-end over HTTP from a browser is exercised in Phase 4.)

### Phase 4 — Playwright harness (local/CI) + retire jsdom · *depends on: Phases 0, 3* ✅ (4a) / ⚠️ (4b)
- [x] Playwright config: `webServer` boots the app under `E2E_MODE` on an isolated port + `distDir`
      (`.next-e2e`) + PGLite dir, so it never collides with a running `next dev`.
- [x] Fixtures: faux-LLM reset per test + `resetTutorial`; auth via a `setup` project (register → dev
      `password===email` login → mark onboarding complete via `/api/configs` → storageState).
- [x] `flows/e2e.ts` mirroring `flows/node.ts` (click/type, `getState`→`window.__MX_STORE__`).
- [x] **Green flow** (`chat-flow.spec.ts`): real browser → side chat → faux reply lands in Redux + `assertLLMReceived`.
- [x] CI workflow (`.github/workflows/e2e.yml`): node + Playwright-browser caches, boots the app, runs the specs.
- [x] **`next.config`**: explicitly inline `NEXT_PUBLIC_E2E` (Turbopack dev doesn't inline ambient `NEXT_PUBLIC_*`).
- ⚠️ **Port jsdom `*.ui.test.tsx` + remove the `ui` project — NOT done; deliberately deferred.** On inventory,
      only ~24 of 145 tests are flow-shaped; ~120 are component-unit/hook tests with **no browser-E2E equivalent**,
      so a wholesale swap is coverage loss, not a port. The `ui` project is **kept**; flow-shaped tests migrate
      incrementally. Full categorization + rationale: `frontend/test/e2e/README.md`. **Owner decision needed**
      to override and delete the component/hook coverage, or accept the keep-jsdom recommendation.
- **Exit:** ✅ local Playwright e2e green (deterministic, offline: faux LLM + isolated DB); CI workflow added.
  ⚠️ `ui` project intentionally retained (see above).

### Phase 5 — Prod QA config · *depends on: Phase 4*
- [ ] Playwright project per deployment: `baseURL` → prod, real LLM (skip faux injection), tutorial mode.
- [ ] Test admin credential per deployment; serialize `reset-tutorial` (global-per-company).
- [ ] Manual `workflow_dispatch` GitHub Action running the same flow files against each `baseURL`.
- **Exit:** one button runs the shared flows against `example1.com`, `company2.example2.com`, … and reports.

### Phase 6 — Evals · *depends on: Phase 5*
- [ ] `llm-judge` scorer (rubric + threshold) over captured reply / query-result / chart image (`buildChartAttachments`).
- [ ] N-run-aggregate run policy (score distribution, not pass/fail).
- [ ] Keep CI (faux/deterministic) and evals (real/judged/N-run) deliberately separate.
- **Exit:** the same flows run as evals against prod with aggregated, judged scores.

**Phasing note:** Phases 1–2 deliver value with zero app/browser changes (better node tests immediately).
Phase 3 is the only genuinely new infra (the gated faux channel). Phases 0/1/3 can proceed in parallel;
4 → 5 → 6 are sequential.
