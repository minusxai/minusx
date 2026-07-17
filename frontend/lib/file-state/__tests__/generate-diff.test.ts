/**
 * generateDiff must be a REAL line diff (LCS/Myers alignment), not a positional compare.
 *
 * Regression (huge_conversation.json, EditFile result #3): the old implementation compared
 * line i to line i, so deleting ONE line early in a 700-line story emitted every following
 * line as a spurious -/+ pair — a 136KB "diff" (721 dels / 720 adds) for a one-line edit.
 * That diff is echoed to the LLM on every subsequent turn (it's the agent's oldMatch anchor)
 * and stored in the log, so the blowup compounds across an editing session.
 *
 * Output contract (consumers: EditFileDisplay +/− counters, parseUndoRedoFromDiff first-`-`/
 * last-`+`, and the LLM's "build future oldMatch from the + lines" guidance):
 * only changed lines, prefixed `-` (old) / `+` (new), deletions before additions per hunk,
 * no context lines, no hunk headers.
 */
import { generateDiff } from '@/lib/file-state/shared';

const doc = (n: number, prefix = 'line') => Array.from({ length: n }, (_, i) => `${prefix} ${i}`).join('\n');

const lines = (diff: string) => (diff === '' ? [] : diff.split('\n'));

describe('generateDiff — alignment (the whole point)', () => {
  it('inserting ONE line into a 700-line doc yields exactly one + line', () => {
    const old = doc(700);
    const arr = old.split('\n');
    arr.splice(150, 0, 'THE NEW LINE');
    expect(generateDiff(old, arr.join('\n'))).toBe('+THE NEW LINE');
  });

  it('deleting ONE line from a 700-line doc yields exactly one - line (the huge_conversation regression)', () => {
    const old = doc(700);
    const arr = old.split('\n');
    arr.splice(333, 1);
    const d = generateDiff(old, arr.join('\n'));
    expect(d).toBe('-line 333');
    // The bug signature: diff size must be independent of document length.
    expect(lines(d).length).toBeLessThanOrEqual(2);
  });

  it('inserting at the very start does not cascade', () => {
    const old = doc(50);
    expect(generateDiff(old, `HEADER\n${old}`)).toBe('+HEADER');
  });

  it('appending at the end yields one + line', () => {
    const old = doc(50);
    expect(generateDiff(old, `${old}\nFOOTER`)).toBe('+FOOTER');
  });

  it('two separated one-line edits yield two small hunks, nothing between them', () => {
    const old = doc(100);
    const arr = old.split('\n');
    arr[10] = 'changed ten';
    arr.splice(60, 0, 'inserted sixty');
    const d = generateDiff(old, arr.join('\n'));
    expect(lines(d)).toEqual(['-line 10', '+changed ten', '+inserted sixty']);
  });
});

describe('generateDiff — output contract preserved', () => {
  it('identical inputs → empty string', () => {
    expect(generateDiff(doc(20), doc(20))).toBe('');
  });

  it('in-place single-line replacement → -old then +new', () => {
    const old = doc(10);
    const arr = old.split('\n');
    arr[4] = 'replaced';
    expect(generateDiff(old, arr.join('\n'))).toBe('-line 4\n+replaced');
  });

  it('every emitted line starts with - or + (no context, no headers)', () => {
    const old = doc(40);
    const arr = old.split('\n');
    arr[5] = 'a'; arr.splice(20, 2); arr.push('tail');
    const d = generateDiff(old, arr.join('\n'));
    expect(lines(d).every((l) => l.startsWith('-') || l.startsWith('+'))).toBe(true);
  });

  it('single-line files (question JSON shape) → -old then +new, preserving undo/redo parsing', () => {
    expect(generateDiff('{"a":1}', '{"a":2}')).toBe('-{"a":1}\n+{"a":2}');
  });

  it('full rewrite still emits everything', () => {
    const d = generateDiff(doc(100, 'old'), doc(100, 'new'));
    const ls = lines(d);
    expect(ls.filter((l) => l.startsWith('-'))).toHaveLength(100);
    expect(ls.filter((l) => l.startsWith('+'))).toHaveLength(100);
  });

  it('creation (empty → content) is all additions; deletion (content → empty) is all removals', () => {
    const created = generateDiff('', 'a\nb');
    expect(lines(created).filter((l) => l.startsWith('+'))).toEqual(expect.arrayContaining(['+a', '+b']));
    expect(lines(created).some((l) => l.startsWith('+line'))).toBe(false);
    const cleared = generateDiff('a\nb', '');
    expect(lines(cleared).filter((l) => l.startsWith('-'))).toEqual(expect.arrayContaining(['-a', '-b']));
  });
});

describe('generateDiff — scale', () => {
  it('three scattered edits in a 5000-line doc: small diff, fast', () => {
    const old = doc(5000);
    const arr = old.split('\n');
    arr[100] = 'edit one';
    arr.splice(2500, 0, 'edit two');
    arr[4800] = 'edit three';
    const started = Date.now();
    const d = generateDiff(old, arr.join('\n'));
    expect(Date.now() - started).toBeLessThan(500);
    expect(lines(d).length).toBeLessThanOrEqual(6);
    expect(d).toContain('+edit one');
    expect(d).toContain('+edit two');
    expect(d).toContain('+edit three');
  });
});
