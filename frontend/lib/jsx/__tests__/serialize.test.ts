// serializeJsx is the inverse of parseJsx — these pin that structure + raw text leaves
// survive a parse → serialize → parse round-trip.
import { describe, it, expect } from 'vitest';
import { parseJsx } from '../parse';
import { serializeJsx } from '../serialize';

function reparse(src: string) {
  const a = parseJsx(src);
  if (!a.ok) throw new Error(`parse failed: ${a.error}`);
  const out = serializeJsx(a.nodes);
  const b = parseJsx(out);
  if (!b.ok) throw new Error(`reparse failed: ${b.error} (serialized: ${out})`);
  return { out, nodesA: a.nodes, nodesB: b.nodes };
}

describe('serializeJsx', () => {
  it('serializes string attrs as "x" and JSON-literal attrs as {…}', () => {
    const { out } = reparse('<div class="story"><Question id={1022} viz={{"type":"bar"}} height={440} /></div>');
    expect(out).toContain('class="story"');
    expect(out).toContain('id={1022}');
    expect(out).toContain('viz={{"type":"bar"}}');
    expect(out).toContain('<Question ');
    expect(out).toContain('/>'); // self-closing preserved
  });

  it('keeps a raw template-literal child (SQL with < > {) intact', () => {
    const { out, nodesB } = reparse('<Question connection="db">{`SELECT a FROM t WHERE x < 5 AND y > 1`}</Question>');
    expect(out).toContain('{`SELECT a FROM t WHERE x < 5 AND y > 1`}');
    const q = nodesB.find((n) => n.type === 'element');
    const child = q && q.type === 'element' ? q.children[0] : undefined;
    expect(child && child.type === 'expression' && child.value.static && child.value.json).toBe(
      'SELECT a FROM t WHERE x < 5 AND y > 1',
    );
  });

  it('round-trips nested HTML + text faithfully', () => {
    const src = '<div class="s"><h1>Title</h1><p>hello world</p></div>';
    const { out } = reparse(src);
    expect(out).toBe(src);
  });
});
