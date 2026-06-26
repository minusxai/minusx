// The inspect-content codec: turns a user message and an app state into typed `InspectPart`s that
// the Inspect modal renders by content type — images inline, markup as formatted code, query data
// as a table, everything else as pretty JSON. User message + app state flow through the SAME part
// model so they render identically (the locked requirement for the "Inspect tool calls" modal).
import { describe, it, expect } from 'vitest';
import { userMessageParts, appStateParts, type InspectPart } from '../inspect-content';
import type { AppState } from '@/lib/appState';

const kinds = (parts: InspectPart[]) => parts.map((p) => p.kind);

describe('userMessageParts', () => {
  it('renders the message text + image attachments inline + text attachments as text', () => {
    const parts = userMessageParts({
      content: 'which month had max mrr?',
      attachments: [
        { type: 'image', name: 'shot.png', content: 'https://x/shot.png' },
        { type: 'text', name: 'notes.txt', content: 'some notes' },
      ],
    });
    expect(kinds(parts)).toEqual(['text', 'image', 'text']);
    expect((parts[0] as Extract<InspectPart, { kind: 'text' }>).text).toBe('which month had max mrr?');
    expect((parts[1] as Extract<InspectPart, { kind: 'image' }>).url).toBe('https://x/shot.png');
    expect((parts[2] as Extract<InspectPart, { kind: 'text' }>).text).toBe('some notes');
  });

  it('is empty for an empty message with no attachments', () => {
    expect(userMessageParts({ content: '' })).toEqual([]);
  });
});

describe('appStateParts', () => {
  it('renders a file page: screenshot image, query table, markup as code, and the stripped JSON', () => {
    const appState = {
      type: 'file',
      state: {
        fileState: {
          id: 1041,
          name: 'MRR',
          path: '/org/MRR',
          type: 'question',
          isDirty: false,
          content: { query: 'select 1', vizSettings: { type: 'bar' } },
          markup: '<Question><Query>select 1</Query></Question>',
          image: { key: 'k', url: 'https://x/chart.jpg' },
        },
        references: [],
        queryResults: [
          { columns: ['month', 'mrr'], types: ['text', 'number'], data: '| month | mrr |\n|---|---|\n| Jun | 9 |', totalRows: 1, shownRows: 1, truncated: false },
        ],
      },
    } as unknown as AppState;

    const parts = appStateParts(appState);
    const k = kinds(parts);
    expect(k).toContain('image');
    expect(k).toContain('query');
    expect(k).toContain('markup');
    expect(k).toContain('json');

    const image = parts.find((p) => p.kind === 'image') as Extract<InspectPart, { kind: 'image' }>;
    expect(image.url).toBe('https://x/chart.jpg');

    const query = parts.find((p) => p.kind === 'query') as Extract<InspectPart, { kind: 'query' }>;
    expect(query.columns).toEqual(['month', 'mrr']);
    expect(query.data).toContain('| month | mrr |');

    const markup = parts.find((p) => p.kind === 'markup') as Extract<InspectPart, { kind: 'markup' }>;
    expect(markup.text).toContain('<file_markup');
    expect(markup.text).toContain('<Question>');

    // The JSON part is the markup-pulled, content-stripped app state — never the raw JSON `content`.
    const json = parts.find((p) => p.kind === 'json') as Extract<InspectPart, { kind: 'json' }>;
    const jsonStr = JSON.stringify(json.value);
    expect(jsonStr).not.toContain('"markup"');   // markup pulled out into its own part
    expect(jsonStr).not.toContain('select 1');    // raw JSON content stripped at the LLM boundary
    // The image payload is rendered as its own image part (above) AND, in the real prompt, is a
    // separate image block — so the JSON keeps only the dedup `key`, never the heavy base64/url
    // (mirrors lib/projection: "we never hash base64").
    expect(jsonStr).not.toContain('chart.jpg');   // image url NOT duplicated into the JSON
    const jsonImage = (json.value as { state?: { fileState?: { image?: unknown } } })?.state?.fileState?.image;
    expect(jsonImage).toEqual({ key: 'k' });       // lean: just the stable key
  });

  it('builds an image src from inline base64 when there is no url', () => {
    const appState = {
      type: 'file',
      state: {
        fileState: { id: 2, name: 'q', path: '/q', type: 'question', isDirty: false, image: { key: 'k', data: 'AAAA', mimeType: 'image/png' } },
        references: [],
        queryResults: [],
      },
    } as unknown as AppState;
    const image = appStateParts(appState).find((p) => p.kind === 'image') as Extract<InspectPart, { kind: 'image' }>;
    expect(image.url).toBe('data:image/png;base64,AAAA');
  });

  it('renders a non-file app state (folder/explore) as a single JSON part', () => {
    const appState = { type: 'explore', state: null } as unknown as AppState;
    const parts = appStateParts(appState);
    expect(kinds(parts)).toEqual(['json']);
  });

  it('returns nothing for an absent app state', () => {
    expect(appStateParts(undefined)).toEqual([]);
    expect(appStateParts(null)).toEqual([]);
  });
});
