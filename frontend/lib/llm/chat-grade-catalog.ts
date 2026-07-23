/**
 * Grade catalog for the chat picker: projects workspace LLM configuration
 * into the safe, finite set of GRADES a chat user may pick (bounded by the
 * analyst agent's grade policy). GRADES ONLY — provider names, model ids,
 * credentials, URLs, and options are behind-the-scenes concerns that never
 * enter the returned value.
 */
import {
  LLM_GRADES,
  findLlmProvider,
  findMinusxProvider,
  hasLlmEndpoints,
  resolveAgentPolicy,
  type ChatGradeCatalog,
  type ChatGradeOption,
  type LlmConfig,
  type LlmGrade,
} from './llm-config-types';
import { autoGradeProvider } from './compat-models';

function gradeOption(llm: LlmConfig | undefined, grade: LlmGrade): ChatGradeOption {
  // Configured = picking this grade resolves to SOME model. Mirrors the
  // resolver's ladder exactly (lib/llm/llm-plan.server.ts) — an explicit
  // mapping with a live provider, a minusx provider (the gateway routes every
  // grade), the sole BYOK provider run as Auto, or — with no endpoint
  // configured at all — the managed gateway default.
  const choice = llm?.grades?.[grade];
  const configured = !hasLlmEndpoints(llm)
    || (!!choice && !!findLlmProvider(llm, choice.providerName))
    || !!findMinusxProvider(llm)
    || !!autoGradeProvider(llm, grade);
  return { grade, configured };
}

/**
 * Build the grade picker payload from the org config. The grade list and
 * default come from the ANALYST policy — the picker fronts the interactive
 * chat agents, which all ride analyst-family policies.
 */
export function buildChatGradeCatalog(llm: LlmConfig | undefined): ChatGradeCatalog {
  const policy = resolveAgentPolicy(llm, 'analyst');
  const grades = LLM_GRADES
    .filter((grade) => policy.allowedGrades.includes(grade))
    .map((grade) => gradeOption(llm, grade));
  return { defaultGrade: policy.defaultGrade, grades };
}
