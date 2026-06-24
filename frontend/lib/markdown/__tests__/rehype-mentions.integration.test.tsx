import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { rehypeMentions } from '../rehype-mentions';

/**
 * Integration contract: real react-markdown (NOT the jsdom mock) must surface the
 * mention string the plugin stashes in `node.properties.mentionJson` to a `span`
 * component override — this is what the production `Markdown` component relies on.
 */
function renderDoc(md: string) {
  const captured: string[] = [];
  const html = renderToStaticMarkup(
    React.createElement(ReactMarkdown, {
      remarkPlugins: [remarkGfm],
      rehypePlugins: [rehypeMentions],
      components: {
        span: ({ node, children, ...props }: any) => {
          const raw = node?.properties?.mentionJson;
          if (typeof raw === 'string') {
            captured.push(raw);
            // Stand-in for <MentionChip>: render only the friendly name.
            const data = JSON.parse(raw.slice(1));
            return React.createElement('span', { className: 'mention' }, data.name);
          }
          return React.createElement('span', props, children);
        },
      },
    }, md)
  );
  return { html, captured };
}

describe('rehypeMentions + react-markdown', () => {
  it('routes an inline mention to the span override with the raw JSON', () => {
    const { html, captured } = renderDoc(
      '@{"type":"table","name":"events","schema":"posthog"} is the main events table.'
    );

    expect(captured).toEqual(['@{"type":"table","name":"events","schema":"posthog"}']);
    expect(html).toContain('<span class="mention">events</span>');
    // Raw mention JSON must not leak into the rendered prose.
    expect(html).not.toContain('type&quot;:&quot;table');
    expect(html).toContain('is the main events table.');
  });

  it('does not produce mention spans for plain prose', () => {
    const { captured } = renderDoc('Just some **bold** docs, no mentions.');
    expect(captured).toEqual([]);
  });
});
