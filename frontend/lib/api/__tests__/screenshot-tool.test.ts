// @vitest-environment jsdom
// The Screenshot frontend tool: captures the current file's rendered DOM and returns it as an
// image_url content block, going through the SAME upload path (uploadBlobOrEmbed) the chart
// attachments use. Capture + upload are mocked (no real DOM render / network).
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/screenshot/capture', () => ({
  captureFileViewBlob: vi.fn(async () => new Blob(['img'], { type: 'image/jpeg' })),
}));
vi.mock('@/lib/object-store/client', () => ({
  uploadBlobOrEmbed: vi.fn(async () => 'https://cdn.example/screenshot.jpg'),
}));

import { captureFileViewBlob } from '@/lib/screenshot/capture';
import { uploadBlobOrEmbed } from '@/lib/object-store/client';
import { executeToolCall } from '../tool-handlers';

const call = (args: Record<string, unknown>) =>
  ({ id: 'c1', type: 'function', function: { name: 'Screenshot', arguments: args } }) as never;
const exec = (args: Record<string, unknown>, colorMode: 'light' | 'dark') =>
  executeToolCall(call(args), undefined, undefined, { ui: { colorMode } } as never, undefined);

describe('Screenshot tool (frontend bridge)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('captures the file with the current colorMode and returns an image_url block via the shared upload path', async () => {
    const res = await exec({ fileId: 42 }, 'dark');
    expect(captureFileViewBlob).toHaveBeenCalledWith(42, expect.objectContaining({ colorMode: 'dark' }));
    expect(uploadBlobOrEmbed).toHaveBeenCalledWith(expect.any(Blob), 'screenshot.jpg', 'image/jpeg');
    const content = res.content as Array<{ type: string; image_url?: { url: string } }>;
    const img = content.find(b => b.type === 'image_url');
    expect(img?.image_url?.url).toBe('https://cdn.example/screenshot.jpg');
    // also in details (UI-only, survives the turn) so the chat image doesn't vanish on reload
    expect((res.details as { screenshotUrl?: string }).screenshotUrl).toBe('https://cdn.example/screenshot.jpg');
  });

  it('passes fullHeight through to the capture', async () => {
    await exec({ fileId: 7, fullHeight: true }, 'light');
    expect(captureFileViewBlob).toHaveBeenCalledWith(7, expect.objectContaining({ fullHeight: true, colorMode: 'light' }));
  });

  it('returns an error message (does not throw) when the file is not rendered', async () => {
    (captureFileViewBlob as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('FileView with id 99 not found'));
    const res = await exec({ fileId: 99 }, 'light');
    const text = Array.isArray(res.content) ? (res.content[0] as { text: string }).text : String(res.content);
    expect(text).toMatch(/not found|Could not capture/);
  });
});
