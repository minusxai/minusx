import { describe, it, expect, afterEach, vi } from 'vitest';
import { isValidView, DEFAULT_VIEW, viewLevel, viewAtLeast } from '../view-types';
import { preserveParams } from '@/lib/navigation/url-utils';

describe('view-types', () => {
  it('recognizes valid views and rejects others', () => {
    expect(isValidView('full')).toBe(true);
    expect(isValidView('file')).toBe(true);
    expect(isValidView('content')).toBe(true);
    expect(isValidView('contentonly')).toBe(true);
    expect(isValidView('bogus')).toBe(false);
  });

  it('defaults to full', () => {
    expect(DEFAULT_VIEW).toBe('full');
  });

  it('orders levels: full < file < content < contentonly', () => {
    expect(viewLevel('full')).toBe(0);
    expect(viewLevel('file')).toBe(1);
    expect(viewLevel('content')).toBe(2);
    expect(viewLevel('contentonly')).toBe(3);
  });

  it('viewAtLeast is a >= threshold check (each level is a superset)', () => {
    // contentonly strips everything the lower levels do
    expect(viewAtLeast('contentonly', 'file')).toBe(true);
    expect(viewAtLeast('contentonly', 'content')).toBe(true);
    expect(viewAtLeast('contentonly', 'contentonly')).toBe(true);
    // content strips file + its own, but not contentonly's right sidebar
    expect(viewAtLeast('content', 'file')).toBe(true);
    expect(viewAtLeast('content', 'contentonly')).toBe(false);
    // file strips only the left/top chrome
    expect(viewAtLeast('file', 'file')).toBe(true);
    expect(viewAtLeast('file', 'content')).toBe(false);
    // full strips nothing
    expect(viewAtLeast('full', 'file')).toBe(false);
  });
});

describe('preserveParams — view', () => {
  afterEach(() => vi.unstubAllGlobals());

  const stubLocation = (search: string) =>
    vi.stubGlobal('window', { location: { search, origin: 'http://localhost:3000' } });

  it('preserves a non-default view across navigation', () => {
    stubLocation('?view=file');
    expect(preserveParams('/f/123')).toBe('/f/123?view=file');
  });

  it('does not append the default view (keeps URLs clean, like mode=org)', () => {
    stubLocation('?view=full');
    expect(preserveParams('/f/123')).toBe('/f/123');
  });

  it('preserves view alongside mode', () => {
    stubLocation('?mode=tutorial&view=file');
    const out = preserveParams('/f/123');
    expect(out).toContain('mode=tutorial');
    expect(out).toContain('view=file');
  });

  it('leaves the target unchanged when no view is present', () => {
    stubLocation('');
    expect(preserveParams('/f/123')).toBe('/f/123');
  });
});
