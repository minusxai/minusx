// The per-chat grade override travels as `agent_args.grade_override` on the
// turn POST; setupOrchestration narrows it to a known grade before handing it
// to the plan resolver — junk values are dropped, never forwarded.

vi.mock('@/lib/llm/llm-plan.server', () => ({
  buildLlmPlanResolver: vi.fn(() => async () => null),
}));

import { NextRequest } from 'next/server';
import { POST as turnsRoute } from '@/app/api/conversations/[id]/turns/route';
import { createConversation, getConversation, getMaxSeq } from '@/lib/data/conversations.server';
import { fauxRegistration as webAnalystFaux } from '@/agents/web-analyst/web-analyst';
import { fauxAssistantMessage } from '@/orchestrator/llm/testing';
import { buildLlmPlanResolver } from '@/lib/llm/llm-plan.server';
import { getTestDbPath } from '@/store/__tests__/test-utils';
import { setupTestDb } from '@/test/harness/test-db';

const TEST_DB_PATH = getTestDbPath('grade_override');
const idCtx = (id: number) => ({ params: Promise.resolve({ id: String(id) }) }) as never;

async function waitForIdle(conversationId: number, ms = 4000): Promise<void> {
  const start = Date.now();
  for (;;) {
    const c = await getConversation(conversationId);
    const maxSeq = await getMaxSeq(conversationId);
    if (c && c.runStatus !== 'running' && maxSeq >= 0) return;
    if (Date.now() - start > ms) throw new Error(`turn did not settle (status=${c?.runStatus}, maxSeq=${maxSeq})`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

async function runTurn(gradeOverride: unknown): Promise<void> {
  webAnalystFaux.setResponses([fauxAssistantMessage('done.', { stopReason: 'stop' })]);
  const conv = await createConversation({ ownerUserId: 1, mode: 'org', agent: 'WebAnalystAgent' });
  const res = await turnsRoute(
    new NextRequest(`http://localhost/api/conversations/${conv.id}/turns`, {
      method: 'POST',
      body: JSON.stringify({ userMessage: 'hi', agentArgs: { grade_override: gradeOverride } }),
    }),
    idCtx(conv.id),
  );
  expect(res.status).toBe(200);
  await waitForIdle(conv.id);
}

describe('agent_args.grade_override → plan resolver', () => {
  setupTestDb(TEST_DB_PATH);

  it('forwards a valid grade to the resolver', async () => {
    vi.mocked(buildLlmPlanResolver).mockClear();
    await runTurn('advanced');
    expect(buildLlmPlanResolver).toHaveBeenCalledWith('advanced');
  });

  it('drops junk values (unknown strings, objects) instead of forwarding them', async () => {
    vi.mocked(buildLlmPlanResolver).mockClear();
    await runTurn('huge');
    expect(buildLlmPlanResolver).toHaveBeenCalledWith(undefined);

    vi.mocked(buildLlmPlanResolver).mockClear();
    await runTurn({ providerName: 'openai', model: 'gpt-5.4' });
    expect(buildLlmPlanResolver).toHaveBeenCalledWith(undefined);
  });
});
