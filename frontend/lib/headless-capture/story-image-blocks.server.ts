/**
 * Story captures for headless (clientless) turns — the §6c integration function.
 *
 * WHY THIS SEAM: in the browser, the agent "sees" a story because every send attaches an
 * app-state screenshot (`lib/screenshot/app-state-screenshot.ts` overlays
 * `fileState.image = { key, url }` onto the file app state) and tool reads attach rendered
 * images as `{ type: 'image_url', image_url: { url } }` content blocks
 * (`lib/tools/handlers/chart-images.ts`). Headless turns have neither: Slack's app_state is
 * `{ type: 'slack' }` (no fileState to hang an image on — `lib/integrations/slack/context.ts`),
 * so the app-state attachment point genuinely does not exist there. The smallest correct call
 * site is therefore the server `ReadFiles` tool (`agents/analyst/file-tools.ts`, registered for
 * every headless run via `HEADLESS_TOOL_SWAPS` in `lib/chat/orchestration-core.server.ts` —
 * Slack, reports, eval, benchmarks): whenever a headless turn's conversation references a story
 * file through ReadFiles, this helper captures it via `renderStoryToImage` and returns image
 * blocks in the exact shape the browser-side handlers attach.
 *
 * Strictly additive: capability unavailable (flag off / no Chromium) ⇒ `[]` ⇒ byte-identical
 * to today's behavior. Never throws.
 */
import 'server-only';
import { AUTH_URL } from '@/lib/config';
import { renderStoryToImage } from './index.server';

/** Cap per tool call — each capture is a headless page load (mirrors the browser-side cap idea). */
export const MAX_STORY_IMAGE_BLOCKS = 2;

/** Structural subset of (Compressed)AugmentedFile that this helper needs. */
export interface StoryFileLike {
  fileState: { id: number; type: string };
}

/**
 * Orchestrator-native image block (`ImageContent`, orchestrator/llm) — the server-tool
 * equivalent of the browser handlers' `image_url` blocks (`lib/tools/handlers/chart-images.ts`);
 * exactly one of data/url is set, and we inline base64 (v2 sends images inline — no upload).
 */
export type StoryImageBlock = { type: 'image'; data: string; mimeType: string };

/** Injectable capture seam so tests drive the contract without a browser. */
export const _internal = { render: renderStoryToImage };

export async function renderStoryImageBlocks(
  files: StoryFileLike[],
  opts?: { userEmail?: string; baseUrl?: string },
): Promise<StoryImageBlock[]> {
  const stories = files.filter((f) => f.fileState?.type === 'story').slice(0, MAX_STORY_IMAGE_BLOCKS);
  if (stories.length === 0) return [];
  const blocks: StoryImageBlock[] = [];
  for (const story of stories) {
    // Sequential on purpose: the backend's semaphore bounds concurrency anyway, and one story
    // at a time keeps the headless browser's memory burst small.
    try {
      const result = await _internal.render({
        fileId: story.fileState.id,
        baseUrl: opts?.baseUrl ?? AUTH_URL,
        userEmail: opts?.userEmail,
      });
      if (result.ok) {
        blocks.push({ type: 'image', data: result.buffer.toString('base64'), mimeType: result.mime });
      }
    } catch {
      // A broken capture must never break the tool call — degrade to no image.
    }
  }
  return blocks;
}
