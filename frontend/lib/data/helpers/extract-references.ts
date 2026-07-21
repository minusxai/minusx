import { BaseFileContent, FileType } from '@/lib/types';
import { extractSavedQuestionIds } from '@/lib/data/story/story-question';
import { extractNumberQuestionIds } from '@/lib/data/story/story-number';
import { extractJsxEmbedIds } from '@/lib/data/story/story-v2';

/**
 * CLIENT-SIDE: Extract reference IDs from content for caching in references column
 * Returns array of file IDs that this file references
 *
 * Phase 6: Moved from server to client - server should be dumb and just save what it receives
 */
export function extractReferencesFromContent(content: BaseFileContent, type: FileType): number[] {
  // A story's body is the single source of truth: its saved-question dependencies are the
  // `data-question-id` (chart embeds) and `data-number-id` (<Number id> figures) in content.story.
  // Inline `<Question query>` / `<Number query>` carry no file id, so they are not references.
  if (type === 'story') {
    const c = content as { story?: string | null; format?: string | null } | null;
    // New-format (`format:'jsx'`) stories store the JSX source verbatim — ids come from the
    // parsed AST (<Question id={N}/> / <Number id={N}/>), not the legacy placeholder HTML.
    if (c?.format === 'jsx') return extractJsxEmbedIds(c.story);
    return [...new Set([...extractSavedQuestionIds(c?.story), ...extractNumberQuestionIds(c?.story)])];
  }

  // Dashboards have no body — their content IS the ordered `assets` (tiles), so question
  // dependencies come from the assets manifest.
  if (type === 'dashboard') {
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

  return [];
}
