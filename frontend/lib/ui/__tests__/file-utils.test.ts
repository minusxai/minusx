import { describe, it, expect } from 'vitest';
import {
  hasGeneratableContent,
  getEditModeBanner,
  EDIT_BANNER_TYPES,
} from '@/lib/ui/file-utils';

describe('hasGeneratableContent', () => {
  it('is false for missing content', () => {
    expect(hasGeneratableContent('question', undefined)).toBe(false);
    expect(hasGeneratableContent('question', null)).toBe(false);
  });

  it('question: true only with a non-empty query', () => {
    expect(hasGeneratableContent('question', { query: '' })).toBe(false);
    expect(hasGeneratableContent('question', { query: '   ' })).toBe(false);
    expect(hasGeneratableContent('question', { query: 'select 1' })).toBe(true);
  });

  it('dashboard/report: true only with assets', () => {
    expect(hasGeneratableContent('dashboard', { assets: [] })).toBe(false);
    expect(hasGeneratableContent('dashboard', { assets: [{ type: 'question', id: 1 }] })).toBe(true);
  });

  it('notebook: true only with cells', () => {
    expect(hasGeneratableContent('notebook', { cells: [] })).toBe(false);
    expect(hasGeneratableContent('notebook', { cells: [{ type: 'text' }] })).toBe(true);
  });
});

describe('getEditModeBanner', () => {
  it('returns null when not editing, regardless of type', () => {
    expect(getEditModeBanner('dashboard', false)).toBeNull();
    expect(getEditModeBanner('story', false)).toBeNull();
    expect(getEditModeBanner('context', false)).toBeNull();
  });

  it('returns a colored banner with a type-specific label for types with a distinct edit state', () => {
    expect(getEditModeBanner('dashboard', true)).toEqual({
      color: 'accent.primary/90',
      label: 'Editing Dashboard',
    });
    expect(getEditModeBanner('story', true)).toEqual({
      color: 'accent.primary/90',
      label: 'Editing Story',
    });
    expect(getEditModeBanner('context', true)).toEqual({
      color: 'accent.primary/90',
      label: 'Editing Knowledge Base',
    });
  });

  it('returns null for file types that are effectively always in edit state', () => {
    expect(getEditModeBanner('question', true)).toBeNull();
    expect(getEditModeBanner('notebook', true)).toBeNull();
    expect(getEditModeBanner('report', true)).toBeNull();
    expect(getEditModeBanner('alert', true)).toBeNull();
  });

  it('exposes the banner-eligible types as a single source of truth', () => {
    expect([...EDIT_BANNER_TYPES].sort()).toEqual(['context', 'dashboard', 'story']);
  });
});
