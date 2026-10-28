import { describe, expect, it } from 'vitest';
import { createHeadlessEditor } from '@lexical/headless';
import { withDOM } from '@lexical/headless/dom';
import { $createParagraphNode, $createTextNode, $getRoot } from 'lexical';
import { $generateHtmlFromNodes } from '@lexical/html';

describe('headless document rendering', () => {
  it('creates a DOM and serializes editor content while restoring globals', () => {
    const originalWindow = globalThis.window;
    const editor = createHeadlessEditor({ onError: (error) => { throw error; } });
    editor.update(() => {
      $getRoot().append($createParagraphNode().append($createTextNode('Rendered text')));
    }, { discrete: true });
    const html = withDOM(() => editor.getEditorState().read(() => $generateHtmlFromNodes(editor)));
    expect(html).toContain('Rendered text');
    expect(html).toContain('<p');
    expect(globalThis.window).toBe(originalWindow);
  });
});
