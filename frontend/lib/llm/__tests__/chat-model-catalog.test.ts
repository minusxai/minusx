import { describe, expect, it } from 'vitest';
import type { LlmConfig } from '../llm-config-types';
import { buildChatModelCatalog } from '../chat-model-catalog';

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

describe('buildChatModelCatalog', () => {
  it('shows every configured provider but only its allowed models', () => {
    const llm: LlmConfig = {
      providers: [
        { name: 'claude-team', provider: 'anthropic', allowedModels: ['claude-sonnet-4-6', 'claude-opus-4-8'] },
        { name: 'openai-team', provider: 'openai', allowedModels: ['gpt-5.4'] },
      ],
      assignments: {
        analyst: { chain: [{ providerName: 'claude-team', model: 'claude-sonnet-4-6' }] },
      },
    };

    const result = buildChatModelCatalog(llm, registry);

    expect(result.defaultModel).toMatchObject({
      providerName: 'claude-team',
      providerLabel: 'claude-team (Anthropic)',
      model: 'claude-sonnet-4-6',
      modelLabel: 'Claude Sonnet 4.6',
    });
    expect(result.models.map(({ providerName, model }) => `${providerName}/${model}`)).toEqual([
      'claude-team/claude-sonnet-4-6',
      'claude-team/claude-opus-4-8',
      'openai-team/gpt-5.4',
    ]);
  });

  it('offers the configured custom model and keeps endpoint metadata private', () => {
    const llm: LlmConfig = {
      providers: [{ name: 'local', provider: 'custom', baseUrl: 'http://private.internal/v1', apiKey: 'secret' }],
      assignments: {
        analyst: { chain: [{ providerName: 'local', model: 'qwen3:32b', customModel: { contextWindow: 32_000 } }] },
      },
    };

    const result = buildChatModelCatalog(llm, registry);
    expect(result.models).toEqual([{
      providerName: 'local', providerLabel: 'local (Custom)',
      model: 'qwen3:32b', modelLabel: 'qwen3:32b',
    }]);
    expect(JSON.stringify(result)).not.toContain('private.internal');
    expect(JSON.stringify(result)).not.toContain('secret');
    expect(JSON.stringify(result)).not.toContain('contextWindow');
  });

  it('describes the managed MinusX default for an unconfigured workspace', () => {
    expect(buildChatModelCatalog(undefined, registry)).toEqual({
      defaultModel: { providerName: 'minusx', providerLabel: 'MinusX', modelLabel: 'Auto' },
      models: [],
    });
  });
});
