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
import { captureFileViewWithReadiness } from '@/lib/screenshot/capture';
import type { FileViewReadiness } from '@/lib/screenshot/readiness';
import { AGENT_IMAGE_MAX_PX, AGENT_IMAGE_MAX_H_PX, AGENT_IMAGE_MIN_W_PX } from '@/lib/screenshot/constants';
import { uploadBlobOrEmbed } from '@/lib/object-store/client';
import { FilesAPI } from '@/lib/data/files';
import { isRubricFileType, scoreFileDeterministic } from '@/lib/rubric/registry';
import { buildVizTypeCtx } from '@/lib/rubric/refs';
import { toAgentRubric } from '@/lib/rubric/scoring';
import type { AgentRubric, DeterministicContext, RubricCategory, RubricGrade, RubricSeverity } from '@/lib/rubric/types';
import { inlineQuestionFromEl } from '@/lib/data/story/story-question';
import { envelopeVizType } from '@/lib/viz/viz-templates';
import type { QuestionContent } from '@/lib/types';

export interface FileReview {
  rubric?: AgentRubric;
  /** Present only for a full review (the view was mounted and captured). */
  screenshotUrl?: string;
  /** 'full' = screenshot + deterministic + LLM visual judge; 'deterministic' = rules only
   *  (no rendered view available, e.g. a background draft — or the view never settled). */
  reviewMode: 'full' | 'deterministic';
  /**
   * Set when the screenshot was captured BEFORE the view settled (embed queries still running at
   * the readiness timeout). The note is LLM-facing: without it, the agent reads loading/blank
   * cards as broken embeds and deletes healthy content (the staging overcorrection). When set,
   * the visual judge is skipped — it would grade the same mid-load pixels.
   */
  renderPending?: string;
  /**
   * Set when a step of the review DEGRADED silently — the view couldn't be captured/uploaded, or
   * the visual judge didn't answer in time. Surfaced in the tool status so "no screenshot / rules
   * only" reads as a known failure instead of looking like a clean full review.
   */
  reviewNote?: string;
}

