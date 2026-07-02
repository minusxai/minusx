/**
 * Piece 3 of the rubric architecture: the single "run both" entrypoint. Runs the deterministic
 * scorer AND the LLM judge and returns their combined report. This is what the UI panel and the
 * screenshot-tool path call; the deterministic-only path (piece 1) stays in `registry.ts`.
 *
 * See `frontend/docs/rubrik.md`.
 */
import 'server-only';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';
import type { RubricFileType, RubricReport } from './types';
import { scoreFileDeterministic } from './registry';
import { judgeFile, combineReports } from './judge/judge.server';

/**
 * Deterministic + LLM judge, combined. `screenshotUrl` (https or `data:`) lets the judge grade
 * the rendered visual; without it the judge falls back to markup-only.
 */
export async function scoreFileFull(
  fileType: RubricFileType,
  content: unknown,
  user: EffectiveUser,
  screenshotUrl?: string,
): Promise<RubricReport> {
  const deterministic = scoreFileDeterministic(fileType, content);
  const judge = await judgeFile({ fileType, content, screenshotUrl }, user);
  return combineReports(deterministic, judge);
}
