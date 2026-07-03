import { NextRequest } from 'next/server';
import { successResponse, handleApiError, ApiErrors } from '@/lib/api/api-responses';
import { withAuth } from '@/lib/api/with-auth';
import { isAdmin } from '@/lib/auth/role-helpers';
import { getModules } from '@/lib/modules/registry';

/**
 * GET /api/credits/debug — TEMPORARY reconciliation tool (admin only).
 *
 * Reconciles LLM usage for the current calendar month across three sources,
 * grouped by (provider, model):
 *   - llm_logs        — request-side row written for EVERY call at call time
 *                       (ground truth of what was actually called).
 *   - llm_call_events — the structured stats table the credits card reads.
 *   - app_events      — the published AppEvents.LLM_CALL log.
 *
 * A model in `llm_logs` but NOT `llm_call_events` was CALLED but never recorded
 * as stats (a real recording gap — e.g. a sub-agent's buried final turn). A
 * model missing from `llm_logs` entirely was never called (config, not a bug).
 * `app_events` > `llm_call_events` counts usually means pre-fix headless calls
 * that were published but not yet written to the structured table.
 */

// Ground truth: one row per call, written at call time regardless of agent nesting.
const LLM_LOGS_SQL = `
SELECT COALESCE(provider,'') AS provider, COALESCE(model,'') AS model, COUNT(*) AS calls
FROM llm_logs
WHERE created_at >= date_trunc('month', NOW())
GROUP BY COALESCE(provider,''), COALESCE(model,'')
`;

// Structured stats table (what the credits card reads).
const LLM_EVENTS_SQL = `
SELECT COALESCE(provider,'') AS provider, model,
       COUNT(*)         AS calls,
       SUM(COALESCE(cost,0)) AS cost
FROM llm_call_events
WHERE created_at >= date_trunc('month', NOW())
GROUP BY COALESCE(provider,''), model
`;

// Event log — unnest the per-call llmCalls object from each llm:call payload.
const APP_EVENTS_SQL = `
SELECT COALESCE(call->>'provider','') AS provider,
       COALESCE(call->>'model','')    AS model,
       COUNT(*)                        AS calls,
       SUM(COALESCE((call->>'cost')::numeric,0)) AS cost
FROM app_events
CROSS JOIN LATERAL jsonb_each(COALESCE(payload->'llmCalls','{}'::jsonb)) AS kv(call_id, call)
WHERE event_type = 'llm:call'
  AND created_at >= date_trunc('month', NOW())
GROUP BY COALESCE(call->>'provider',''), COALESCE(call->>'model','')
`;

interface Row {
  provider: string;
  model: string;
  llmLogs: { calls: number } | null;
  llmEvents: { calls: number; cost: number } | null;
  appEvents: { calls: number; cost: number } | null;
}

export const GET = withAuth(async (_req: NextRequest, user) => {
  try {
    if (!isAdmin(user.role)) return ApiErrors.forbidden('Admin only');
    const db = getModules().db;
    const [logs, llm, app] = await Promise.all([
      db.exec<Record<string, unknown>>(LLM_LOGS_SQL),
      db.exec<Record<string, unknown>>(LLM_EVENTS_SQL),
      db.exec<Record<string, unknown>>(APP_EVENTS_SQL),
    ]);

    const merged = new Map<string, Row>();
    const key = (p: string, m: string) => `${p}|${m}`;
    const get = (p: string, m: string): Row => {
      const k = key(p, m);
      let r = merged.get(k);
      if (!r) { r = { provider: p, model: m, llmLogs: null, llmEvents: null, appEvents: null }; merged.set(k, r); }
      return r;
    };
    for (const r of logs.rows) get(String(r['provider'] ?? ''), String(r['model'] ?? '')).llmLogs = { calls: Number(r['calls'] ?? 0) };
    for (const r of llm.rows) get(String(r['provider'] ?? ''), String(r['model'] ?? '')).llmEvents = { calls: Number(r['calls'] ?? 0), cost: Number(r['cost'] ?? 0) };
    for (const r of app.rows) get(String(r['provider'] ?? ''), String(r['model'] ?? '')).appEvents = { calls: Number(r['calls'] ?? 0), cost: Number(r['cost'] ?? 0) };

    const rows = [...merged.values()].map((r) => {
      const called = r.llmLogs?.calls ?? 0;
      const recorded = r.llmEvents?.calls ?? 0;
      return {
        ...r,
        // Calls that happened (llm_logs) but never made it into the structured stats table.
        unrecordedCalls: Math.max(0, called - recorded),
      };
    }).sort((a, b) => b.unrecordedCalls - a.unrecordedCalls || (b.appEvents?.cost ?? 0) - (a.appEvents?.cost ?? 0));

    // The real gap: called (in llm_logs) but under-recorded in llm_call_events.
    const recordingGaps = rows.filter((r) => r.unrecordedCalls > 0);

    // Optional: scope to one conversation (?conversationId=1185) to see exactly what
    // a single Explore turn recorded vs published, per (provider, model, trigger).
    const convIdRaw = _req.nextUrl.searchParams.get('conversationId');
    let conversation: unknown = undefined;
    if (convIdRaw && /^\d+$/.test(convIdRaw)) {
      const [ce, ae] = await Promise.all([
        db.exec<Record<string, unknown>>(
          `SELECT COALESCE(provider,'') AS provider, model, trigger, COUNT(*) AS calls, SUM(COALESCE(cost,0)) AS cost
           FROM llm_call_events WHERE conversation_id = $1
           GROUP BY COALESCE(provider,''), model, trigger`,
          [Number(convIdRaw)],
        ),
        db.exec<Record<string, unknown>>(
          `SELECT COALESCE(call->>'provider','') AS provider, COALESCE(call->>'model','') AS model,
                  COUNT(*) AS calls, SUM(COALESCE((call->>'cost')::numeric,0)) AS cost
           FROM app_events CROSS JOIN LATERAL jsonb_each(COALESCE(payload->'llmCalls','{}'::jsonb)) AS kv(call_id, call)
           WHERE event_type = 'llm:call' AND payload->>'conversationId' = $1
           GROUP BY COALESCE(call->>'provider',''), COALESCE(call->>'model','')`,
          [convIdRaw],
        ),
      ]);
      conversation = {
        id: Number(convIdRaw),
        llmEvents: ce.rows.map((r) => ({ provider: String(r['provider'] ?? ''), model: String(r['model'] ?? ''), trigger: r['trigger'] ?? null, calls: Number(r['calls'] ?? 0), cost: Number(r['cost'] ?? 0) })),
        appEvents: ae.rows.map((r) => ({ provider: String(r['provider'] ?? ''), model: String(r['model'] ?? ''), calls: Number(r['calls'] ?? 0), cost: Number(r['cost'] ?? 0) })),
      };
    }

    return await successResponse({ rows, recordingGaps, gapCount: recordingGaps.length, conversation });
  } catch (error) {
    return handleApiError(error);
  }
});
