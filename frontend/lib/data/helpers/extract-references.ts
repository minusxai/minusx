import { BaseFileContent, FileType } from '@/lib/types';

/**
 * CLIENT-SIDE: Extract reference IDs from content for caching in references column
 * Returns array of file IDs that this file references
 *
 * Phase 6: Moved from server to client - server should be dumb and just save what it receives
 */
export function extractReferencesFromContent(content: BaseFileContent, type: FileType): number[] {
  // Handle document types that use content.assets (dashboard, presentation, story)
  if (
    type === 'dashboard' ||
    type === 'presentation' ||
    type === 'story'
  ) {
    const assets = (content as any)?.assets || [];
    return assets
      .filter((a: any) => a.type === 'question' && typeof a.id === 'number')
      .map((a: any) => a.id);
  }

  // Notebook SQL cells are inline questions; their cross-file refs are the
  // @-references each cell holds (saved question files composed as CTEs).
  if (type === 'notebook') {
    const cells = (content as any)?.cells || [];
    const ids = cells
      .filter((c: any) => c?.type === 'sql' && Array.isArray(c.references))
      .flatMap((c: any) => c.references)
      .filter((ref: any) => typeof ref?.id === 'number')
      .map((ref: any) => ref.id as number);
    return Array.from(new Set(ids));
  }

  // Handle question references (composed questions)
  if (type === 'question') {
    const references = (content as any)?.references || [];
    return references
      .filter((ref: any) => typeof ref.id === 'number')
      .map((ref: any) => ref.id);
  }

  // Alerts reference a single question via questionId
  if (type === 'alert') {
    const questionId = (content as any)?.questionId;
    return typeof questionId === 'number' && questionId > 0 ? [questionId] : [];
  }

  // Transformations reference questions via transforms[].question
  if (type === 'transformation') {
    const transforms = (content as any)?.transforms || [];
    return transforms
      .filter((t: any) => typeof t.question === 'number' && t.question > 0)
      .map((t: any) => t.question as number);
  }

  return [];
}
