// A file whose `name` is empty must never render as a blank label — list/grid rows
// would show a bare icon with nothing under it. `getFileDisplayName` is the single
// source of that fallback: "Untitled <Type Label> #<id>", where the id is what makes
// two untitled files of the same type distinguishable (it is the file's identity —
// `/f/{id}` — so the label matches what the user lands on).
import { describe, it, expect } from 'vitest';
import { getFileDisplayName } from '@/lib/ui/file-metadata';

describe('getFileDisplayName', () => {
  it('returns the name when the file has one', () => {
    expect(getFileDisplayName({ name: 'Revenue Summary', type: 'question', id: 12 }))
      .toBe('Revenue Summary');
  });

  it('trims the name', () => {
    expect(getFileDisplayName({ name: '  Revenue Summary  ', type: 'question', id: 12 }))
      .toBe('Revenue Summary');
  });

  it('falls back to "Untitled <Label> #<id>" for an empty name', () => {
    expect(getFileDisplayName({ name: '', type: 'story', id: 42 }))
      .toBe('Untitled Story #42');
  });

  it('treats a whitespace-only name as empty', () => {
    expect(getFileDisplayName({ name: '   ', type: 'dashboard', id: 7 }))
      .toBe('Untitled Dashboard #7');
  });

  it('handles a missing/null name', () => {
    expect(getFileDisplayName({ type: 'question', id: 3 })).toBe('Untitled Question #3');
    expect(getFileDisplayName({ name: null, type: 'question', id: 3 })).toBe('Untitled Question #3');
  });

  it('uses the file type label, not the raw type key', () => {
    // `context` is labelled "Knowledge Base" — the fallback must read like the UI does.
    expect(getFileDisplayName({ name: '', type: 'context', id: 9 }))
      .toBe('Untitled Knowledge Base #9');
  });

  it('omits the id suffix when no id is available', () => {
    // e.g. DocumentHeader, which renders a single file and has no id prop.
    expect(getFileDisplayName({ name: '', type: 'dashboard' })).toBe('Untitled Dashboard');
  });
});
