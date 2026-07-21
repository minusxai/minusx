/**
 * renderStoryImageBlocks — the headless-turn integration seam (Story_Design_V2 §6c):
 * story files read in a clientless turn (Slack / benchmarks) get a capture attached as an
 * image_url content block, mirroring how the browser attaches rendered images. Capability
 * unavailable ⇒ [] ⇒ exactly today's behavior.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  renderStoryImageBlocks,
  MAX_STORY_IMAGE_BLOCKS,
  _internal,
} from '@/lib/headless-capture/story-image-blocks.server';
import type { StoryCaptureInput, StoryCaptureResult } from '@/lib/headless-capture/types';

const realRender = _internal.render;

function file(id: number, type: string) {
  return { fileState: { id, type } };
}

beforeEach(() => {
  _internal.render = realRender;
});

describe('renderStoryImageBlocks', () => {
  it('captures each story file and returns orchestrator-native image blocks (base64 inline)', async () => {
    const calls: StoryCaptureInput[] = [];
    _internal.render = vi.fn(async (input: StoryCaptureInput): Promise<StoryCaptureResult> => {
      calls.push(input);
      return { ok: true, buffer: Buffer.from(`img-${input.fileId}`), mime: 'image/jpeg' };
    });

    const blocks = await renderStoryImageBlocks([file(7, 'story'), file(9, 'story')], {
      userEmail: 'user@example.com',
    });

    expect(blocks).toEqual([
      { type: 'image', data: Buffer.from('img-7').toString('base64'), mimeType: 'image/jpeg' },
      { type: 'image', data: Buffer.from('img-9').toString('base64'), mimeType: 'image/jpeg' },
    ]);
    expect(calls.map((c) => c.fileId)).toEqual([7, 9]);
    expect(calls.every((c) => c.userEmail === 'user@example.com')).toBe(true);
    expect(calls.every((c) => typeof c.baseUrl === 'string' && c.baseUrl.length > 0)).toBe(true);
  });

  it('skips non-story files without invoking the capture seam', async () => {
    const render = vi.fn();
    _internal.render = render;

    const blocks = await renderStoryImageBlocks([
      file(1, 'question'),
      file(2, 'dashboard'),
      file(3, 'notebook'),
    ]);

    expect(blocks).toEqual([]);
    expect(render).not.toHaveBeenCalled();
  });

  it('returns [] when the capability is unavailable (graceful degradation)', async () => {
    _internal.render = vi.fn(async (): Promise<StoryCaptureResult> => ({
      ok: false,
      reason: 'unavailable',
    }));

    const blocks = await renderStoryImageBlocks([file(7, 'story')]);

    expect(blocks).toEqual([]);
  });

  it('drops failed captures but keeps successful ones', async () => {
    _internal.render = vi.fn(async (input: StoryCaptureInput): Promise<StoryCaptureResult> =>
      input.fileId === 1
        ? { ok: false, reason: 'error', detail: 'timeout' }
        : { ok: true, buffer: Buffer.from('ok'), mime: 'image/jpeg' },
    );

    const blocks = await renderStoryImageBlocks([file(1, 'story'), file(2, 'story')]);

    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ type: 'image', mimeType: 'image/jpeg' });
  });

  it('never throws even when the seam throws', async () => {
    _internal.render = vi.fn(async () => {
      throw new Error('boom');
    });

    await expect(renderStoryImageBlocks([file(7, 'story')])).resolves.toEqual([]);
  });

  it(`caps captures at MAX_STORY_IMAGE_BLOCKS (${MAX_STORY_IMAGE_BLOCKS})`, async () => {
    const render = vi.fn(async (): Promise<StoryCaptureResult> => ({
      ok: true,
      buffer: Buffer.from('x'),
      mime: 'image/jpeg',
    }));
    _internal.render = render;

    const stories = Array.from({ length: MAX_STORY_IMAGE_BLOCKS + 3 }, (_, i) => file(i + 1, 'story'));
    const blocks = await renderStoryImageBlocks(stories);

    expect(render).toHaveBeenCalledTimes(MAX_STORY_IMAGE_BLOCKS);
    expect(blocks).toHaveLength(MAX_STORY_IMAGE_BLOCKS);
  });
});
