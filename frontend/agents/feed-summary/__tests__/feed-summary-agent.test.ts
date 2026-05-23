// FeedSummaryAgent (v2) — single-call summary via the headless runner.

vi.mock('@/lib/connections/run-query', () => ({ runQuery: vi.fn(async () => ({ columns: [], types: [], rows: [], finalQuery: '' })) }));
vi.mock('@/lib/connections/load-schema', () => ({ loadConnectionSchema: vi.fn(async () => []) }));

import { fauxAssistantMessage } from '@/orchestrator/llm/testing';
import { fauxRegistration as feedFaux } from '@/agents/feed-summary/feed-summary-agent';
import { runFeedSummaryV2 } from '@/lib/chat/run-feed-summary-v2.server';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';
import type { Context } from '@/orchestrator/llm';

const USER: EffectiveUser = {
  userId: 1, email: 'u@example.com', name: 'U', role: 'admin', home_folder: '/org', mode: 'org',
};

function userText(context: Context): string {
  const m = context.messages.find((x) => x.role === 'user');
  const c = m?.content as unknown;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
  return '';
}

beforeEach(() => feedFaux.setResponses([]));

describe('runFeedSummaryV2', () => {
  it('produces a summary from appState in one LLM call (no tools)', async () => {
    feedFaux.setResponses([
      (context: Context) => {
        // The app_state is embedded in the user prompt (feed_summary.user template).
        expect(userText(context)).toContain('Revenue Dashboard');
        // No tools are advertised to the model.
        expect(context.tools ?? []).toEqual([]);
        return fauxAssistantMessage('Revenue is trending up; 3 dashboards updated this week.', { stopReason: 'stop' });
      },
    ]);

    const summary = await runFeedSummaryV2({ files: [{ name: 'Revenue Dashboard' }] }, USER);
    expect(summary).toBe('Revenue is trending up; 3 dashboards updated this week.');
  });
});
