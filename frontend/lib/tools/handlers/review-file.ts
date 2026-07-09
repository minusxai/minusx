/**
 * ReviewFile — review a file WITHOUT editing it: screenshot of the live rendered view +
 * the full health rubric (deterministic errors/warnings + LLM visual judge + score). Same
 * output as an EditFile with no changes. Frontend-only (the capture needs the browser DOM).
 * Replaces the old Screenshot tool (which returned the image + rubric as prose).
 */
import type { ScreenshotDetails } from '@/lib/types';
import { reviewFile } from './file-review';
import type { FrontendToolHandler } from './types';

export const reviewFileHandler: FrontendToolHandler = async (args, context) => {
  const fileId = Number(args.fileId);
  const fullHeight = args.fullHeight !== false; // default true — review the whole file
  const colorMode: 'light' | 'dark' = context.state?.ui?.colorMode === 'dark' ? 'dark' : 'light';
  try {
    const review = await reviewFile(fileId, { colorMode, fullHeight });
    if (!review.screenshotUrl && !review.rubric) {
      const msg = `Could not review file ${fileId}: its view is not open in the browser and it has no rules-based rubric (only question/dashboard/story files are scored).`;
      return { content: [{ type: 'text', text: msg }], details: { success: false, error: msg } };
    }
    const status = {
      success: true,
      ...(review.rubric ? { rubric: review.rubric } : {}),
      ...(review.reviewMode === 'deterministic' && review.rubric
        ? { note: 'Rules-only rubric (the visual judge did not run).' } : {}),
    };
    return {
      content: [
        { type: 'text', text: JSON.stringify(status) },
        ...(review.screenshotUrl ? [{ type: 'image_url', image_url: { url: review.screenshotUrl } }] : []),
      ],
      // screenshotUrl rides in `details` (UI-only, survives the turn) so the chat image
      // doesn't vanish when the persisted content is reloaded in a different shape.
      details: { success: true, screenshotUrl: review.screenshotUrl } as ScreenshotDetails,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: 'text', text: `Could not review file ${fileId}: ${message}` }],
      details: { success: false, error: message },
    };
  }
};
