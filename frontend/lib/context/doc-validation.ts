import type { DocEntry } from '@/lib/types';

/**
 * Whether a context doc entry is missing required metadata.
 *
 * The analytics agent only ever sees each doc's title + description (it loads the
 * full body on demand via LoadContext), so an *active* doc must have both. Drafts
 * are work-in-progress and excluded from the agent, so they're exempt; legacy
 * plain-string docs have no meta concept and are ignored.
 */
export function isDocMetaIncomplete(doc: DocEntry | string): boolean {
  if (typeof doc === 'string') return false;
  if (doc.draft) return false;
  return !doc.title?.trim() || !doc.description?.trim();
}

/** True if any active doc in the list is missing its title or description. */
export function anyDocMetaIncomplete(docs: (DocEntry | string)[]): boolean {
  return docs.some(isDocMetaIncomplete);
}
