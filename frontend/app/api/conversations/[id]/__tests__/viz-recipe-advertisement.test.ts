/**
 * Agent advertisement of viz recipes: the system prompt carries a "Chart
 * Recipes" section listing what resolves for the TURN ANCHOR's folder —
 * built-ins everywhere, workspace files by ancestry, overrides shadowing.
 * Built through the same preview path a real turn uses, so what's asserted
 * here is exactly what the LLM sees.
 */
import { previewNextChatContext } from '@/lib/chat/orchestration-core.server';
import { createConversation, getConversation, getMaxSeq, loadLog } from '@/lib/data/conversations.server';
import { FilesAPI } from '@/lib/data/files.server';
import { fauxRegistration as webAnalystFaux } from '@/agents/web-analyst/web-analyst';
import { fauxAssistantMessage } from '@/orchestrator/llm/testing';
import { NextRequest } from 'next/server';
import { POST as turnsRoute } from '@/app/api/conversations/[id]/turns/route';
import { getTestDbPath } from '@/store/__tests__/test-utils';
import { setupTestDb } from '@/test/harness/test-db';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';
import type { VizRecipeContent } from '@/lib/validation/atlas-schemas';

const TEST_DB_PATH = getTestDbPath('viz_recipe_ads');
const idCtx = (id: number) => ({ params: Promise.resolve({ id: String(id) }) }) as never;

const testUser: EffectiveUser = {
  userId: 1, name: 'Test User', email: 'test@example.com',
  role: 'admin', mode: 'org', home_folder: '',
};

const RECIPE: VizRecipeContent = {
  description: 'ROOT_FUNNEL_PRO_DESC',
  engine: 'vega-lite',
  bindings: [
    { name: 'stage', label: 'Stage', accepts: ['nominal'] },
    { name: 'value', label: 'Value', accepts: ['quantitative'] },
  ],
  template: {
    mark: 'bar',
    encoding: {
      x: { field: '{{stage}}', type: 'nominal' },
      y: { field: '{{value}}', type: 'quantitative' },
    },
  },
};

const fileAppState = (path: string) => ({
  type: 'file',
  state: { fileState: { type: 'question', path } },
});

async function promptFor(appState?: unknown): Promise<string> {
  const conv = await createConversation({ ownerUserId: 1, mode: 'org', agent: 'WebAnalystAgent' });
  const ctx = await previewNextChatContext(
    { user_message: 'q', agent_args: appState ? { app_state: appState } : {} },
    testUser,
    conv.id,
  );
  return typeof ctx.systemPrompt === 'string' ? ctx.systemPrompt : JSON.stringify(ctx.systemPrompt);
}

describe('viz recipe advertisement in the agent prompt', () => {
  setupTestDb(TEST_DB_PATH);

  beforeEach(async () => {
    const publish = async (path: string, content: VizRecipeContent) => {
      const name = path.slice(path.lastIndexOf('/') + 1);
      const created = await FilesAPI.createFile({ name, path, type: 'viz', content }, testUser);
      await FilesAPI.saveFile(created.data.id, name, path, content as never, [], testUser);
    };
    await FilesAPI.createFile({ name: 'finance', path: '/org/finance', type: 'folder', content: {} }, testUser).catch(() => undefined);
    await publish('/org/funnel-pro', RECIPE);
    await publish('/org/finance/funnel-pro', { ...RECIPE, description: 'FINANCE_FUNNEL_PRO_DESC' });
  });

  it('advertises built-ins and root workspace recipes with slots', async () => {
    const sp = await promptFor();
    expect(sp).toContain('## Chart Recipes');
    expect(sp).toContain('bullet');
    expect(sp).toContain('lollipop');
    expect(sp).toContain('funnel-pro');
    expect(sp).toContain('ROOT_FUNNEL_PRO_DESC');
    expect(sp).toContain('stage');   // slot names advertised
    expect(sp).toContain('/org/funnel-pro'); // file path advertised for ReadFiles/editing
  });

  it("scopes the list to the anchor folder — finance sees finance's override", async () => {
    const sp = await promptFor(fileAppState('/org/finance/some-question'));
    expect(sp).toContain('FINANCE_FUNNEL_PRO_DESC');
    expect(sp).not.toContain('ROOT_FUNNEL_PRO_DESC');
  });

  it('the root anchor never sees a subfolder-only recipe description', async () => {
    const sp = await promptFor(fileAppState('/org/some-question'));
    expect(sp).toContain('ROOT_FUNNEL_PRO_DESC');
    expect(sp).not.toContain('FINANCE_FUNNEL_PRO_DESC');
  });

  it('a full faux turn runs cleanly with recipes advertised', async () => {
    webAnalystFaux.setResponses([fauxAssistantMessage('done', { stopReason: 'stop' })]);
    const conv = await createConversation({ ownerUserId: 1, mode: 'org', agent: 'WebAnalystAgent' });
    const res = await turnsRoute(
      new NextRequest(`http://localhost/api/conversations/${conv.id}/turns`, {
        method: 'POST',
        body: JSON.stringify({ userMessage: 'hello', agentArgs: {} }),
      }),
      idCtx(conv.id),
    );
    expect(res.status).toBe(200);
    const start = Date.now();
    for (;;) {
      const c = await getConversation(conv.id);
      if (c && c.runStatus !== 'running' && (await getMaxSeq(conv.id)) >= 0) break;
      if (Date.now() - start > 4000) throw new Error(`turn did not settle (${c?.runStatus})`);
      await new Promise((r) => setTimeout(r, 20));
    }
    // The root invocation freezes the resolved catalog into the saved context
    // (what a mid-turn resume reconstructs from) — the rendered "## Chart
    // Recipes" section itself is asserted via previewNextChatContext above.
    const log = await loadLog(conv.id);
    const root = JSON.stringify(log[0]);
    expect(root).toContain('vizRecipes');
    expect(root).toContain('funnel-pro');
    expect(root).toContain('ROOT_FUNNEL_PRO_DESC');
  });
});
