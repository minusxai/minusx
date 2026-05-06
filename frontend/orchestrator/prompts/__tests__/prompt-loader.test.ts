import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  clearPromptCache,
  loadPrompts,
  pyFormat,
  renderPrompt,
} from '../prompt-loader';

function makeYaml(content: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'mx-prompts-'));
  const file = path.join(dir, 'prompts.yaml');
  writeFileSync(file, content, 'utf-8');
  return file;
}

afterEach(() => clearPromptCache());

describe('pyFormat', () => {
  it('substitutes {var}', () => {
    expect(pyFormat('hello {name}', { name: 'world' })).toBe('hello world');
  });

  it('escapes {{ and }} to literal braces', () => {
    expect(pyFormat('{{"x": 1}}', {})).toBe('{"x": 1}');
  });

  it('mixes substitution and escapes', () => {
    expect(pyFormat('{{ {n} }}', { n: 5 })).toBe('{ 5 }');
  });

  it('throws on missing variable', () => {
    expect(() => pyFormat('hi {who}', {})).toThrow(/Missing variable 'who'/);
  });

  it('throws on unbalanced single braces', () => {
    expect(() => pyFormat('oops { broken', { broken: 'x' })).toThrow();
    expect(() => pyFormat('oops } here', {})).toThrow();
  });

  it('passes through JSON example blocks via {{ }} escapes', () => {
    const text = '{{"name": "{n}", "items": [{{"id": 1}}]}}';
    expect(pyFormat(text, { n: 'foo' })).toBe('{"name": "foo", "items": [{"id": 1}]}');
  });
});

describe('renderPrompt', () => {
  it('renders nested {path.to.template} refs', () => {
    const file = makeYaml(`
templates:
  greeting:
    formal: "Greetings, {name}."
prompts:
  hello: "{greeting.formal}"
`);
    expect(renderPrompt(file, 'hello', { name: 'Sam' })).toBe('Greetings, Sam.');
    rmSync(path.dirname(file), { recursive: true });
  });

  it('renders simple {template_name} refs when template exists', () => {
    const file = makeYaml(`
templates:
  intro: "I am the AnalystAgent."
prompts:
  default:
    system: "{intro} Here are tools: {tools}."
`);
    expect(renderPrompt(file, 'default.system', { tools: 'a, b' })).toBe(
      'I am the AnalystAgent. Here are tools: a, b.',
    );
    rmSync(path.dirname(file), { recursive: true });
  });

  it('resolves nested templates recursively', () => {
    const file = makeYaml(`
templates:
  outer: "outer({inner})"
  inner: "INNER"
prompts:
  p: "{outer}"
`);
    expect(renderPrompt(file, 'p', {})).toBe('outer(INNER)');
    rmSync(path.dirname(file), { recursive: true });
  });

  it('throws on missing prompt', () => {
    const file = makeYaml(`prompts: {}\ntemplates: {}\n`);
    expect(() => renderPrompt(file, 'nope', {})).toThrow(/Prompt 'nope' not found/);
    rmSync(path.dirname(file), { recursive: true });
  });

  it('throws on missing nested template', () => {
    const file = makeYaml(`
templates: {}
prompts:
  p: "{a.b}"
`);
    expect(() => renderPrompt(file, 'p', {})).toThrow(/Template 'a.b' not found/);
    rmSync(path.dirname(file), { recursive: true });
  });

  it('passes JSON example blocks (with {{/}} escapes) through unchanged', () => {
    const file = makeYaml(`
templates: {}
prompts:
  p: |
    Example: {{"name": "{user}", "id": 1}}.
`);
    const out = renderPrompt(file, 'p', { user: 'sam' });
    expect(out).toContain('Example: {"name": "sam", "id": 1}.');
    rmSync(path.dirname(file), { recursive: true });
  });
});

describe('loadPrompts caching', () => {
  it('returns the same tree on repeat reads (cache hit)', () => {
    const file = makeYaml(`templates: {}\nprompts: {p: "x"}\n`);
    const a = loadPrompts(file);
    const b = loadPrompts(file);
    expect(a).toBe(b);
    rmSync(path.dirname(file), { recursive: true });
  });
});
