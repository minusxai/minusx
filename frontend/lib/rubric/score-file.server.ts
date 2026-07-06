/**
 * Piece 3 of the rubric architecture: the single "run both" entrypoint. Runs the deterministic
 * scorer AND the LLM judge and returns their combined report. This is what the UI panel and the
 * screenshot-tool path call; the deterministic-only path (piece 1) stays in `registry.ts`.
 *
 * See `frontend/docs/rubrik.md`.
 */
import 'server-only';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';
import { loadFile } from '@/lib/data/files.server';
import type { QuestionContent } from '@/lib/types';
import type { DeterministicContext, RubricFileType, RubricReport } from './types';
import { scoreFileDeterministic } from './registry';
import { buildVizTypeCtx, referencedQuestionIds } from './refs';
import { scoreFileLLM, combineReports } from './llm/score-llm.server';

/**
 * Resolve each referenced question's chart type into a `DeterministicContext` — the server twin of
 * the client badge's Redux lookup. Without this, a dashboard/story scored on the server is blind to
 * its embeds' viz types, so type-aware rules (`embed-too-narrow`, `plot-too-small`) silently don't
 * fire — making the SAME deterministic report differ from the client's. Best-effort: a missing /
 * inaccessible referenced file is skipped, never throws.
 */
async function resolveVizTypeCtx(
  fileType: RubricFileType,
  content: unknown,
  user: EffectiveUser,
): Promise<DeterministicContext | undefined> {
  const ids = referencedQuestionIds(fileType, content);
  if (ids.length === 0) return undefined;
  // Load each referenced question's viz type into a map, then assemble via the shared builder so
  // the id derivation is identical to every other path (only the lookup source is server-specific).
  const entries = await Promise.all(ids.map(async (id): Promise<readonly [number, string | undefined]> => {
    try {
      const { data } = await loadFile(id, user);
      return [id, (data?.content as QuestionContent | undefined)?.vizSettings?.type];
    } catch {
      return [id, undefined]; // referenced file gone or no access — that embed's type stays unknown
    }
  }));
  const byId = new Map(entries);
  return buildVizTypeCtx(fileType, content, (id) => byId.get(id));
}

/** Deterministic report with referenced viz types resolved server-side (mirrors the client badge). */
export async function scoreFileDeterministicResolved(
  fileType: RubricFileType,
  content: unknown,
  user: EffectiveUser,
): Promise<RubricReport> {
  return scoreFileDeterministic(fileType, content, await resolveVizTypeCtx(fileType, content, user));
}

/**
 * Deterministic + LLM judge, combined. `screenshotUrl` (https or `data:`) lets the judge grade
 * the rendered visual; without it the judge falls back to markup-only. The deterministic half
 * resolves referenced viz types so it matches the client badge exactly (running the judge never
 * changes a deterministic finding).
 */
export async function scoreFile(
  fileType: RubricFileType,
  content: unknown,
  user: EffectiveUser,
  screenshotUrl?: string,
): Promise<RubricReport> {
  const deterministic = scoreFileDeterministic(fileType, content, await resolveVizTypeCtx(fileType, content, user));
  const llm = await scoreFileLLM({ fileType, content, screenshotUrl }, user);
  return combineReports(deterministic, llm);
}
