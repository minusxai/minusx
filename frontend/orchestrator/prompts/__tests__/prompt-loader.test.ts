import yaml from 'js-yaml';
import { getSkill, listSkills, pyFormat, renderPrompt, type PromptTree } from '../prompt-loader';

// The engine operates on an in-memory PromptTree; parse small YAML fixtures into
// trees for readability.
function tree(content: string): PromptTree {
  const parsed = (yaml.load(content) ?? {}) as Partial<PromptTree>;
  return { templates: parsed.templates ?? {}, prompts: parsed.prompts ?? {} };
}

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
    const t = tree(`
templates:
  greeting:
    formal: "Greetings, {name}."
prompts:
  hello: "{greeting.formal}"
`);
    expect(renderPrompt(t, 'hello', { name: 'Sam' })).toBe('Greetings, Sam.');
  });

  it('renders simple {template_name} refs when template exists', () => {
    const t = tree(`
templates:
  intro: "I am the AnalystAgent."
prompts:
  default:
    system: "{intro} Here are tools: {tools}."
`);
    expect(renderPrompt(t, 'default.system', { tools: 'a, b' })).toBe(
      'I am the AnalystAgent. Here are tools: a, b.',
    );
  });

  it('resolves nested templates recursively', () => {
    const t = tree(`
templates:
  outer: "outer({inner})"
  inner: "INNER"
prompts:
  p: "{outer}"
`);
    expect(renderPrompt(t, 'p', {})).toBe('outer(INNER)');
  });

  it('throws on missing prompt', () => {
    expect(() => renderPrompt(tree(`prompts: {}\ntemplates: {}\n`), 'nope', {})).toThrow(
      /Prompt 'nope' not found/,
    );
  });

  it('throws on missing nested template', () => {
    const t = tree(`
templates: {}
prompts:
  p: "{a.b}"
`);
    expect(() => renderPrompt(t, 'p', {})).toThrow(/Template 'a.b' not found/);
  });

  it('passes JSON example blocks (with {{/}} escapes) through unchanged', () => {
    const t = tree(`
templates: {}
prompts:
  p: |
    Example: {{"name": "{user}", "id": 1}}.
`);
    expect(renderPrompt(t, 'p', { user: 'sam' })).toContain('Example: {"name": "sam", "id": 1}.');
  });
});

// Mirrors Python prompt_loader.list_skills / get_skill: skills are templates
// whose keys start with `skill_`; HIDDEN_SKILLS (the nav skills) are dropped
// when skipHidden is set; get_skill resolves nested template refs but does NOT
// run variable substitution (so `{{` JSON escapes stay literal — matching the
// preloaded-skills injection path).
const SKILLS = tree(`
templates:
  shared: "SHARED_FRAGMENT"
  skill_questions:
    description: "How to work with question files"
    content: |
      Questions body uses {shared}.
      Example {{"query": "SELECT 1"}}
  skill_dashboards:
    description: "How to work with dashboards"
    content: "Dashboards body"
  skill_navigation_restricted:
    description: "restricted nav"
    content: "Restricted nav body"
  skill_navigation_unrestricted:
    description: "unrestricted nav"
    content: "Unrestricted nav body"
  skill_empty:
    description: "no content"
    content: ""
prompts:
  p: "x"
`);

describe('listSkills', () => {
  it('returns name → description for every skill_* template (prefix stripped)', () => {
    expect(listSkills(SKILLS)).toEqual({
      questions: 'How to work with question files',
      dashboards: 'How to work with dashboards',
      navigation_restricted: 'restricted nav',
      navigation_unrestricted: 'unrestricted nav',
      empty: 'no content',
    });
  });

  it('drops HIDDEN_SKILLS (nav skills) when skipHidden is set', () => {
    const names = Object.keys(listSkills(SKILLS, { skipHidden: true }));
    expect(names).toContain('questions');
    expect(names).not.toContain('navigation_restricted');
    expect(names).not.toContain('navigation_unrestricted');
  });
});

describe('getSkill', () => {
  it('resolves nested template refs in skill content', () => {
    expect(getSkill(SKILLS, 'questions')).toContain('Questions body uses SHARED_FRAGMENT.');
  });

  it('does NOT run variable substitution — {{ }} JSON escapes stay literal', () => {
    expect(getSkill(SKILLS, 'questions')).toContain('{{"query": "SELECT 1"}}');
  });

  it('returns null for an unknown skill', () => {
    expect(getSkill(SKILLS, 'does_not_exist')).toBeNull();
  });

  it('returns null for a skill with empty content', () => {
    expect(getSkill(SKILLS, 'empty')).toBeNull();
  });
});
