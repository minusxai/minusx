// normalizeAttachments converts the client's attachment payload into
// AgentAttachment[] for the LLM: image content → base64 (parse data: URLs,
// fetch http URLs — pi has no remote-URL image support), text → passthrough.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { normalizeAttachments } from '../attachments.server';

afterEach(() => vi.restoreAllMocks());

describe('normalizeAttachments', () => {
  it('parses a base64 data: URL image without fetching', async () => {
    const out = await normalizeAttachments([
      { type: 'image', name: 'chart.jpg', content: 'data:image/jpeg;base64,QUJD' },
    ]);
    expect(out).toEqual([{ type: 'image', data: 'QUJD', mimeType: 'image/jpeg' }]);
  });

  it('fetches an http(s) URL image and base64-encodes it', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => 'image/png' },
      arrayBuffer: async () => new TextEncoder().encode('hello').buffer,
    });
    vi.stubGlobal('fetch', fetchMock);

    const out = await normalizeAttachments([
      { type: 'image', name: 'c.png', content: 'https://s3.example.com/c.png' },
    ]);
    expect(fetchMock).toHaveBeenCalledWith('https://s3.example.com/c.png');
    expect(out).toEqual([
      { type: 'image', data: Buffer.from('hello').toString('base64'), mimeType: 'image/png' },
    ]);
  });

  it('passes text attachments through with name and pages', async () => {
    const out = await normalizeAttachments([
      { type: 'text', name: 'doc.txt', content: 'BODY', metadata: { pages: 4 } },
    ]);
    expect(out).toEqual([{ type: 'text', name: 'doc.txt', content: 'BODY', pages: 4 }]);
  });

  it('drops images that fail to fetch and ignores unknown/empty input', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    const out = await normalizeAttachments([
      { type: 'image', content: 'https://bad.example.com/x.png' },
      { type: 'mystery', content: 'x' },
      null,
    ]);
    expect(out).toEqual([]);
    expect(await normalizeAttachments(undefined)).toEqual([]);
    expect(await normalizeAttachments('nope')).toEqual([]);
  });
});
