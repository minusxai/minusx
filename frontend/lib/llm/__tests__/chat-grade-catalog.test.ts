// Grade catalog for the chat picker: projects workspace LLM config into the
// safe, finite set of grades a chat user may pick. GRADES ONLY — provider
// names, model ids/labels, credentials, URLs, and options are behind-the-scenes
// concerns that never enter the returned value.
import { describe, expect, it } from 'vitest';
import type { LlmConfig } from '../llm-config-types';
import { buildChatGradeCatalog } from '../chat-grade-catalog';

describe('buildChatGradeCatalog', () => {
  it("lists the analyst policy's grades (core + advanced by default — lite is micro-only)", () => {
    const llm: LlmConfig = {
      providers: [
        { name: 'claude-team', provider: 'anthropic' },
        { name: 'openai-team', provider: 'openai' },
      ],
      grades: {
        lite: { providerName: 'claude-team', model: 'claude-haiku-4-5' },
        core: { providerName: 'claude-team', model: 'claude-sonnet-4-6' },
        advanced: { providerName: 'openai-team', model: 'gpt-5.4' },
      },
    };

    const result = buildChatGradeCatalog(llm);

    expect(result.defaultGrade).toBe('core');
    expect(result.grades).toEqual([
      { grade: 'core', configured: true },
      { grade: 'advanced', configured: true },
    ]);
  });

  it('never leaks provider or model identity — the payload is grades and flags only', () => {
    const llm: LlmConfig = {
      providers: [{ name: 'local', provider: 'custom', baseUrl: 'http://private.internal/v1', apiKey: 'secret' }],
      grades: {
        core: { providerName: 'local', model: 'qwen3:32b', customModel: { contextWindow: 32_000 } },
        advanced: { providerName: 'local', model: 'qwen3:235b' },
      },
    };
    const serialized = JSON.stringify(buildChatGradeCatalog(llm));
    for (const leak of ['local', 'custom', 'qwen3', 'private.internal', 'secret', 'contextWindow', 'anthropic', 'model']) {
      expect(serialized).not.toContain(leak);
    }
  });

  it('includes lite when a config policy allows it for the analyst', () => {
    const llm: LlmConfig = {
      providers: [{ name: 'a', provider: 'anthropic' }],
      grades: { lite: { providerName: 'a', model: 'claude-haiku-4-5' } },
      agents: { analyst: { allowedGrades: ['lite', 'core'], defaultGrade: 'core' } },
    };
    const result = buildChatGradeCatalog(llm);
    expect(result.grades.map(g => g.grade)).toEqual(['lite', 'core']);
  });

  it('bounds the list to the analyst policy (allowed grades + default)', () => {
    const llm: LlmConfig = {
      providers: [{ name: 'a', provider: 'anthropic' }],
      grades: {
        core: { providerName: 'a', model: 'claude-sonnet-4-6' },
        advanced: { providerName: 'a', model: 'claude-opus-4-8' },
      },
      agents: { analyst: { allowedGrades: ['core', 'advanced'], defaultGrade: 'advanced' } },
    };
    const result = buildChatGradeCatalog(llm);
    expect(result.defaultGrade).toBe('advanced');
    expect(result.grades.map(g => g.grade)).toEqual(['core', 'advanced']);
  });

  it('marks unmapped grades unconfigured when there is no minusx provider', () => {
    const llm: LlmConfig = {
      providers: [{ name: 'a', provider: 'anthropic' }],
      grades: { core: { providerName: 'a', model: 'claude-sonnet-4-6' } },
    };
    const result = buildChatGradeCatalog(llm);
    expect(result.grades).toEqual([
      { grade: 'core', configured: true },
      { grade: 'advanced', configured: false },
    ]);
  });

  it('treats every grade as configured with a minusx provider (the gateway routes them all)', () => {
    const llm: LlmConfig = {
      providers: [{ name: 'minusx', provider: 'minusx', apiKey: 'k' }],
    };
    const result = buildChatGradeCatalog(llm);
    expect(result.grades).toEqual([
      { grade: 'core', configured: true },
      { grade: 'advanced', configured: true },
    ]);
  });

  it('treats every grade as configured for an unconfigured workspace (managed gateway default)', () => {
    const result = buildChatGradeCatalog(undefined);
    expect(result.defaultGrade).toBe('core');
    expect(result.grades).toEqual([
      { grade: 'core', configured: true },
      { grade: 'advanced', configured: true },
    ]);
  });
});
