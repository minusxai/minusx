// parseJsx: static JSX source → normalized AST. Attribute `{…}` values are evaluated
// to JSON literals; non-static expressions are recorded (not thrown) so the validator
// can reject them. Syntax errors return { ok:false }.
import { describe, it, expect } from 'vitest';
import { parseJsx } from '../parse';
import type { JsxElement, JsxText } from '../types';

function firstElement(src: string): JsxElement {
  const r = parseJsx(src);
  if (!r.ok) throw new Error(`expected ok, got error: ${r.error}`);
  const el = r.nodes.find((n) => n.type === 'element');
  if (!el || el.type !== 'element') throw new Error('no element node');
  return el;
}

function attr(el: JsxElement, name: string) {
  const a = el.attributes.find((x) => x.name === name);
  if (!a) throw new Error(`no attribute ${name}`);
  return a.value;
}

describe('parseJsx', () => {
  it('parses a component with string + JSON-object + number attributes and a text child', () => {
    const el = firstElement(
      `<Question connection="github" viz={{"type":"bar","xCols":["actor_login"]}} limit={5}>SELECT 1</Question>`,
    );
    expect(el.tag).toBe('Question');
    expect(el.isComponent).toBe(true);
    expect(el.selfClosing).toBe(false);
    expect(attr(el, 'connection')).toEqual({ static: true, json: 'github' });
    expect(attr(el, 'viz')).toEqual({ static: true, json: { type: 'bar', xCols: ['actor_login'] } });
    expect(attr(el, 'limit')).toEqual({ static: true, json: 5 });
    const text = el.children.find((c) => c.type === 'text') as JsxText;
    expect(text.value.trim()).toBe('SELECT 1');
  });

  it('accepts unquoted object keys in JSON attributes', () => {
    const el = firstElement(`<Question viz={{type:"line",yCols:["count"]}}>x</Question>`);
    expect(attr(el, 'viz')).toEqual({ static: true, json: { type: 'line', yCols: ['count'] } });
  });

  it('parses a self-closing component with a number prop', () => {
    const el = firstElement(`<Question id={1090} />`);
    expect(el.selfClosing).toBe(true);
    expect(el.children).toHaveLength(0);
    expect(attr(el, 'id')).toEqual({ static: true, json: 1090 });
  });

  it('parses nested HTML and marks lowercase tags as non-components', () => {
    const el = firstElement(`<div class="soh"><p>hi</p></div>`);
    expect(el.tag).toBe('div');
    expect(el.isComponent).toBe(false);
    expect(attr(el, 'class')).toEqual({ static: true, json: 'soh' });
    const p = el.children.find((c) => c.type === 'element') as JsxElement;
    expect(p.tag).toBe('p');
  });

  it('treats a valueless attribute as boolean true', () => {
    const el = firstElement(`<input disabled />`);
    expect(attr(el, 'disabled')).toEqual({ static: true, json: true });
  });

  it('records a non-static attribute expression as static:false (does not throw)', () => {
    const el = firstElement(`<Question viz={computeViz()} />`);
    const v = attr(el, 'viz');
    expect(v.static).toBe(false);
    if (!v.static) expect(v.exprType).toBe('CallExpression');
  });

  it('supports multiple root nodes (implicit fragment)', () => {
    const r = parseJsx(`<Question id={1} /><Question id={2} />`);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.nodes.filter((n) => n.type === 'element')).toHaveLength(2);
  });

  it('maps source spans back to the original (offset-corrected)', () => {
    const src = `<Question id={7} />`;
    const el = firstElement(src);
    expect(src.slice(el.start, el.end)).toBe(`<Question id={7} />`);
  });

  it('returns { ok:false } on a syntax error instead of throwing', () => {
    const r = parseJsx(`<Question oops=>`);
    expect(r.ok).toBe(false);
  });

  it('returns an empty node list for empty source', () => {
    const r = parseJsx(`   `);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.nodes.filter((n) => n.type === 'element')).toHaveLength(0);
  });
});
