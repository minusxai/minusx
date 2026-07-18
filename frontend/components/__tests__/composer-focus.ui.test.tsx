import { describe, it, expect } from 'vitest';
import { isComposerFocusPassthrough } from '@/components/explore/composer-focus';

/**
 * The composer's background mousedown refocuses the editor when you click empty space, but must LEAVE
 * ALONE clicks on interactive controls and — critically — anything inside a portaled dialog (the
 * annotator), whose events bubble here through the React tree. Regression: a <textarea> (the note
 * field) was hijacked because the old selector matched `input` but not `textarea`.
 */
describe('isComposerFocusPassthrough', () => {
  it('returns true for a textarea (e.g. the annotator note field) so its focus is not hijacked', () => {
    const ta = document.createElement('textarea');
    expect(isComposerFocusPassthrough(ta)).toBe(true);
  });

  it('returns true for anything inside a [role="dialog"] (the portaled annotator)', () => {
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    const canvas = document.createElement('canvas');
    dialog.appendChild(canvas);
    expect(isComposerFocusPassthrough(canvas)).toBe(true);
  });

  it('returns true for buttons, inputs, and the lexical editor', () => {
    const btn = document.createElement('button');
    const input = document.createElement('input');
    const editor = document.createElement('div');
    editor.setAttribute('data-lexical-editor', 'true');
    expect(isComposerFocusPassthrough(btn)).toBe(true);
    expect(isComposerFocusPassthrough(input)).toBe(true);
    expect(isComposerFocusPassthrough(editor)).toBe(true);
  });

  it('returns false for empty composer background (a plain div) so it still refocuses the editor', () => {
    const div = document.createElement('div');
    expect(isComposerFocusPassthrough(div)).toBe(false);
  });

  it('returns false for a null target', () => {
    expect(isComposerFocusPassthrough(null)).toBe(false);
  });
});
