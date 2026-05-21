// normalizeAttachments converts the client's attachment payload into
// AgentAttachment[] for the LLM. v2 sends images inline as base64 data: URLs
// (pi has no remote-URL image support), so only those are parsed; remote URLs
// are ignored (never fetched — no SSRF surface). Text passes through.

import { describe, it, expect } from 'vitest';
import { normalizeAttachments } from '../attachments.server';

describe('normalizeAttachments', () => {
  it('parses a base64 data: URL image', () => {
    expect(
      normalizeAttachments([{ type: 'image', name: 'chart.jpg', content: 'data:image/jpeg;base64,QUJD' }]),
    ).toEqual([{ type: 'image', mimeType: 'image/jpeg', data: 'QUJD' }]);
  });

  it('passes text attachments through with name and pages', () => {
    expect(
      normalizeAttachments([{ type: 'text', name: 'doc.txt', content: 'BODY', metadata: { pages: 4 } }]),
    ).toEqual([{ type: 'text', name: 'doc.txt', content: 'BODY', pages: 4 }]);
  });

  it('ignores remote http(s) URL images (never fetched — no SSRF)', () => {
    expect(
      normalizeAttachments([
        { type: 'image', content: 'https://s3.example.com/chart.png' },
        { type: 'image', content: 'http://169.254.169.254/latest/meta-data/' },
      ]),
    ).toEqual([]);
  });

  it('ignores unknown types and empty/invalid input', () => {
    expect(normalizeAttachments([{ type: 'mystery', content: 'x' }, null])).toEqual([]);
    expect(normalizeAttachments(undefined)).toEqual([]);
    expect(normalizeAttachments('nope')).toEqual([]);
  });
});
