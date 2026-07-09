/**
 * The admin-only Tool Inspector (`POST /api/tools/execute`) re-runs a real
 * registered tool from `REGISTRABLES` — the same registry that powers live
 * chat — rather than a separate shadow implementation. These tests exercise
 * `executeRegisteredTool` directly (the route is a thin parse/format wrapper
 * around it).
 */
import { describe, it, expect } from 'vitest';
import { executeRegisteredTool } from '@/lib/chat/tool-inspector.server';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';

const testUser: EffectiveUser = {
  userId: 1,
  email: 'admin@test.com',
  name: 'Admin',
  role: 'admin',
  home_folder: '',
  mode: 'org',
};

describe('executeRegisteredTool', () => {
  it('runs a real registered leaf tool (LoadSkill) and returns its parsed content', async () => {
    const outcome = await executeRegisteredTool('LoadSkill', { name: 'questions' }, testUser);
    expect(outcome.executable).toBe(true);
    const result = outcome.result as { success: boolean; skill: string; content: string };
    expect(result.success).toBe(true);
    expect(result.skill).toBe('questions');
    expect(typeof result.content).toBe('string');
    expect(result.content.length).toBeGreaterThan(0);
  });

  it('reports a tool requiring frontend interaction as not executable, without throwing', async () => {
    // EditFile is frontend-bridged — its run() always throws UserInputException. (LoadSkill no
    // longer bridges for unknown names; it errors with the valid names instead.)
    const outcome = await executeRegisteredTool('EditFile', { fileId: 1 }, testUser);
    expect(outcome.executable).toBe(false);
    expect(outcome.error).toMatch(/user interaction/i);
  });

  it('reports an unregistered tool name as not executable', async () => {
    const outcome = await executeRegisteredTool('NotARealTool', {}, testUser);
    expect(outcome.executable).toBe(false);
    expect(outcome.error).toMatch(/not re-executable/i);
  });

  it('rejects agent-type registrations (never drives an LLM loop from the inspector)', async () => {
    // WebAnalystAgent is a real REGISTRABLES entry, but it's an MXAgent —
    // instantiating and running it would call the LLM, which the inspector
    // must never do standalone.
    const outcome = await executeRegisteredTool('WebAnalystAgent', { userMessage: 'hi' }, testUser);
    expect(outcome.executable).toBe(false);
    expect(outcome.error).toMatch(/not re-executable/i);
  });
});
