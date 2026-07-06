import { isTitleBearingType, isTitleMissing, missingTitleFeedback } from '../file-title';

describe('file-title helpers', () => {
  it('flags content types as title-bearing, not system/structural ones', () => {
    for (const t of ['question', 'dashboard', 'notebook', 'story', 'report', 'alert'] as const)
      expect(isTitleBearingType(t)).toBe(true);
    for (const t of ['folder', 'connection', 'context', 'config'] as const)
      expect(isTitleBearingType(t)).toBe(false);
  });

  it('treats empty/whitespace/placeholder names as missing titles', () => {
    expect(isTitleMissing('dashboard', '')).toBe(true);
    expect(isTitleMissing('dashboard', '   ')).toBe(true);
    expect(isTitleMissing('dashboard', 'New Dashboard')).toBe(true); // default placeholder
    expect(isTitleMissing('question', 'Untitled')).toBe(true);
    expect(isTitleMissing('dashboard', null)).toBe(true);
    expect(isTitleMissing('dashboard', undefined)).toBe(true);
  });

  it('treats a real title as present', () => {
    expect(isTitleMissing('dashboard', 'Revenue Overview')).toBe(false);
    expect(isTitleMissing('question', 'MRR by month')).toBe(false);
  });

  it('never flags non-title-bearing types, even when blank', () => {
    expect(isTitleMissing('folder', '')).toBe(false);
    expect(isTitleMissing('connection', '')).toBe(false);
    expect(isTitleMissing('context', '')).toBe(false);
  });

  it('feedback names the type and points to EditFile name', () => {
    const fb = missingTitleFeedback('dashboard');
    expect(fb).toMatch(/dashboard/i);
    expect(fb).toMatch(/EditFile/);
    expect(fb).toMatch(/name/);
  });
});
