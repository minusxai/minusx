/**
 * Semantic model resolution — mirrors how docs/metrics resolve from a context:
 * inherited models (loader-computed `fullSemanticModels`) + the user's
 * published (or explicitly selected) version's own `semanticModels`.
 * Shared by the useContext hook (Semantic tab gating) and any server callers.
 */

import type { ContextContent, SemanticModel } from '@/lib/types';
import { getPublishedVersionForUser } from '@/lib/context/context-utils';

/** All semantic models a context exposes (inherited + own), deduped by name (own wins). */
export function resolveSemanticModels(
  contextContent: ContextContent,
  userId: number,
  version?: number,
): SemanticModel[] {
  const selectedVersionNumber = version ?? getPublishedVersionForUser(contextContent, userId);
  const selectedVersion = contextContent.versions?.find((v) => v.version === selectedVersionNumber);

  const byName = new Map<string, SemanticModel>();
  for (const model of contextContent.fullSemanticModels ?? []) byName.set(model.name, model);
  for (const model of selectedVersion?.semanticModels ?? []) byName.set(model.name, model);
  return [...byName.values()];
}

/** Models scoped to one connection (the Semantic tab only shows these). */
export function semanticModelsForConnection(models: SemanticModel[], connectionName: string | undefined): SemanticModel[] {
  if (!connectionName) return [];
  return models.filter((m) => m.connection === connectionName);
}
