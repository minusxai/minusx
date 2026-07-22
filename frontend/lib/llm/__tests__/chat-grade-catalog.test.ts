// Grade catalog for the chat picker: projects workspace LLM config into the
// safe, finite set of grades a chat user may pick. Credentials, URLs, call
// options, and custom model metadata never enter the returned value.
import { describe, expect, it } from 'vitest';
import compatibility from '@/compatibility.json';
import type { LlmConfig } from '../llm-config-types';
import { buildChatGradeCatalog } from '../chat-grade-catalog';

const registry = [
  {
    slug: 'anthropic',
    models: [
      { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5' },
      { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6' },
      { id: 'claude-opus-4-8', name: 'Claude Opus 4.8' },
    ],
  },
  {
    slug: 'openai',
    models: [
      { id: 'gpt-5.4', name: 'GPT-5.4' },
      { id: 'gpt-4.1', name: 'GPT-4.1' },
    ],
  },
];

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

    const result = buildChatGradeCatalog(llm, registry);

    expect(result.defaultGrade).toBe('core');
    expect(result.grades).toEqual([
      { grade: 'core', providerLabel: 'claude-team (Anthropic)', modelLabel: 'Claude Sonnet 4.6', configured: true },
      { grade: 'advanced', providerLabel: 'openai-team (OpenAI)', modelLabel: 'GPT-5.4', configured: true },
    ]);
  });

  it('includes lite when a config policy allows it for the analyst', () => {
    const llm: LlmConfig = {
      providers: [{ name: 'a', provider: 'anthropic' }],
      grades: { lite: { providerName: 'a', model: 'claude-haiku-4-5' } },
      agents: { analyst: { allowedGrades: ['lite', 'core'], defaultGrade: 'core' } },
    };
    const result = buildChatGradeCatalog(llm, registry);
    expect(result.grades.map(g => g.grade)).toEqual(['lite', 'core']);
  });

  it('resolves an Auto (model-less) mapping to the compat grade default label', () => {
    const coreDefault = (compatibility.llm.providers as { id: string; defaults?: Record<string, string> }[])
      .find(p => p.id === 'anthropic')!.defaults!['core'];
    const llm: LlmConfig = {
      providers: [{ name: 'a', provider: 'anthropic' }],
      grades: { core: { providerName: 'a' } },
    };
    const core = buildChatGradeCatalog(llm, registry).grades.find(g => g.grade === 'core')!;
    // Our fixture registry names claude-sonnet-4-6; fall back to the id otherwise.
    const expected = registry[0].models.find(m => m.id === coreDefault)?.name ?? coreDefault;
    expect(core.modelLabel).toBe(expected);
    expect(core.configured).toBe(true);
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
    const result = buildChatGradeCatalog(llm, registry);
    expect(result.defaultGrade).toBe('advanced');
    expect(result.grades.map(g => g.grade)).toEqual(['core', 'advanced']);
  });

  it('marks unmapped grades unconfigured when there is no minusx provider', () => {
    const llm: LlmConfig = {
      providers: [{ name: 'a', provider: 'anthropic' }],
      grades: { core: { providerName: 'a', model: 'claude-sonnet-4-6' } },
    };
    const result = buildChatGradeCatalog(llm, registry);
    expect(result.grades.find(g => g.grade === 'advanced')).toEqual({
      grade: 'advanced', modelLabel: 'Not configured', configured: false,
    });
  });

  it('routes unmapped grades to a configured minusx provider (managed, always configured)', () => {
    const llm: LlmConfig = {
      providers: [{ name: 'minusx', provider: 'minusx', apiKey: 'k' }],
    };
    const result = buildChatGradeCatalog(llm, registry);
    expect(result.grades.map(g => g.grade)).toEqual(['core', 'advanced']);
    for (const g of result.grades) {
      expect(g).toMatchObject({ providerLabel: 'MinusX', modelLabel: 'Auto', configured: true });
    }
  });

  it('shows only the mapped model id for a custom provider and keeps endpoint metadata private', () => {
    const llm: LlmConfig = {
      providers: [{ name: 'local', provider: 'custom', baseUrl: 'http://private.internal/v1', apiKey: 'secret' }],
      grades: {
        core: { providerName: 'local', model: 'qwen3:32b', customModel: { contextWindow: 32_000 } },
      },
    };
    const result = buildChatGradeCatalog(llm, registry);
    const core = result.grades.find(g => g.grade === 'core')!;
    expect(core).toMatchObject({ providerLabel: 'local (Custom)', modelLabel: 'qwen3:32b', configured: true });
    expect(JSON.stringify(result)).not.toContain('private.internal');
    expect(JSON.stringify(result)).not.toContain('secret');
    expect(JSON.stringify(result)).not.toContain('contextWindow');
  });

  it('describes the managed MinusX default for an unconfigured workspace', () => {
    const result = buildChatGradeCatalog(undefined, registry);
    expect(result.defaultGrade).toBe('core');
    expect(result.grades.map(g => g.grade)).toEqual(['core', 'advanced']);
    for (const g of result.grades) {
      expect(g).toMatchObject({ providerLabel: 'MinusX', modelLabel: 'Auto', configured: true });
    }
  });
});