/** The LLM-facing warning attached to a mid-load capture. */
export function renderPendingNote(busyCount: number): string {
  return `Screenshot captured before the view finished rendering — ${busyCount} embed(s) were still ` +
    'loading (queries running). Loading or blank cards in this image reflect CAPTURE TIMING, not ' +
    'broken embeds: do NOT remove, resize, or restyle embeds based on this image. Re-run ReviewFile ' +
    'to get a settled view.';
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

/**
 * MEASURE each story embed's rendered width against the story column, from the live iframe DOM.
 * Real pixels — robust to ANY css (the static rubric scan simulates layout from parseable CSS and
 * is blind to utility-class grids). Best-effort: returns undefined when nothing is measurable
 * (view not mounted, no iframe, non-story file), so callers just omit the measurements.
 */
export function measureStoryEmbeds(fileId: number): DeterministicContext['measuredEmbeds'] {
  try {
    const view = document.querySelector(`[data-file-id="${fileId}"]`);
    const iframe = view?.querySelector('iframe');
    const doc = (iframe as HTMLIFrameElement | null)?.contentDocument;
    if (!doc) return undefined;
    const columnPx = (doc.querySelector('[data-mx-story-root]') ?? doc.body)?.getBoundingClientRect().width ?? 0;
    if (columnPx <= 0) return undefined;
    const state = getStore().getState();
    const out: NonNullable<DeterministicContext['measuredEmbeds']> = [];
    doc.querySelectorAll<HTMLElement>('[data-question-id],[data-question-inline]').forEach((el) => {
      const widthPx = el.getBoundingClientRect().width;
      if (widthPx <= 0) return;
      const savedId = parseInt(el.getAttribute('data-question-id') ?? '', 10);
      const savedContent = Number.isFinite(savedId)
        ? (selectFile(state, savedId)?.content as QuestionContent | undefined)
        : undefined;
      const vizType = Number.isFinite(savedId)
        ? (envelopeVizType(savedContent?.viz) ?? savedContent?.vizSettings?.type)
        : envelopeVizType(inlineQuestionFromEl(el)?.viz);
      out.push({ ...(vizType ? { vizType } : {}), widthPx, columnPx });
    });
    return out.length ? out : undefined;
  } catch {
    return undefined;
  }
}

/** Wait for the file's view to settle, capture it, and upload — throws when the view isn't mounted. */
export async function captureFileScreenshot(
  fileId: number,
  opts: { colorMode: 'light' | 'dark'; fullHeight?: boolean },
): Promise<{ url: string; readiness: FileViewReadiness }> {
  // Yield once so the chat's tool state can paint before the capture runs — the capture is
  // synchronous main-thread work (DOM clone + rasterize) that briefly freezes the UI.
  await new Promise((r) => setTimeout(r, 0));
  // Render→capture handshake: after an edit the view is often mid-rebuild (story iframe
  // remounting, EVERY embed query re-running). The agent path waits longer than the default —
  // a multi-embed story cold-runs several queries and 10s timed out often enough that agents
  // saw loading embeds and deleted them. Still bounded: a stuck query degrades to a screenshot
  // of its spinner, with `readiness.settled === false` telling the caller to say so.
  const { blob, readiness } = await captureFileViewWithReadiness(fileId, {
    colorMode: opts.colorMode, fullHeight: !!opts.fullHeight, maxWidth: AGENT_IMAGE_MAX_PX, format: 'jpeg',
    // A full-height capture of a long story is maxWidth × several-thousand px — thousands of image
    // tokens per edit. Cap the height too (downscales the whole view; never crops). The width floor
    // outranks that cap: past a certain page length the height cap alone squeezes the capture until
    // the judge below is grading text it cannot read.
    maxHeight: AGENT_IMAGE_MAX_H_PX,
    minWidth: AGENT_IMAGE_MIN_W_PX,
    readinessTimeoutMs: 20000,
  });
  return { url: await uploadBlobOrEmbed(blob, 'screenshot.jpg', 'image/jpeg'), readiness };
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
  let readiness: FileViewReadiness | undefined;
  let reviewNote: string | undefined;
  try {
    ({ url: screenshotUrl, readiness } = await captureFileScreenshot(fileId, opts));
  } catch (err) {
    // "not found" = the view isn't mounted (background draft/edit) — the EXPECTED degradation, no
    // note. Anything else (serialization, rasterize, a timed-out upload) is a real failure the
    // agent should see rather than infer from a missing image.
    const message = err instanceof Error ? err.message : String(err);
    if (!/not found/i.test(message)) {
      reviewNote = `Screenshot unavailable for this review (capture/upload failed: ${message}). ` +
        'The rubric below is rules-only — do not assume the rendered view is broken.';
    }
  }

  // Mid-load capture (the readiness wait timed out with embeds still loading): the screenshot
  // shows spinners/blank cards. Do NOT run the visual judge on it — it grades those pixels and
  // its findings feed destructive "fixes". Return the rules rubric + the screenshot WITH an
  // explicit note, so the agent knows the blanks are timing, not breakage.
  if (screenshotUrl && readiness && !readiness.settled) {
    return {
      rubric: deterministicAgentRubric(fileId),
      screenshotUrl,
      reviewMode: 'deterministic',
      renderPending: renderPendingNote(readiness.busyCount),
      ...(reviewNote ? { reviewNote } : {}),
    };
  }

  if (screenshotUrl) {
    try {
      const merged = selectMergedContent(getStore().getState(), fileId);
      // Measure AFTER the capture (the view has settled): real embed widths supersede the
      // static CSS estimate for the width rules.
      const measuredEmbeds = measureStoryEmbeds(fileId);
      const { report } = await FilesAPI.getRubric(fileId, { screenshotUrl, content: merged, ...(measuredEmbeds ? { measuredEmbeds } : {}) });
      if (report) return { rubric: toAgentRubric(report), screenshotUrl, reviewMode: 'full', ...(reviewNote ? { reviewNote } : {}) };
      reviewNote = JUDGE_UNAVAILABLE_NOTE;
    } catch {
      // Judge/API failure or its timeout — fall through to deterministic, but keep the screenshot
      // AND say so: a silently rules-only review looks identical to a clean full review.
      reviewNote = JUDGE_UNAVAILABLE_NOTE;
    }
  }
  return {
    rubric: deterministicAgentRubric(fileId),
    screenshotUrl,
    reviewMode: 'deterministic',
    ...(reviewNote ? { reviewNote } : {}),
  };
}

/** Note attached when the visual judge didn't answer (error or timeout) but the screenshot exists. */
const JUDGE_UNAVAILABLE_NOTE =
  'The LLM visual judge did not complete (error or timeout) — the rubric below is rules-only. ' +
  'Judge the screenshot yourself, or re-run ReviewFile for a graded pass.';

/**
 * The rubric as echoed in a TOOL STATUS: every EditFile appends one permanently to the
 * conversation, so it carries only what the skill loop acts on — `overall`/`grade` to know when to
 * stop, and per finding the id, severity, short title, and the imperative `fix`. The prose fields
 * (`source`) is dropped, and a `warn`'s `fix` is clipped; `error` findings
 * (which gate the score to 0 and MUST be fixed) keep their full instruction.
 */
export interface CompactRubricFinding {
  ruleId: string;
  category: RubricCategory;
  severity: RubricSeverity;
  title: string;
  detail: string;
  fix: string;
}
export interface CompactAgentRubric {
  overall: number;
  grade: RubricGrade;
  categories: Array<{ category: RubricCategory; score: number; findings: CompactRubricFinding[] }>;
}

export function compactAgentRubric(rubric: AgentRubric): CompactAgentRubric {
  const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
  return {
    overall: rubric.overall,
    grade: rubric.grade,
    categories: rubric.categories.map((c) => ({
      category: c.category,
      score: c.score,
      findings: c.findings.map((f) => ({
        ruleId: f.ruleId,
        category: f.category,
        severity: f.severity,
        title: clip(f.title, 120),
        // `title` is a generic label ("Undeclared parameter"); `detail` carries WHICH thing is
        // wrong (":start"), so a clipped detail is what makes a finding locatable — keep it.
        detail: clip(f.detail, 140),
        fix: f.severity === 'error' ? f.fix : clip(f.fix, 200),
      })),
    })),
  };
}
