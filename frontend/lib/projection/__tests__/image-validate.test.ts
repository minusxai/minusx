// Guard against the image-format bug class (data: URL in `url` → provider 400). The faux LLM never
// validates images, so this asserts the contract directly AND end-to-end through the projection.
import { describe, it, expect } from 'vitest';
import { isValidProviderImage, assertValidProviderImages } from '../image-validate';
import { projectMessages, type WithAppState } from '../messages';
import type { AppState } from '@/lib/appState';
import type { CompressedAugmentedFile } from '@/lib/types';
import type { ImageContent, Message, UserMessage } from '@/orchestrator/llm';

describe('isValidProviderImage', () => {
  it('accepts a remote http(s) url', () => {
    expect(isValidProviderImage({ type: 'image', url: 'https://s3/x.jpg' })).toBe(true);
  });
  it('accepts inline base64 with a mimeType', () => {
    expect(isValidProviderImage({ type: 'image', data: 'QUJD', mimeType: 'image/jpeg' })).toBe(true);
  });
  it('REJECTS a data: URL placed in `url` (the shipped bug)', () => {
    expect(isValidProviderImage({ type: 'image', url: 'data:image/jpeg;base64,QUJD' })).toBe(false);
  });
  it('rejects base64 missing a mimeType', () => {
    expect(isValidProviderImage({ type: 'image', data: 'QUJD' })).toBe(false);
  });
  it('rejects an empty image', () => {
    expect(isValidProviderImage({ type: 'image' })).toBe(false);
  });
});

describe('assertValidProviderImages', () => {
  it('throws on a data: URL in `url`', () => {
    expect(() => assertValidProviderImages([{ type: 'image', url: 'data:image/png;base64,AA' }])).toThrow(/data: URL/);
  });
  it('passes for valid blocks (and ignores text)', () => {
    expect(() => assertValidProviderImages([
      { type: 'text', text: 'hi' },
      { type: 'image', url: 'https://s3/x.jpg' },
      { type: 'image', data: 'AA', mimeType: 'image/png' },
    ])).not.toThrow();
  });
});

describe('projection emits provider-valid images', () => {
  // End-to-end: a file screenshot captured as a base64 data: URL (dev/USE_BASE64_UPLOADS) must be
  // SPLIT into {data, mimeType} by the projection — never passed through as a data: URL in `url`.
  it('app state with a data: URL screenshot → emitted image block is provider-valid', () => {
    const caf: CompressedAugmentedFile = {
      fileState: {
        id: 1, name: 'q1', path: '/org/q1', type: 'question', isDirty: false,
        markup: '<question id="1"/>',
        image: { key: 'shot-1', url: 'data:image/jpeg;base64,QUJDREVG' },
      },
      references: [],
      queryResults: [],
    };
    const appState: AppState = { type: 'file', state: caf };
    const userMsg: Message = { role: 'user', content: 'go', timestamp: 0 } as UserMessage;
    (userMsg as Message & WithAppState)._appState = appState;

    const [out] = projectMessages([userMsg]);
    const images = (out.content as Array<{ type: string }>).filter((c): c is ImageContent => c.type === 'image');
    expect(images).toHaveLength(1);
    expect(() => assertValidProviderImages(out.content as ImageContent[])).not.toThrow();
    // specifically: split into base64 data + mimeType, NOT a data: URL in `url`
    expect(images[0]).toEqual({ type: 'image', mimeType: 'image/jpeg', data: 'QUJDREVG' });
  });
});
