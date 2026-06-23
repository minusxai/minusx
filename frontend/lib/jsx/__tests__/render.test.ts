// renderJsx maps a (validated) AST to React elements via a component registry:
// Capitalized tags → registry components (JSON attrs become props), lowercase tags →
// sanitized HTML elements (class→className, style string→object). Nothing executes.
import { describe, it, expect } from 'vitest';
import { isValidElement, type ReactElement } from 'react';
import { parseJsx } from '../parse';
import { renderJsx } from '../render';

const Question = (_props: Record<string, unknown>) => null;
const registry = { Question };

function renderOne(src: string): ReactElement {
  const r = parseJsx(src);
  if (!r.ok) throw new Error(r.error);
  const out = renderJsx(r.nodes, registry) as unknown[];
  const el = out.find(isValidElement);
  if (!el) throw new Error('no element rendered');
  return el as ReactElement;
}

describe('renderJsx', () => {
  it('renders a registered component, passing JSON attrs as props and text as children', () => {
    const el = renderOne(`<Question connection="github" viz={{type:"bar"}}>SELECT 1</Question>`);
    expect(el.type).toBe(Question);
    const props = el.props as { connection: string; viz: unknown; children: unknown };
    expect(props.connection).toBe('github');
    expect(props.viz).toEqual({ type: 'bar' });
    const kids = (Array.isArray(props.children) ? props.children : [props.children]).filter((k) => typeof k === 'string');
    expect(kids.join('').trim()).toContain('SELECT 1');
  });

  it('maps html class→className and parses a style string into an object', () => {
    const el = renderOne(`<div class="soh" style="color:red;font-size:2px">hi</div>`);
    expect(el.type).toBe('div');
    const props = el.props as { className: string; style: Record<string, string> };
    expect(props.className).toBe('soh');
    expect(props.style).toEqual({ color: 'red', fontSize: '2px' });
  });

  it('renders an unregistered component as null (defensive — validate would reject it)', () => {
    const r = parseJsx(`<Chart/>`);
    if (!r.ok) throw new Error(r.error);
    const out = renderJsx(r.nodes, registry) as unknown[];
    expect(out.filter(isValidElement)).toHaveLength(0);
  });

  it('nests child elements', () => {
    const el = renderOne(`<div><p>a</p><p>b</p></div>`);
    const kids = (el.props as { children: unknown[] }).children.filter(isValidElement) as ReactElement[];
    expect(kids).toHaveLength(2);
    expect(kids[0].type).toBe('p');
  });
});
