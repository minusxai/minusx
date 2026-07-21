/**
 * The working-field → version fold for context editing (extracted from
 * ContextContainerV2 so it is pure and unit-tested). Version-scoped fields
 * MUST land inside the selected version: a top-level write bypasses the save
 * gates (views + semantic models) and is invisible to the loader/inheritance.
 */
import type { ContextContent, ContextVersion } from '@/lib/types';

/** Content fields that live ON THE VERSION (not at the content root). */
const VERSION_SCOPED_FIELDS = [
  'docs', 'metrics', 'annotations', 'relationships', 'views', 'semanticModels',
] as const;
type VersionScopedField = (typeof VERSION_SCOPED_FIELDS)[number];

/** True when `updates` touches any version-scoped field (or the whitelist editor shape). */
export function touchesVersionFields(updates: Partial<ContextContent>): boolean {
  return updates.databases !== undefined
    || VERSION_SCOPED_FIELDS.some((f) => (updates as Record<string, unknown>)[f] !== undefined);
}

/**
 * Apply an editor change: version-scoped fields fold into the selected
 * version (stamping lastEdited*); everything else passes through at the
 * content level. `whitelist` (already converted from the editor's databases
 * shape by the caller) is applied when provided.
 */
export function applyContextContentChange(
  base: ContextContent,
  selectedVersion: number,
  updates: Partial<ContextContent>,
  userId: number,
  whitelist?: ContextVersion['whitelist'],
): ContextContent {
  if (!touchesVersionFields(updates)) {
    return { ...base, ...updates } as ContextContent;
  }

  const versions = base.versions?.map((v) => {
    if (v.version !== selectedVersion) return v;
    const next: ContextVersion = {
      ...v,
      ...(whitelist !== undefined ? { whitelist } : {}),
      lastEditedAt: new Date().toISOString(),
      lastEditedBy: userId,
    };
    for (const field of VERSION_SCOPED_FIELDS) {
      const value = (updates as Record<string, unknown>)[field];
      if (value !== undefined) (next as unknown as Record<string, unknown>)[field] = value;
    }
    return next;
  });

  // Only version-scoped keys were folded; strip them (and the editor-shaped
  // `databases`) so they never leak to the content root.
  const rest: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(updates)) {
    if (k === 'databases' || (VERSION_SCOPED_FIELDS as readonly string[]).includes(k)) continue;
    rest[k] = v;
  }
  return { ...base, ...rest, versions } as ContextContent;
}
