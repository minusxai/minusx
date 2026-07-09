// Remote Agent Sessions — result-content serializer: orchestrator (Text|Image)Content[] → wire
// blocks, with base64 inlining of URLs an external agent cannot fetch (local serve-route / data:).

import { serializeRemoteContent } from '@/lib/chat/remote-session-content.server';

const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUg=='; // any base64 payload works — the serializer doesn't decode

describe('serializeRemoteContent', () => {
  const readBlob = async (key: string) =>
    key === 'charts/1/org/2026-07-09/abc.png'
      ? { data: Buffer.from(PNG_B64, 'base64'), contentType: 'image/png' }
      : null;

  it('passes text through and keeps absolute public image URLs', async () => {
    const out = await serializeRemoteContent(
      [
        { type: 'text', text: 'hello' },
        { type: 'image', url: 'https://bucket.s3.amazonaws.com/charts/x.jpg' },
      ],
      { readBlob },
    );
    expect(out).toEqual([
      { type: 'text', text: 'hello' },
      { type: 'image', url: 'https://bucket.s3.amazonaws.com/charts/x.jpg' },
    ]);
  });

  it('passes through base64 image blocks unchanged', async () => {
    const out = await serializeRemoteContent(
      [{ type: 'image', data: PNG_B64, mimeType: 'image/png' }],
      { readBlob },
    );
    expect(out).toEqual([{ type: 'image', data: PNG_B64, mimeType: 'image/png' }]);
  });

  it('splits data: URLs into base64 blocks', async () => {
    const out = await serializeRemoteContent(
      [{ type: 'image', url: `data:image/jpeg;base64,${PNG_B64}` }],
      { readBlob },
    );
    expect(out).toEqual([{ type: 'image', data: PNG_B64, mimeType: 'image/jpeg' }]);
  });

  it('inlines auth-gated local serve-route URLs as base64 (external agents cannot fetch them)', async () => {
    const out = await serializeRemoteContent(
      [{ type: 'image', url: '/api/object-store/serve/charts/1/org/2026-07-09/abc.png' }],
      { readBlob },
    );
    expect(out).toEqual([{ type: 'image', data: PNG_B64, mimeType: 'image/png' }]);
  });

  it('degrades an unreadable/unknown image URL to a text note instead of a broken block', async () => {
    const out = await serializeRemoteContent(
      [{ type: 'image', url: '/api/object-store/serve/charts/missing.png' }],
      { readBlob },
    );
    expect(out.length).toBe(1);
    expect(out[0].type).toBe('text');
  });
});
