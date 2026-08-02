/**
 * The stored form of a story is a FIXED POINT of the markup round-trip.
 *
 * `markupToContent` normalises what it parses — quote style, void-element spelling, where the
 * `<story>` wrapper sits relative to its first child. That normalisation is what makes the echoed
 * diff authoritative and `oldMatch` reliable (see `frontend/store/CLAUDE.md`), but it would be
 * corrosive if it ran on every edit: a one-word change would come back as a diff touching every
 * line the normaliser reformatted, which reads to the author as the agent rewriting the document.
 *
 * It does not, because normalisation converges after the FIRST pass. `buildCurrentFileStr` projects
 * stored content, so the text an agent edits is already canonical and re-parsing it is a no-op.
 * These tests pin that: pass 1 may differ from the input, pass 2 must equal pass 1.
 */
import { describe, it, expect } from 'vitest';
import { fileToMarkup, markupToContent } from '../file-markup';

function project(markup: string): string {
  const parsed = markupToContent('story', markup, { format: 'jsx' });
  if (!parsed.ok) throw new Error(`parse failed: ${parsed.error}`);
  return fileToMarkup('story', parsed.content);
}

describe('story markup round-trip converges after one pass', () => {
  it('is stable for markup the pipeline itself produced', () => {
    const authored = '<story>\n<section class="mb-8"><h2 class="text-2xl">A</h2><p>Body.</p></section>\n</story>';
    const stored = project(authored);
    expect(project(stored)).toBe(stored);
  });

  it('is stable for hand-written or imported markup, which pass 1 does reformat', () => {
    const messy = [
      '<story>',
      "<section class='mb-8   pt-4'>",
      '  <h2 class="text-2xl   font-bold">B</h2>',
      '  <img src="/a.png"/>',
      '  <br>',
      '  <p>Body &amp; more.</p>',
      '</section>',
      '</story>',
    ].join('\n');

    const stored = project(messy);
    // Pass 1 is allowed to reformat — that is the normalisation doing its job.
    expect(stored).not.toBe(messy);
    // Pass 2 must not. An edit of a stored story diffs against a fixed point.
    expect(project(stored)).toBe(stored);
  });

  it('leaves the parts of a stored document an edit did not touch byte-identical', () => {
    const stored = project(
      '<story>\n'
      + Array.from({ length: 12 }, (_, i) =>
        `<section class="mb-8"><h2 class="text-2xl">Section ${i}</h2><p>Body ${i}.</p></section>`).join('\n')
      + '\n</story>',
    );

    const edited = stored.replace('Section 7', 'Section seven');
    expect(edited).not.toBe(stored);

    const reStored = project(edited);
    // Every line except the edited one survives the round-trip unchanged — this is the property
    // that keeps a one-word edit from presenting as a whole-document rewrite.
    const before = stored.split('\n');
    const after = reStored.split('\n');
    expect(after.length).toBe(before.length);
    const differing = before.filter((line, i) => line !== after[i]);
    expect(differing.length).toBe(1);
    expect(differing[0]).toContain('Section 7');
  });
});
