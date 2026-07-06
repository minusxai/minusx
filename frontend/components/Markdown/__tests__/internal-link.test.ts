// isInternalAppLink: same-origin app routes navigate client-side; the old check
// only matched bare `/f/<id>`, so folders and file links with query/hash leaked
// to a full page reload (losing Redux state).
import { describe, it, expect } from 'vitest';
import { isInternalAppLink } from '../internal-link';

describe('isInternalAppLink', () => {
  it.each([
    '/f/123',
    '/f/123?mode=tutorial',
    '/f/123#section',
    '/p/some-folder',
    '/explore',
    '/conversations',
  ])('treats internal route %s as client-side', (href) => {
    expect(isInternalAppLink(href)).toBe(true);
  });

  it.each([
    'https://example.com/x',
    'http://other.com',
    '//evil.com',
    'mailto:a@b.com',
    '#anchor',
    undefined,
  ])('treats %s as external', (href) => {
    expect(isInternalAppLink(href as string | undefined)).toBe(false);
  });
});
