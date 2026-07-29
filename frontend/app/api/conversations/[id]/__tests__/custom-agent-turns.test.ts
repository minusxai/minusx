// Custom agents end-to-end through the v3 chat routes: agent_args.custom_agent
// (a POINTER — AgentEntry.name on the context file) is resolved SERVER-side by
// setupOrchestration into a CustomAgent root with server-resolved skills
// (fixing the headless user-skill gap for this path), an agent-default grade,
// and append/replace prompt assembly. Faux LLM.

import { NextRequest } from 'next/server';
import { POST as turnsRoute } from '@/app/api/conversations/[id]/turns/route';
import { createConversation, getConversation, getMaxSeq, loadLog } from '@/lib/data/conversations.server';
import { previewNextChatContext } from '@/lib/chat/orchestration-core.server';
import { fauxRegistration as webAnalystFaux } from '@/agents/web-analyst/web-analyst';
import { fauxAssistantMessage, fauxToolCall } from '@/orchestrator/llm/testing';
import { DocumentDB } from '@/lib/database/documents-db';
import { getModules } from '@/lib/modules/registry';
import { getTestDbPath } from '@/store/__tests__/test-utils';
import { setupTestDb } from '@/test/harness/test-db';
import type { ContextContent, AgentEntry, SkillEntry } from '@/lib/types';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';

const { llmPlanSpy } = vi.hoisted(() => ({ llmPlanSpy: vi.fn() }));
vi.mock('@/lib/llm/llm-plan.server', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/llm/llm-plan.server')>();
  return {
    ...mod,
    buildLlmPlanResolver: (gradeOverride?: unknown) => {
      llmPlanSpy(gradeOverride);
      return mod.buildLlmPlanResolver(gradeOverride as never);
    },
  };
});

const TEST_DB_PATH = getTestDbPath('custom_agent_turns');
const idCtx = (id: number) => ({ params: Promise.resolve({ id: String(id) }) }) as never;

const testUser: EffectiveUser = {
  userId: 1,
  name: 'Test User',
  email: 'test@example.com',
  role: 'admin',
  mode: 'org',
  home_folder: '',
};

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

function mkSkill(name: string, content: string): SkillEntry {
  return {
    name, description: `${name} desc`, content, enabled: true,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), createdBy: 1,
  };
}

function mkAgent(overrides: Partial<AgentEntry> & { name: string }): AgentEntry {
  return {
    description: `${overrides.name} desc`,
    prompt: 'default prompt',
    promptMode: 'append',
    preloadSkills: [],
    includeSkills: [],
    enabled: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    createdBy: 1,
    ...overrides,
  };
}

