/**
 * Screenshot — capture the LIVE rendered DOM of the current file as an image the agent can
 * see. Frontend-only (needs the browser DOM). Reuses the shared capture core + the SAME upload
 * path (S3 / base64 / local FS, per config) as the auto chart-image attachments.
 */
import type { ScreenshotDetails } from '@/lib/types';
import { selectMergedContent } from '@/store/filesSlice';
import { getStore } from '@/store/store';
import { captureFileViewBlob } from '@/lib/screenshot/capture';
import { waitForFileViewReady } from '@/lib/screenshot/readiness';
import { toAgentRubric } from '@/lib/rubric/scoring';
import { AGENT_IMAGE_MAX_PX } from '@/lib/screenshot/constants';
import { uploadBlobOrEmbed } from '@/lib/object-store/client';
import { FilesAPI } from '@/lib/data/files';
import type { FrontendToolHandler } from './types';

/**
 * Fetch the COMBINED health rubric (deterministic + LLM visual judge) for a freshly-captured
 * screenshot and format it as a compact text block appended to the Screenshot result. Best-effort:
 * a non-rubric file type or any failure yields '' (the screenshot still returns normally).
 */
async function fetchScreenshotRubric(fileId: number, screenshotUrl: string, content?: unknown): Promise<string> {
  try {
    // Send the merged (live-edited) content so the rubric grades what the screenshot shows,
    // not the stale saved snapshot the server would otherwise load.
    const { report } = await FilesAPI.getRubric(fileId, { screenshotUrl, content });
    return report ? `\n\nHealth rubric (deterministic + visual judge):\n${JSON.stringify(toAgentRubric(report))}` : '';
  } catch {
    return '';
  }
}

export const screenshotHandler: FrontendToolHandler = async (args, context) => {
  const fileId = Number(args.fileId);
  const fullHeight = !!args.fullHeight;
  const colorMode: 'light' | 'dark' = context.state?.ui?.colorMode === 'dark' ? 'dark' : 'light';
  try {
    // Yield once so the chat's "Capturing" tool state can paint before the capture runs —
    // the capture is synchronous main-thread work (DOM clone + rasterize) that briefly freezes the UI.
    await new Promise((r) => setTimeout(r, 0));
    // Render→capture handshake: after an EditFile the view is often mid-rebuild (story iframe
    // remounting, embed queries re-running). Capturing immediately rasterizes the OLD/half-built
    // view — the agent then believes its edit didn't land. Wait for the view to settle (bounded;
    // a stuck query degrades to a screenshot of its spinner rather than hanging the tool).
    await waitForFileViewReady(fileId, { timeoutMs: 12000 });
    const blob = await captureFileViewBlob(fileId, { colorMode, fullHeight, maxWidth: AGENT_IMAGE_MAX_PX, format: 'jpeg' });
    const url = await uploadBlobOrEmbed(blob, 'screenshot.jpg', 'image/jpeg');
    // Piece 2: every screenshot also carries the file's COMBINED health rubric (deterministic +
    // LLM visual judge on THIS screenshot). Best-effort — a rubric failure never blocks the shot.
    // Grade the SAME merged content the screenshot rendered (includes this turn's unsaved edits),
    // read fresh from the live store so it matches the just-captured DOM.
    const merged = selectMergedContent(getStore().getState(), fileId);
    const rubricText = await fetchScreenshotRubric(fileId, url, merged);
    return {
      content: [
        { type: 'text', text: `Screenshot of file ${fileId} (rendered view).${rubricText}` },
        { type: 'image_url', image_url: { url } },
      ],
      // screenshotUrl rides in `details` (UI-only, survives the turn) so the chat image
      // doesn't vanish when the persisted content is reloaded in a different shape.
      details: { success: true, screenshotUrl: url } as ScreenshotDetails,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: 'text', text: `Could not capture a screenshot of file ${fileId}: ${message}` }],
      details: { success: false, error: message },
    };
  }
};
