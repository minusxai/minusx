// The ReviewFile frontend tool (rubric v2): captures the current file's rendered DOM, runs the
// combined rubric (deterministic + LLM visual judge) via the rubric API, and returns the score
// + findings as the status text with the screenshot as an image_url block — the same review
// EditFile returns after a change. Screenshot is its registered legacy alias (same handler).
// Capture + upload + rubric API are mocked (no real DOM render / network).
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/screenshot/capture', () => ({
  captureFileViewWithReadiness: vi.fn(async () => ({
    blob: new Blob(['img'], { type: 'image/jpeg' }),
    readiness: { settled: true, busyCount: 0 },
  })),
}));
// The render→capture handshake polls the live DOM for the FileView to settle (12s
// bound). No FileView exists here and readiness isn't under test — without this
// mock each test burns the full 12s timeout.
vi.mock('@/lib/screenshot/readiness', () => ({
  waitForFileViewReady: vi.fn(async () => {}),
}));
vi.mock('@/lib/object-store/client', () => ({
  uploadBlobOrEmbed: vi.fn(async () => 'https://cdn.example/screenshot.jpg'),
}));
const FULL_REPORT = {
  fileType: 'question', overall: 0, grade: 'poor',
  categories: [{ category: 'correctness', score: 0, weight: 0.3, assessed: true, findings: [{
    ruleId: 'question.undeclared-param', category: 'correctness', severity: 'error',
    title: 'Undeclared parameter', detail: 'd', fix: 'f', source: 'rule',
  }] }],
};
vi.mock('@/lib/data/files', () => ({
  FilesAPI: { getRubric: vi.fn(async () => ({ report: FULL_REPORT })) },
}));
// The handler reads the file's type/content from the global Redux store.
const FILES: Record<number, unknown> = {
  42: { id: 42, type: 'question', content: { query: 'SELECT 1', connection_name: 'w', vizSettings: { type: 'table' } }, persistableChanges: {}, ephemeralChanges: {} },
  7: { id: 7, type: 'story', content: { story: '<div><h1>T</h1></div>', description: 'd' }, persistableChanges: {}, ephemeralChanges: {} },
};
vi.mock('@/store/store', () => ({
  getStore: () => ({ getState: () => ({ files: { files: FILES } }) }),
}));

import { captureFileViewWithReadiness } from '@/lib/screenshot/capture';
import { uploadBlobOrEmbed } from '@/lib/object-store/client';
import { FilesAPI } from '@/lib/data/files';
import { executeToolCall } from '../tool-handlers';

const call = (name: string, args: Record<string, unknown>) =>
  ({ id: 'c1', type: 'function', function: { name, arguments: args } }) as never;
const exec = (args: Record<string, unknown>, colorMode: 'light' | 'dark', name = 'ReviewFile') =>
  executeToolCall(call(name, args), undefined, undefined, { ui: { colorMode } } as never, undefined);

describe('ReviewFile tool (frontend bridge)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('captures with the current colorMode and returns rubric status text + an image_url block', async () => {
    const res = await exec({ fileId: 42 }, 'dark');
    expect(captureFileViewWithReadiness).toHaveBeenCalledWith(42, expect.objectContaining({ colorMode: 'dark' }));
    expect(uploadBlobOrEmbed).toHaveBeenCalledWith(expect.any(Blob), 'screenshot.jpg', 'image/jpeg');
    // The combined rubric is fetched for the captured screenshot, graded on the merged content.
    expect(FilesAPI.getRubric).toHaveBeenCalledWith(42, expect.objectContaining({ screenshotUrl: 'https://cdn.example/screenshot.jpg' }));
    const content = res.content as Array<{ type: string; text?: string; image_url?: { url: string } }>;
    const status = JSON.parse(content[0].text!);
    expect(status.success).toBe(true);
    expect(status.rubric.overall).toBe(0);
    expect(status.rubric.grade).toBe('poor');
    const img = content.find(b => b.type === 'image_url');
    expect(img?.image_url?.url).toBe('https://cdn.example/screenshot.jpg');
    // also in details (UI-only, survives the turn) so the chat image doesn't vanish on reload
    expect((res.details as { screenshotUrl?: string }).screenshotUrl).toBe('https://cdn.example/screenshot.jpg');
  });

  it('captures full height by default; an explicit fullHeight: false is honored', async () => {
    await exec({ fileId: 7 }, 'light');
    expect(captureFileViewWithReadiness).toHaveBeenCalledWith(7, expect.objectContaining({ fullHeight: true, colorMode: 'light' }));
    await exec({ fileId: 7, fullHeight: false }, 'light');
    expect(captureFileViewWithReadiness).toHaveBeenLastCalledWith(7, expect.objectContaining({ fullHeight: false }));
  });

  it('degrades to the rules-only rubric (no image) when the file view is not rendered', async () => {
    (captureFileViewWithReadiness as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('FileView with id 42 not found'));
    const res = await exec({ fileId: 42 }, 'light');
    const content = res.content as Array<{ type: string; text?: string }>;
    const status = JSON.parse(content[0].text!);
    expect(status.success).toBe(true);
    expect(status.rubric).toBeDefined(); // deterministic fallback, computed client-side
    expect(status.note).toMatch(/Rules-only/);
    expect(content.find(b => b.type === 'image_url')).toBeUndefined();
  });

  it('returns an error message (does not throw) for a file with no rubric at all', async () => {
    const res = await exec({ fileId: 99 }, 'light'); // 99 is not in the store — never reaches capture
    const text = Array.isArray(res.content) ? (res.content[0] as { text: string }).text : String(res.content);
    expect(text).toMatch(/Could not review/);
    expect((res.details as { success: boolean }).success).toBe(false);
  });

  it('Screenshot (legacy alias) routes to the same handler', async () => {
    const res = await exec({ fileId: 42 }, 'light', 'Screenshot');
    const content = res.content as Array<{ type: string; image_url?: { url: string } }>;
    expect(content.find(b => b.type === 'image_url')?.image_url?.url).toBe('https://cdn.example/screenshot.jpg');
  });
});
