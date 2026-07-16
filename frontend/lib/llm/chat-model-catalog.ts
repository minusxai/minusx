import {
  CUSTOM_PROVIDER,
  MINUSX_PROVIDER,
  type ChatModelCatalog,
  type ChatModelOption,
  type LlmConfig,
  type LlmProviderEntry,
} from './llm-config-types';
import { COMPAT_PROVIDERS, compatDefaultModel, filterAllowedModels } from './compat-models';

export interface ChatModelRegistryProvider {
  slug: string;
  models: { id: string; name: string }[];
}

function providerTypeLabel(slug: string): string {
  if (slug === MINUSX_PROVIDER) return 'MinusX';
  if (slug === CUSTOM_PROVIDER) return 'Custom';
  return COMPAT_PROVIDERS.find((provider) => provider.id === slug)?.name ?? slug;
}

function providerLabel(entry: LlmProviderEntry): string {
  const typeLabel = providerTypeLabel(entry.provider);
  return entry.name && entry.name !== entry.provider ? `${entry.name} (${typeLabel})` : typeLabel;
}

function registryModelsFor(
  entry: LlmProviderEntry,
  registry: ChatModelRegistryProvider[],
): ChatModelOption[] {
  const models = registry.find((provider) => provider.slug === entry.provider)?.models ?? [];
  return filterAllowedModels(entry, models).map((model) => ({
    providerName: entry.name,
    providerLabel: providerLabel(entry),
    model: model.id,
    modelLabel: model.name || model.id,
  }));
}

function findModelLabel(provider: string, model: string, registry: ChatModelRegistryProvider[]): string {
  return registry.find((item) => item.slug === provider)?.models.find((item) => item.id === model)?.name ?? model;
}

/**
 * Project workspace LLM configuration into the safe, finite set a chat user
 * may pick. Credentials, URLs, call options, and custom model metadata never
 * enter the returned value.
 */
export function buildChatModelCatalog(
  llm: LlmConfig | undefined,
  registry: ChatModelRegistryProvider[],
): ChatModelCatalog {
  const providers = llm?.providers ?? [];
  const analystChoice = llm?.assignments?.analyst?.chain?.[0];
  const configuredDefaultProvider = analystChoice
    ? providers.find((provider) => provider.name === analystChoice.providerName)
    : providers.find((provider) => provider.provider === MINUSX_PROVIDER);

  let defaultModel: ChatModelOption;
  if (configuredDefaultProvider) {
    const model = analystChoice?.model
      ?? (configuredDefaultProvider.provider === MINUSX_PROVIDER
        ? undefined
        : compatDefaultModel(configuredDefaultProvider.provider, 'analyst'));
    defaultModel = {
      providerName: configuredDefaultProvider.name,
      providerLabel: providerLabel(configuredDefaultProvider),
      ...(model ? { model } : {}),
      modelLabel: model ? findModelLabel(configuredDefaultProvider.provider, model, registry) : 'Auto',
    };
  } else {
    defaultModel = { providerName: MINUSX_PROVIDER, providerLabel: 'MinusX', modelLabel: 'Auto' };
  }

  const models: ChatModelOption[] = [];
  for (const entry of providers) {
    if (entry.provider === MINUSX_PROVIDER) {
      models.push({ providerName: entry.name, providerLabel: providerLabel(entry), modelLabel: 'Auto' });
      continue;
    }
    if (entry.provider === CUSTOM_PROVIDER) {
      const configured = llm?.assignments?.analyst?.chain?.find((choice) => choice.providerName === entry.name);
      if (configured?.model) {
        models.push({
          providerName: entry.name,
          providerLabel: providerLabel(entry),
          model: configured.model,
          modelLabel: configured.model,
        });
      }
      continue;
    }
    models.push(...registryModelsFor(entry, registry));
  }

  return { defaultModel, models };
}
