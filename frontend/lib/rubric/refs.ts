/**
 * The saved-question file ids a rubric file references — dashboard tiles and story embeds show a
 * chart whose TYPE lives on the referenced question, not in this file's content. Both the client
 * badge (resolves types from Redux) and the server scorers (resolve via loadFile) need the same id
 * list, so it lives here as one pure function to keep them from drifting.
 */
import { extractSavedQuestionIds } from '@/lib/data/story-question';
import type { DashboardContent, StoryContent } from '@/lib/types';
import type { DeterministicContext } from './types';

export function referencedQuestionIds(fileType: string, content: unknown): number[] {
  if (fileType === 'dashboard') {
    return ((content as DashboardContent | null)?.assets ?? []).filter((a) => a.type === 'question').map((a) => a.id);
  }
  if (fileType === 'story') {
    return extractSavedQuestionIds((content as StoryContent | null)?.story);
  }
  return [];
}

/**
 * Assemble the `DeterministicContext` (referenced-question viz types) the SAME way for every
 * scoring path — client badge, screenshot, CheckFileHealth tool, rubric route, and the auto-inject
 * file-read/appstate path. The id set is ALWAYS `referencedQuestionIds`; only the `vizTypeOf`
 * lookup source differs (Redux `selectFile` on the client, `loadFile` on the server, the resolved
 * `refs` map for auto-inject). Keeping the derivation here is what guarantees the deterministic
 * report can't differ between paths.
 */
export function buildVizTypeCtx(
  fileType: string,
  content: unknown,
  vizTypeOf: (id: number) => string | undefined,
): DeterministicContext | undefined {
  const ids = referencedQuestionIds(fileType, content);
  if (ids.length === 0) return undefined;
  const vizTypeByQuestionId: Record<number, string> = {};
  for (const id of ids) {
    const vt = vizTypeOf(id);
    if (vt) vizTypeByQuestionId[id] = vt;
  }
  return { vizTypeByQuestionId };
}
