// v=2 chat path honors the requested `agent` name for onboarding-wizard agents.
//
// Proves setupOrchestration selects OnboardingContextAgent / OnboardingDashboardAgent
// (not the default WebAnalystAgent) when the request carries that `agent`. If the
// selection were broken, WebAnalystAgent would run and consume the (empty)
// web-analyst faux → "no faux responses" error; success here means the onboarding
// agent ran (it consumed the onboarding faux + rendered the onboarding prompt).

vi.mock('@/lib/database/db-config', () => ({
  PGLITE_DATA_DIR: undefined,
  DB_PATH: undefined,
  DB_DIR: undefined,
  getDbType: () => 'pglite' as const,
}));
vi.mock('@/lib/connections/run-query', () => ({ runQuery: vi.fn(async () => ({ columns: [], types: [], rows: [], finalQuery: '' })) }));
vi.mock('@/lib/connections/load-schema', () => ({ loadConnectionSchema: vi.fn(async () => []) }));

import { fauxAssistantMessage } from '@/orchestrator/llm/testing';
import { fauxRegistration as onboardingFaux } from '@/agents/onboarding/onboarding-agents';
import { POST as chatPostHandler } from '@/app/api/chat/route';
import { getTestDbPath } from '@/store/__tests__/test-utils';
import { setupTestDb } from '@/test/harness/test-db';
import { NextRequest } from 'next/server';
import type { Context } from '@/orchestrator/llm';

const TEST_DB_PATH = getTestDbPath('chat_v2_onboarding');

function makeRequest(url: string, body: Record<string, unknown>): NextRequest {
  return new NextRequest(url, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

function replyText(body: { completed_tool_calls: Array<{ function: { name: string }; content: string }> }): string {
  const ttu = body.completed_tool_calls.find((c) => c.function.name === 'TalkToUser');
  if (!ttu) return '';
  return JSON.parse(String(ttu.content)).content_blocks.map((b: { text?: string }) => b.text ?? '').join('');
}

describe('POST /api/chat?v=2 — onboarding agent selection', () => {
  setupTestDb(TEST_DB_PATH);
  beforeEach(() => onboardingFaux.setResponses([]));

  it('runs OnboardingContextAgent (not WebAnalystAgent) for agent=OnboardingContextAgent', async () => {
    onboardingFaux.setResponses([
      (ctx: Context) => {
        expect(ctx.systemPrompt).toContain('quickly document a database');
        return fauxAssistantMessage('Documented the schema into the context file.', { stopReason: 'stop' });
      },
    ]);

    const res = await chatPostHandler(
      makeRequest('http://localhost/api/chat?v=2', {
        agent: 'OnboardingContextAgent',
        user_message: 'Document the schema',
        agent_args: {
          connection_id: 'db',
          schema: [{ schema: 'main', tables: ['orders'] }],
          context: '',
          app_state: { type: 'file' },
        },
      }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.error).toBeUndefined();
    expect(replyText(body)).toContain('Documented the schema');
  });

  it('runs OnboardingDashboardAgent for agent=OnboardingDashboardAgent', async () => {
    onboardingFaux.setResponses([
      (ctx: Context) => {
        expect(ctx.systemPrompt).toContain('build a starter dashboard');
        return fauxAssistantMessage('Built a starter dashboard with 4 questions.', { stopReason: 'stop' });
      },
    ]);

    const res = await chatPostHandler(
      makeRequest('http://localhost/api/chat?v=2', {
        agent: 'OnboardingDashboardAgent',
        user_message: 'Build a dashboard',
        agent_args: {
          connection_id: 'db',
          schema: [{ schema: 'main', tables: ['orders'] }],
          context: 'Some docs',
          app_state: { type: 'folder' },
        },
      }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.error).toBeUndefined();
    expect(replyText(body)).toContain('starter dashboard');
  });
});
