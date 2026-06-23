import { describe, it, expect } from 'vitest';
import { rehypeMentions } from '../rehype-mentions';

// Minimal hast helpers for tests
const p = (...children: any[]) => ({ type: 'element', tagName: 'p', properties: {}, children });
const text = (value: string) => ({ type: 'text', value });
const root = (...children: any[]) => ({ type: 'root', children });

function run(tree: any) {
  rehypeMentions()(tree);
  return tree;
}

describe('rehypeMentions', () => {
  it('splits a text node with a valid mention into a span chip + trailing text', () => {
    const tree = run(
      root(p(text('@{"type":"table","name":"events","schema":"posthog"} is the main table.')))
    );
    const para = tree.children[0];
    expect(para.children).toHaveLength(2);

    const [chip, rest] = para.children;
    expect(chip.type).toBe('element');
    expect(chip.tagName).toBe('span');
    expect(chip.properties.mentionJson).toBe('@{"type":"table","name":"events","schema":"posthog"}');
    expect(rest).toEqual(text(' is the main table.'));
  });

  it('handles a mention surrounded by text on both sides', () => {
    const tree = run(root(p(text('see @{"type":"table","name":"events"} now'))));
    const para = tree.children[0];
    expect(para.children.map((c: any) => c.tagName ?? c.type)).toEqual(['text', 'span', 'text']);
  });

  it('leaves invalid mention JSON untouched as a single text node', () => {
    const tree = run(root(p(text('email me @{not json} ok'))));
    const para = tree.children[0];
    expect(para.children).toHaveLength(1);
    expect(para.children[0]).toEqual(text('email me @{not json} ok'));
  });

  it('recurses into nested elements', () => {
    const tree = run(
      root(p({ type: 'element', tagName: 'strong', properties: {}, children: [text('@{"type":"metric","name":"mrr"}')] }))
    );
    const strong = tree.children[0].children[0];
    expect(strong.children).toHaveLength(1);
    expect(strong.children[0].tagName).toBe('span');
  });
});
