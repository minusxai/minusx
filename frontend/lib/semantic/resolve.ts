/**
 * Semantic model resolution. Models are DERIVED by the context loader
 * (`fullSemanticModels` — one model per whitelisted table, from schema columns
 * + declared relationships; see lib/semantic/derive.ts). Nothing is authored
 * per version anymore, so resolution is simply what the loader computed.
 * Shared by the useContext hook (Semantic tab gating) and any server callers.
 */

import type { ContextContent, SemanticModel } from '@/lib/types';

/** All semantic models a context exposes (loader-derived). */
export function resolveSemanticModels(contextContent: ContextContent): SemanticModel[] {
  return contextContent.fullSemanticModels ?? [];
}

/** Models scoped to one connection (the Semantic tab only shows these). */
export function semanticModelsForConnection(models: SemanticModel[], connectionName: string | undefined): SemanticModel[] {
  if (!connectionName) return [];
  return models.filter((m) => m.connection === connectionName);
}
