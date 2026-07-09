/**
 * Shared review core for EditFile / CreateFile / ReviewFile (rubric v2).
 *
 * A "full review" is: capture the LIVE rendered view of the file → run the combined rubric
 * (deterministic rules + LLM visual judge on that screenshot) → return the lean agent rubric
 * plus the screenshot URL. When the file's view isn't mounted (background draft / background
 * edit) the capture fails and we degrade to the client-side DETERMINISTIC rubric — never to
 * nothing. Everything here is best-effort: a review failure must never fail the edit/create
 * that triggered it.
 */
import { selectFile, selectMergedContent } from '@/store/filesSlice';
import { getStore } from '@/store/store';
import { captureFileViewBlob } from '@/lib/screenshot/capture';
import { waitForFileViewReady } from '@/lib/screenshot/readiness';
import { AGENT_IMAGE_MAX_PX } from '@/lib/screenshot/constants';
import { uploadBlobOrEmbed } from '@/lib/object-store/client';
import { FilesAPI } from '@/lib/data/files';
import { isRubricFileType, scoreFileDeterministic } from '@/lib/rubric/registry';
import { buildVizTypeCtx } from '@/lib/rubric/refs';
import { toAgentRubric } from '@/lib/rubric/scoring';
import type { AgentRubric } from '@/lib/rubric/types';
import type { QuestionContent } from '@/lib/types';

export interface FileReview {
  rubric?: AgentRubric;
  /** Present only for a full review (the view was mounted and captured). */
  screenshotUrl?: string;
  /** 'full' = screenshot + deterministic + LLM visual judge; 'deterministic' = rules only
   *  (no rendered view available, e.g. a background draft). */
  reviewMode: 'full' | 'deterministic';
}

/**
 * Client-side deterministic rubric for a file's CURRENT merged content. Referenced questions'
 * viz types are resolved from Redux (same shared assembler as the badge / server scorers).
 * Returns undefined for non-rubric types or on any scoring failure.
 */
export function deterministicAgentRubric(fileId: number): AgentRubric | undefined {
  const state = getStore().getState();
  const type = selectFile(state, fileId)?.type;
  const content = selectMergedContent(state, fileId);
  if (!type || !isRubricFileType(type) || !content) return undefined;
  const ctx = buildVizTypeCtx(type, content, (id) => (selectFile(state, id)?.content as QuestionContent | undefined)?.vizSettings?.type);
  try {
    return toAgentRubric(scoreFileDeterministic(type, content, ctx));
  } catch {
    return undefined;
  }
}

/** Wait for the file's view to settle, capture it, and upload — throws when the view isn't mounted. */
export async function captureFileScreenshot(
  fileId: number,
  opts: { colorMode: 'light' | 'dark'; fullHeight?: boolean },
): Promise<string> {
  // Yield once so the chat's tool state can paint before the capture runs — the capture is
  // synchronous main-thread work (DOM clone + rasterize) that briefly freezes the UI.
  await new Promise((r) => setTimeout(r, 0));
  // Render→capture handshake: after an edit the view is often mid-rebuild (story iframe
  // remounting, embed queries re-running). Wait for it to settle (bounded; a stuck query
  // degrades to a screenshot of its spinner rather than hanging the tool).
  await waitForFileViewReady(fileId, { timeoutMs: 12000 });
  const blob = await captureFileViewBlob(fileId, { colorMode: opts.colorMode, fullHeight: !!opts.fullHeight, maxWidth: AGENT_IMAGE_MAX_PX, format: 'jpeg' });
  return uploadBlobOrEmbed(blob, 'screenshot.jpg', 'image/jpeg');
}

/**
 * Full review of a file: screenshot (when its view is mounted) + combined rubric via the
 * rubric API (deterministic + LLM visual judge, graded on the MERGED live-edited content so
 * it matches what the screenshot shows). Degrades to the deterministic rubric when the view
 * can't be captured or the API fails. Never throws.
 */
export async function reviewFile(
  fileId: number,
  opts: { colorMode: 'light' | 'dark'; fullHeight?: boolean },
): Promise<FileReview> {
  const type = selectFile(getStore().getState(), fileId)?.type;
  if (!type || !isRubricFileType(type)) return { reviewMode: 'deterministic' };

  let screenshotUrl: string | undefined;
  try {
    screenshotUrl = await captureFileScreenshot(fileId, opts);
  } catch {
    // View not mounted (background draft/edit) or capture failed — rules-only review below.
  }

  if (screenshotUrl) {
    try {
      const merged = selectMergedContent(getStore().getState(), fileId);
      const { report } = await FilesAPI.getRubric(fileId, { screenshotUrl, content: merged });
      if (report) return { rubric: toAgentRubric(report), screenshotUrl, reviewMode: 'full' };
    } catch {
      // Judge/API failure — fall through to deterministic, but keep the screenshot.
    }
  }
  return { rubric: deterministicAgentRubric(fileId), screenshotUrl, reviewMode: 'deterministic' };
}
