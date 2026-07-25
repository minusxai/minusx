/**
 * The name whitelist — how a context selects which INHERITED data models and
 * semantic models it takes. Same shape and same defaults as the table whitelist
 * (`'*' | WhitelistNode[]`, absent read as `'*'`), so there is one mental model
 * for "what did I take from my parent".
 *
 * The `'*'` wildcard is the point: it means "everything offered, including what
 * is added later". An explicit list does not — exactly like tables, where
 * leaving the wildcard freezes your selection.
 */
import { describe, it, expect } from 'vitest';
import { nameWhitelisted, applyNameWhitelist, toggleNameWhitelist } from '../name-whitelist';

const offered = [{ name: 'a' }, { name: 'b' }, { name: 'c' }];
const NAMES = ['a', 'b', 'c'];

describe('nameWhitelisted', () => {
  it('takes everything when absent or wildcarded', () => {
    expect(nameWhitelisted(undefined, 'a')).toBe(true);
    expect(nameWhitelisted('*', 'a')).toBe(true);
  });

  it('takes only what an explicit list names', () => {
    expect(nameWhitelisted(['a'], 'a')).toBe(true);
    expect(nameWhitelisted(['a'], 'b')).toBe(false);
    expect(nameWhitelisted([], 'a')).toBe(false);
  });
});

describe('applyNameWhitelist', () => {
  it('passes the whole offering through when absent or wildcarded', () => {
    expect(applyNameWhitelist(offered, undefined)).toEqual(offered);
    expect(applyNameWhitelist(offered, '*')).toEqual(offered);
  });

  it('filters to the named entries, preserving the offered order', () => {
    expect(applyNameWhitelist(offered, ['c', 'a'])).toEqual([{ name: 'a' }, { name: 'c' }]);
    expect(applyNameWhitelist(offered, [])).toEqual([]);
  });

  it('ignores names that are no longer offered', () => {
    expect(applyNameWhitelist(offered, ['a', 'gone'])).toEqual([{ name: 'a' }]);
  });
});

describe('toggleNameWhitelist', () => {
  it('unchecking under the wildcard expands to an explicit list, minus that one', () => {
    // Same two-step tables take: leaving '*' materialises the current selection.
    expect(toggleNameWhitelist('*', NAMES, 'b')).toEqual(['a', 'c']);
    expect(toggleNameWhitelist(undefined, NAMES, 'b')).toEqual(['a', 'c']);
  });

  it('unchecking within an explicit list drops just that one', () => {
    expect(toggleNameWhitelist(['a', 'c'], NAMES, 'c')).toEqual(['a']);
  });

  it('re-checking adds it back', () => {
    expect(toggleNameWhitelist(['a'], NAMES, 'c')).toEqual(['a', 'c']);
  });

  it('collapses back to the wildcard once everything is selected again', () => {
    // Otherwise "all checked" would silently stop accepting models added later —
    // a trap, since the UI looks identical to the wildcard.
    expect(toggleNameWhitelist(['a', 'b'], NAMES, 'c')).toBe('*');
  });

  it('an empty offering is trivially complete — stays the wildcard', () => {
    expect(toggleNameWhitelist([], [], 'anything')).toBe('*');
  });
});
