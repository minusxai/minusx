import { NextRequest, NextResponse } from 'next/server';
import { getEffectiveUser } from '@/lib/auth/auth-helpers';
import { runMicroTask } from '@/lib/chat/run-micro-task.server';
import { MICRO_TASKS } from '@/agents/micro/micro-tasks';
import { handleApiError } from '@/lib/api/api-responses';

/**
 * POST /api/micro-task
 *
 * Runs a single-turn "micro" agent task — a no-tools, one-LLM-call helper for
 * quick text generation (title / description / summary / feed_summary / …). No
 * conversation is persisted; usage is tracked out-of-band tagged by task.
 *
 * Body: `{ task: string, vars?: Record<string, string> }` — `task` must be a key
 * in `MICRO_TASKS`; `vars` fill that task's prompt template. Returns
 * `{ success: true, result: string }`.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await getEffectiveUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { task, vars } = await request.json();
    if (typeof task !== 'string' || !Object.hasOwn(MICRO_TASKS, task)) {
      return NextResponse.json({ error: `Unknown micro-task '${task}'` }, { status: 400 });
    }
    if (vars !== undefined && (typeof vars !== 'object' || vars === null)) {
      return NextResponse.json({ error: 'vars must be an object' }, { status: 400 });
    }

    const result = await runMicroTask(task, (vars ?? {}) as Record<string, string>, user);
    return NextResponse.json({ success: true, result });
  } catch (error) {
    return handleApiError(error);
  }
}
