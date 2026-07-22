/**
 * Story interpreter — contract tests (Story_Design_V2 §2).
 *
 * The interpreter turns a VALIDATED static-JSX AST into React elements over an injected
 * component registry. No eval, ever. It is the second gate after validateJsxSource
 * (defense in depth): even if an unvalidated AST reaches it, dangerous props never reach
 * React. Tested here with a stub registry — the real shadcn registry plugs in unchanged.
 */
import { describe, it, expect } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { parseJsx } from '@/lib/jsx';
import { renderStoryNodes } from '../interpreter';

const propsProbe: Record<string, unknown>[] = [];
const StubCard = ({ children, ...props }: { children?: React.ReactNode } & Record<string, unknown>) => {
  propsProbe.push(props);
  return <div aria-label="stub-card" {...(props as object)}>{children}</div>;
};
const REGISTRY: Record<string, React.ComponentType<Record<string, unknown>>> = {
  Card: StubCard as React.ComponentType<Record<string, unknown>>,
};

const mount = (src: string) => {
  const parsed = parseJsx(src);
  if (!parsed.ok) throw new Error(parsed.error);
  return render(<>{renderStoryNodes(parsed.nodes, { components: REGISTRY })}</>);
};

beforeEach(() => { propsProbe.length = 0; });

describe('rendering basics', () => {
  it('renders HTML tags with className/htmlFor mapping (class/for authored)', () => {
    const { container } = mount('<div class="a b"><label for="x" aria-label="lab">L</label></div>');
    const div = container.querySelector('div.a.b');
    expect(div).toBeTruthy();
    expect(screen.getByLabelText('lab').getAttribute('for')).toBe('x');
  });

  it('renders registry components with children and string props', () => {
    mount('<Card title="hello">body</Card>');
    expect(screen.getByLabelText('stub-card').textContent).toBe('body');
    expect(propsProbe[0].title).toBe('hello');
  });

  it('renders text and static expression children', () => {
    const { container } = mount('<p>count: {42}</p>');
    expect(container.querySelector('p')!.textContent).toBe('count: 42');
  });

  it('converts inline style strings to React style objects on HTML tags', () => {
    const { container } = mount('<div style="color: rgb(1, 2, 3); margin-top: 4px">x</div>');
    const el = container.querySelector('div')! as HTMLElement;
    expect(el.style.color).toBe('rgb(1, 2, 3)');
    expect(el.style.marginTop).toBe('4px');
  });

  it('stamps every element with its AST path (WYSIWYG write-back anchor)', () => {
    const { container } = mount('<div><p>a</p><p>b</p></div>');
    const ps = container.querySelectorAll('p');
    expect(ps[0].getAttribute('data-mx-ast')).toBe('0.0');
    expect(ps[1].getAttribute('data-mx-ast')).toBe('0.1');
  });
});

describe('controlled → uncontrolled prop mapping (components only)', () => {
  it('maps open/checked to their default* forms on components', () => {
    mount('<Card open={true} checked={false} />');
    expect(propsProbe[0].defaultOpen).toBe(true);
    expect(propsProbe[0].defaultChecked).toBe(false);
    expect(propsProbe[0].open).toBeUndefined();
  });

  it('maps value only on the stateful roots (Tabs/Accordion), never on identity/data value props', () => {
    const Stub = REGISTRY.Card;
    REGISTRY.Tabs = Stub;
    REGISTRY.TabsTrigger = Stub;
    try {
      // Tabs value selects a pane → controlled → remapped.
      mount('<Tabs value="a" />');
      expect(propsProbe[0].defaultValue).toBe('a');
      expect(propsProbe[0].value).toBeUndefined();
      // TabsTrigger value NAMES a pane (identity, like Progress value={60} is data) → kept.
      propsProbe.length = 0;
      mount('<TabsTrigger value="a" />');
      expect(propsProbe[0].value).toBe('a');
      expect(propsProbe[0].defaultValue).toBeUndefined();
    } finally {
      delete REGISTRY.Tabs;
      delete REGISTRY.TabsTrigger;
    }
  });
});

describe('prop deny list (defense in depth — even on an unvalidated AST)', () => {
  it('drops on* handlers, ref/key, dangerouslySetInnerHTML, srcDoc, is', () => {
    const { container } = mount(
      '<div onClick="alert(1)" onmouseover="x" is="c-e" srcDoc="s">x</div>');
    const el = container.querySelector('div')!;
    expect(el.getAttribute('onClick')).toBeNull();
    expect(el.getAttribute('onmouseover')).toBeNull();
    expect(el.getAttribute('is')).toBeNull();
    expect(el.getAttribute('srcDoc')).toBeNull();
    expect(el.getAttribute('srcdoc')).toBeNull();
  });

  it('drops dangerous URL schemes on href/src (control-char normalized)', () => {
    const { container } = mount(`<a href="java\tscript:alert(1)">x</a>`);
    expect(container.querySelector('a')!.getAttribute('href')).toBeNull();
  });

  it('keeps safe URLs', () => {
    const { container } = mount('<a href="https://example.com">x</a>');
    expect(container.querySelector('a')!.getAttribute('href')).toBe('https://example.com');
  });

  it('drops object props on HTML tags (except style) but passes them to components', () => {
    const { container } = mount('<div data-x={{ a: 1 }}>x</div>');
    expect(container.querySelector('div')!.getAttribute('data-x')).toBeNull();
    mount('<Card viz={{ type: "bar" }} />');
    expect(propsProbe[0].viz).toEqual({ type: 'bar' });
  });
});

describe('unknown tags', () => {
  it('renders nothing for unregistered components (validator rejects them; interpreter stays safe)', () => {
    const { container } = mount('<Nope>hidden</Nope>');
    expect(container.textContent).toBe('');
  });
});
