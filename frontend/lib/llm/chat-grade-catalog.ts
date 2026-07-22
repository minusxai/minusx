/**
 * Grade catalog for the chat picker: projects workspace LLM configuration
 * into the safe, finite set of GRADES a chat user may pick (bounded by the
 * analyst agent's grade policy). Credentials, URLs, call options, and custom
 * model metadata never enter the returned value.
 */
import {
  CUSTOM_PROVIDER,
  LLM_GRADES,
  MINUSX_PROVIDER,
  findLlmProvider,
  findMinusxProvider,
  resolveAgentPolicy,
  type ChatGradeCatalog,
  type ChatGradeOption,
  type LlmConfig,
  type LlmGrade,
  type LlmProviderEntry,
} from './llm-config-types';
import { COMPAT_PROVIDERS, compatDefaultModel } from './compat-models';

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

function findModelLabel(provider: string, model: string, registry: ChatModelRegistryProvider[]): string {
  return registry.find((item) => item.slug === provider)?.models.find((item) => item.id === model)?.name ?? model;
}

function gradeOption(
  llm: LlmConfig | undefined,
  grade: LlmGrade,
  registry: ChatModelRegistryProvider[],
): ChatGradeOption {
  const choice = llm?.grades?.[grade];
  const entry = choice ? findLlmProvider(llm, choice.providerName) : undefined;
  if (choice && entry) {
    if (entry.provider === MINUSX_PROVIDER) {
      return { grade, providerLabel: providerLabel(entry), modelLabel: 'Auto', configured: true };
    }
    // Model-less registry mapping = Auto: the compat default for this grade.
    const model = choice.model ?? (entry.provider === CUSTOM_PROVIDER ? undefined : compatDefaultModel(entry.provider, grade));
    return {
      grade,
      providerLabel: providerLabel(entry),
      modelLabel: model ? findModelLabel(entry.provider, model, registry) : 'Auto',
      configured: true,
    };
  }
  // Unmapped: a configured minusx provider handles every grade; an
  // unconfigured WORKSPACE (no llm section) rides the managed gateway.
  const minusx = llm ? findMinusxProvider(llm) : undefined;
  if (minusx) return { grade, providerLabel: providerLabel(minusx), modelLabel: 'Auto', configured: true };
  if (!llm) return { grade, providerLabel: 'MinusX', modelLabel: 'Auto', configured: true };
  return { grade, modelLabel: 'Not configured', configured: false };
}

/**
 * Build the grade picker payload from the org config + model registry. The
 * grade list and default come from the ANALYST policy — the picker fronts the
 * interactive chat agents, which all ride analyst-family policies.
 */
export function buildChatGradeCatalog(
  llm: LlmConfig | undefined,
  registry: ChatModelRegistryProvider[],
): ChatGradeCatalog {
  const policy = resolveAgentPolicy(llm, 'analyst');
  const grades = LLM_GRADES
    .filter((grade) => policy.allowedGrades.includes(grade))
    .map((grade) => gradeOption(llm, grade, registry));
  return { defaultGrade: policy.defaultGrade, grades };
}
