// createTrackedOrchestrator — resolver wiring (mocked plan module, no DB).
// The llmAgent option must pin EVERY call's selector to that agent policy
// (report's whole-run pin); gradeOverride must reach buildLlmPlanResolver.

const resolverCalls: { gradeOverride?: string; selector: Record<string, unknown> }[] = [];
vi.mock('@/lib/llm/llm-plan.server', () => ({
  buildLlmPlanResolver: vi.fn((gradeOverride?: string) =>
    vi.fn(async (selector: Record<string, unknown>) => {
      resolverCalls.push({ gradeOverride, selector });
      return null;
    })),
}));

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createTrackedOrchestrator } from '@/lib/chat/tracked-orchestrator.server';
import { MicroAgent } from '@/agents/micro/micro-agent';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';

const USER = { userId: 1, email: 'w@x.co', name: 'W', role: 'admin', home_folder: '/org', mode: 'org' } as EffectiveUser;

beforeEach(() => { resolverCalls.length = 0; });

describe('createTrackedOrchestrator resolver wiring', () => {
  it('with llmAgent set, every selector reaching the resolver carries that agent', async () => {
    const { orch } = createTrackedOrchestrator({
      registrables: [MicroAgent],
      user: USER,
      tracking: { task: 'report' },
      llmAgent: 'report',
    });
    await orch.resolveLlmPlan!({ agent: 'analyst', grade: undefined } as never);
    expect(resolverCalls).toHaveLength(1);
    expect(resolverCalls[0].selector.agent).toBe('report');
  });

  it('without llmAgent, the selector passes through with the agent the caller set', async () => {
    const { orch } = createTrackedOrchestrator({
      registrables: [MicroAgent],
      user: USER,
      tracking: { task: 'eval' },
    });
    await orch.resolveLlmPlan!({ agent: 'analyst' } as never);
    expect(resolverCalls[0].selector.agent).toBe('analyst');
  });

  it('forwards gradeOverride to buildLlmPlanResolver', async () => {
    const { orch } = createTrackedOrchestrator({
      registrables: [MicroAgent],
      user: USER,
      tracking: { conversationId: 1 },
      gradeOverride: 'advanced',
    });
    await orch.resolveLlmPlan!({ agent: 'analyst' } as never);
    expect(resolverCalls[0].gradeOverride).toBe('advanced');
  });
});
