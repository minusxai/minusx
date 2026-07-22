/**
 * compatibility.json-backed model curation (client + server safe — static
 * JSON, no secrets, no env access). compatibility.json is the shared static
 * contract (also driving setup.sh and the docs tables); this module is the
 * single reader for its LLM model curation: one default model per provider
 * per grade — what an "Auto" grade mapping (a registry mapping stored with no
 * `model`) resolves to, badged as `default` in the admin model picker.
 */
import compatibility from '@/compatibility.json';
import type { LlmGrade } from './llm-config-types';

export interface CompatProviderSpec {
  id: string;
  name: string;
  /** The grade's default model — the "Auto" pick. */
  defaults?: Partial<Record<LlmGrade, string>>;
}

export const COMPAT_PROVIDERS = compatibility.llm.providers as CompatProviderSpec[];

/** The model an Auto mapping resolves to for (provider, grade), if compatibility.json declares one. */
export function compatDefaultModel(provider: string, grade: LlmGrade): string | undefined {
  return COMPAT_PROVIDERS.find(p => p.id === provider)?.defaults?.[grade];
}
