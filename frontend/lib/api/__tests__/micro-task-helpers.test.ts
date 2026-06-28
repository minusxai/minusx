import { describe, it, expect } from 'vitest';
import { hasGeneratableContent } from '@/lib/api/micro-task';

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