describe('custom-agent turns (v3 chat routes)', () => {
  setupTestDb(TEST_DB_PATH);
  let contextFileId: number;

  beforeEach(async () => {
    llmPlanSpy.mockClear();
    // The workspace seed may already have a context at /org/context — replace it.
    await getModules().db.exec("DELETE FROM files WHERE type = 'context'", []);
    const content: ContextContent = {
      versions: [{
        version: 1, whitelist: [], docs: [],
        createdAt: new Date().toISOString(), createdBy: 1,
      }],
      published: { all: 1 },
      skills: [mkSkill('kb_pricing', 'SERVER_KB_PRICING_BODY')],
      agents: [
        mkAgent({
          name: 'sales_helper',
          prompt: 'APPEND_PERSONA_MARKER: cheerful sales analyst.',
          preloadSkills: ['kb_pricing'],
          includeSkills: ['kb_pricing', 'dashboards'],
          gradeOverride: 'advanced',
        }),
        mkAgent({
          name: 'terse_bot',
          prompt: 'REPLACE_PERSONA_MARKER: terse SQL bot.',
          promptMode: 'replace',
        }),
        mkAgent({ name: 'disabled_bot', enabled: false }),
      ],
    };
    contextFileId = await DocumentDB.create('context', '/org/context', 'context', content, []);
    await DocumentDB.update(contextFileId, 'context', '/org/context', content, [], 'init-context');
  });

  async function postTurn(conversationId: number, agentArgs: Record<string, unknown>, userMessage = 'hello') {
    const res = await turnsRoute(
      new NextRequest(`http://localhost/api/conversations/${conversationId}/turns`, {
        method: 'POST',
        body: JSON.stringify({ userMessage, agentArgs }),
      }),
      idCtx(conversationId),
    );
    expect(res.status).toBe(200);
    await waitForIdle(conversationId);
  }

  it('runs the turn as CustomAgent with server-resolved skills (client sent NONE)', async () => {
    webAnalystFaux.setResponses([fauxAssistantMessage('hi from custom agent', { stopReason: 'stop' })]);
    const conv = await createConversation({ ownerUserId: 1, mode: 'org', agent: 'WebAnalystAgent' });
    await postTurn(conv.id, { custom_agent: 'sales_helper', context_file_id: contextFileId });

    const log = await loadLog(conv.id);
    const root = JSON.stringify(log[0]);
    expect(root).toContain('CustomAgent');
    // resolved definition frozen into the root context
    expect(root).toContain('APPEND_PERSONA_MARKER');
    // preloadSkills resolved server-side: user-skill CONTENT present without any client skills payload
    expect(root).toContain('SERVER_KB_PRICING_BODY');
  });

  it('assembles the append prompt with a restricted catalog (previewNextChatContext)', async () => {
    const conv = await createConversation({ ownerUserId: 1, mode: 'org', agent: 'WebAnalystAgent' });
    const ctx = await previewNextChatContext(
      { user_message: 'q', agent_args: { custom_agent: 'sales_helper', context_file_id: contextFileId } },
      testUser,
      conv.id,
    );
    const sp = typeof ctx.systemPrompt === 'string' ? ctx.systemPrompt : JSON.stringify(ctx.systemPrompt);
    expect(sp).toContain('APPEND_PERSONA_MARKER');
    expect(sp).toContain('## Application Structure');       // append keeps the default body
    expect(sp).toContain('**Skill: kb_pricing (user-defined)**'); // preload inlined
    expect(sp).toContain('- `"dashboards"`');               // includeSkills in catalog
    expect(sp).not.toContain('- `"alerts"`');               // outside allowlist
  });

  it('assembles the replace prompt: persona replaces the intro + guidelines', async () => {
    const conv = await createConversation({ ownerUserId: 1, mode: 'org', agent: 'WebAnalystAgent' });
    const ctx = await previewNextChatContext(
      { user_message: 'q', agent_args: { custom_agent: 'terse_bot', context_file_id: contextFileId } },
      testUser,
      conv.id,
    );
    const sp = typeof ctx.systemPrompt === 'string' ? ctx.systemPrompt : JSON.stringify(ctx.systemPrompt);
    expect(sp).toContain('REPLACE_PERSONA_MARKER');
    expect(sp).toContain('## Application Structure');        // app structure kept
    expect(sp).not.toContain('expert data analyst');         // intro gone
    expect(sp).not.toContain('### Response Guidelines');     // guidelines gone
    expect(sp).toContain('## Available Database Schema');   // dynamic sections kept
  });

  it("applies the agent's gradeOverride, but an explicit client grade wins", async () => {
    // Other resolver builds happen around a turn (e.g. the auto-title micro
    // task passes undefined) — assert on the set of grades seen per turn.
    webAnalystFaux.setResponses([fauxAssistantMessage('ok', { stopReason: 'stop' })]);
    const conv = await createConversation({ ownerUserId: 1, mode: 'org', agent: 'WebAnalystAgent' });
    await postTurn(conv.id, { custom_agent: 'sales_helper', context_file_id: contextFileId });
    expect(llmPlanSpy.mock.calls.map((c) => c[0])).toContain('advanced'); // agent default applies

    llmPlanSpy.mockClear();
    webAnalystFaux.setResponses([fauxAssistantMessage('ok', { stopReason: 'stop' })]);
    const conv2 = await createConversation({ ownerUserId: 1, mode: 'org', agent: 'WebAnalystAgent' });
    await postTurn(conv2.id, { custom_agent: 'sales_helper', context_file_id: contextFileId, grade_override: 'lite' });
    const grades = llmPlanSpy.mock.calls.map((c) => c[0]);
    expect(grades).toContain('lite');        // explicit user pick wins
    expect(grades).not.toContain('advanced'); // agent default NOT used
  });

  it('falls back to WebAnalystAgent for unknown or disabled agent names', async () => {
    for (const name of ['no_such_agent', 'disabled_bot']) {
      webAnalystFaux.setResponses([fauxAssistantMessage('fallback ok', { stopReason: 'stop' })]);
      const conv = await createConversation({ ownerUserId: 1, mode: 'org', agent: 'WebAnalystAgent' });
      await postTurn(conv.id, { custom_agent: name, context_file_id: contextFileId });
      const log = await loadLog(conv.id);
      const root = JSON.stringify(log[0]);
      expect(root).toContain('WebAnalystAgent');
      expect(root).not.toContain('"CustomAgent"');
      expect((await getConversation(conv.id))?.runStatus).toBe('idle');
    }
  });

  it('LoadSkill resolves user skills server-side on PLAIN turns too — no frontend bridge, no custom agent', async () => {
    webAnalystFaux.setResponses([
      fauxAssistantMessage([fauxToolCall('LoadSkill', { name: 'kb_pricing' })], { stopReason: 'toolUse' }),
      fauxAssistantMessage('loaded plain.', { stopReason: 'stop' }),
    ]);
    const conv = await createConversation({ ownerUserId: 1, mode: 'org', agent: 'WebAnalystAgent' });
    // No custom_agent, no client skills payload — just the context pointer.
    await postTurn(conv.id, { context_file_id: contextFileId });

    expect((await getConversation(conv.id))?.runStatus).toBe('idle');
    const flat = JSON.stringify(await loadLog(conv.id));
    expect(flat).toContain('SERVER_KB_PRICING_BODY'); // resolved in-process
    expect(flat).toContain('loaded plain.');
  });

  it('LoadSkill resolves an included user skill fully server-side (no frontend bridge)', async () => {
    webAnalystFaux.setResponses([
      fauxAssistantMessage([fauxToolCall('LoadSkill', { name: 'kb_pricing' })], { stopReason: 'toolUse' }),
      fauxAssistantMessage('loaded the skill.', { stopReason: 'stop' }),
    ]);
    const conv = await createConversation({ ownerUserId: 1, mode: 'org', agent: 'WebAnalystAgent' });
    await postTurn(conv.id, { custom_agent: 'sales_helper', context_file_id: contextFileId });

    // Turn settled idle (a frontend bridge would leave a pending tool call instead)
    expect((await getConversation(conv.id))?.runStatus).toBe('idle');
    const flat = JSON.stringify(await loadLog(conv.id));
    expect(flat).toContain('SERVER_KB_PRICING_BODY'); // resolved inline, in the tool result
    expect(flat).toContain('loaded the skill.');
  });
});
