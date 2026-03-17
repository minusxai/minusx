import { BaseFileContent, FileType } from '@/lib/types';

/**
 * CLIENT-SIDE: Extract reference IDs from content for caching in references column
 * Returns array of file IDs that this file references
 *
 * Phase 6: Moved from server to client - server should be dumb and just save what it receives
 */
export function extractReferencesFromContent(content: BaseFileContent, type: FileType): number[] {
  // Handle document types that use content.items (new) or content.assets (legacy fallback)
  if (
    type === 'dashboard' ||
    type === 'presentation' ||
    type === 'notebook'
  ) {
    // New format: co-located items array
    if (Array.isArray((content as any)?.items)) {
      return ((content as any).items as any[])
        .filter((item: any) => item.type === 'question' && typeof item.id === 'number')
        .map((item: any) => item.id);
    }
    // Legacy fallback: separate assets array
    const assets = (content as any)?.assets || [];
    return assets
      .filter((a: any) => a.type === 'question' && typeof a.id === 'number')
      .map((a: any) => a.id);
  }

  // Reports use content.references with nested reference.id
  if (type === 'report') {
    const references = (content as any)?.references || [];
    return references
      .filter((r: any) => typeof r.reference?.id === 'number')
      .map((r: any) => r.reference.id);
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

  return [];
}
