/**
 * Loading templates off disk. This runs at BOOT, over a directory an operator
 * mounts, so the governing rule is: a bad file is skipped with a reason and
 * never takes anything else down with it — not the boot, not its siblings, and
 * above all not the built-in template it would have shadowed.
 *
 * Real files in a real temp directory, deliberately: the failure modes here are
 * filesystem facts (a path that is a file, a dangling name, a dotfile, a nested
 * directory), and a mocked `fs` would let every one of them pass.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadTemplateRegistry } from '@/lib/templates/template-loader.server';
import { vizTemplateEntries, type TemplateDir } from '@/lib/templates/types';
import type { VizRecipeContent } from '@/lib/validation/atlas-schemas';

const RECIPE = (mark: string): VizRecipeContent => ({
  description: `A ${mark} recipe`,
  engine: 'vega-lite',
  bindings: [
    { name: 'label', label: 'Label', accepts: ['nominal'] },
    { name: 'value', label: 'Value', accepts: ['quantitative'] },
  ],
  template: {
    mark,
    encoding: {
      x: { field: '{{label}}', type: '{{label:kind}}' },
      y: { field: '{{value}}', type: 'quantitative' },
    },
  },
} as VizRecipeContent);

let root: string;
let builtinDir: string;
let deploymentDir: string;

/** Write a template file into `<dir>/viz/<name><ext>`. */
function writeTemplate(dir: string, name: string, content: unknown, ext = '.viz') {
  const vizDir = join(dir, 'viz');
  mkdirSync(vizDir, { recursive: true });
  writeFileSync(join(vizDir, `${name}${ext}`), typeof content === 'string' ? content : JSON.stringify(content));
}

const dirs = (...list: TemplateDir[]) => list;
const builtin = (): TemplateDir => ({ dir: builtinDir, origin: 'builtin' });
const deployment = (): TemplateDir => ({ dir: deploymentDir, origin: 'deployment' });

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'mx-templates-'));
  builtinDir = join(root, 'builtin');
  deploymentDir = join(root, 'deployment');
  mkdirSync(builtinDir, { recursive: true });
  mkdirSync(deploymentDir, { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('template loader — directory resolution', () => {
  it('loads the built-in directory alone when no deployment dir is configured', () => {
    writeTemplate(builtinDir, 'bullet', RECIPE('bar'));
    const reg = loadTemplateRegistry(dirs(builtin()));
    expect(Object.keys(reg.viz)).toEqual(['bullet']);
    expect(reg.viz.bullet.origin).toBe('builtin');
    expect(reg.skipped).toEqual([]);
  });

  it('survives a TEMPLATE_DIR that does not exist — the built-ins still load', () => {
    writeTemplate(builtinDir, 'bullet', RECIPE('bar'));
    const reg = loadTemplateRegistry(dirs(builtin(), { dir: join(root, 'nope'), origin: 'deployment' }));
    expect(Object.keys(reg.viz)).toEqual(['bullet']);
    expect(reg.skipped).toHaveLength(1);
    expect(reg.skipped[0].reason).toMatch(/not found|does not exist/i);
  });

  it('survives a TEMPLATE_DIR that is a FILE, not a directory', () => {
    writeTemplate(builtinDir, 'bullet', RECIPE('bar'));
    const asFile = join(root, 'a-file.txt');
    writeFileSync(asFile, 'not a directory');
    const reg = loadTemplateRegistry(dirs(builtin(), { dir: asFile, origin: 'deployment' }));
    expect(Object.keys(reg.viz)).toEqual(['bullet']);
    expect(reg.skipped[0].reason).toMatch(/not a directory/i);
  });

  it('accepts a directory with no viz/ subdirectory (other kinds may still arrive)', () => {
    writeTemplate(builtinDir, 'bullet', RECIPE('bar'));
    const reg = loadTemplateRegistry(dirs(builtin(), deployment()));
    expect(Object.keys(reg.viz)).toEqual(['bullet']);
    expect(reg.skipped).toEqual([]);   // an absent kind is not an error
  });

  it('accepts an empty viz/ directory', () => {
    mkdirSync(join(deploymentDir, 'viz'), { recursive: true });
    writeTemplate(builtinDir, 'bullet', RECIPE('bar'));
    const reg = loadTemplateRegistry(dirs(builtin(), deployment()));
    expect(Object.keys(reg.viz)).toEqual(['bullet']);
  });

  it('reads a directory listed twice only once', () => {
    // TEMPLATE_DIR pointing at the built-in directory must not double-load.
    writeTemplate(builtinDir, 'bullet', RECIPE('bar'));
    const reg = loadTemplateRegistry(dirs(builtin(), { dir: builtinDir, origin: 'deployment' }));
    expect(Object.keys(reg.viz)).toEqual(['bullet']);
    expect(reg.viz.bullet.origin).toBe('builtin');   // the first listing owns it
  });

  it('resolves a relative directory and tolerates a trailing slash', () => {
    writeTemplate(builtinDir, 'bullet', RECIPE('bar'));
    const reg = loadTemplateRegistry(dirs({ dir: `${builtinDir}/`, origin: 'builtin' }));
    expect(Object.keys(reg.viz)).toEqual(['bullet']);
    expect(reg.viz.bullet.sourcePath).not.toContain('//');
  });
});

describe('template loader — which files count', () => {
  it('accepts both .viz and .json', () => {
    writeTemplate(builtinDir, 'one', RECIPE('bar'), '.viz');
    writeTemplate(builtinDir, 'two', RECIPE('line'), '.json');
    const reg = loadTemplateRegistry(dirs(builtin()));
    expect(Object.keys(reg.viz).sort()).toEqual(['one', 'two']);
  });

  it('ignores unrelated files SILENTLY — a README is not a broken template', () => {
    writeTemplate(builtinDir, 'bullet', RECIPE('bar'));
    writeFileSync(join(builtinDir, 'viz', 'README.md'), '# templates');
    writeFileSync(join(builtinDir, 'viz', 'notes.txt'), 'hello');
    const reg = loadTemplateRegistry(dirs(builtin()));
    expect(Object.keys(reg.viz)).toEqual(['bullet']);
    expect(reg.skipped).toEqual([]);
  });

  it('ignores dotfiles, so .DS_Store can never become a template', () => {
    writeTemplate(builtinDir, 'bullet', RECIPE('bar'));
    writeFileSync(join(builtinDir, 'viz', '.DS_Store'), 'junk');
    writeFileSync(join(builtinDir, 'viz', '.gitkeep'), '');
    const reg = loadTemplateRegistry(dirs(builtin()));
    expect(Object.keys(reg.viz)).toEqual(['bullet']);
    expect(reg.skipped).toEqual([]);
  });

  it('does not descend into subdirectories', () => {
    writeTemplate(builtinDir, 'bullet', RECIPE('bar'));
    const nested = join(builtinDir, 'viz', 'nested');
    mkdirSync(nested, { recursive: true });
    writeFileSync(join(nested, 'deep.viz'), JSON.stringify(RECIPE('point')));
    const reg = loadTemplateRegistry(dirs(builtin()));
    expect(Object.keys(reg.viz)).toEqual(['bullet']);
  });

  it('falls through to the next extension when the higher-precedence file is INVALID', () => {
    // Precedence decides which file WINS, not which file is the only one tried.
    // Skipping both would delete the template outright over a typo in one of them.
    writeTemplate(builtinDir, 'bullet', '{ broken', '.viz');
    writeTemplate(builtinDir, 'bullet', RECIPE('line'), '.json');
    const reg = loadTemplateRegistry(dirs(builtin()));
    expect(reg.viz.bullet.content.template.mark).toBe('line');
    expect(reg.skipped.some((s) => s.path.endsWith('bullet.viz') && /json/i.test(s.reason))).toBe(true);
  });

  it('reports a viz/ directory it cannot read, rather than treating it as absent', () => {
    // "You have no templates" and "I could not read your templates" must not look
    // the same to an operator debugging a mount.
    const vizDir = join(deploymentDir, 'viz');
    mkdirSync(vizDir, { recursive: true });
    writeFileSync(join(vizDir, 'ok.viz'), JSON.stringify(RECIPE('bar')));
    chmodSync(vizDir, 0o000);
    try {
      const reg = loadTemplateRegistry(dirs(deployment()));
      expect(reg.skipped.some((s) => /could not be read|permission/i.test(s.reason))).toBe(true);
    } finally {
      chmodSync(vizDir, 0o755);
    }
  });

  it('breaks a same-name collision deterministically and records the loser', () => {
    writeTemplate(builtinDir, 'bullet', RECIPE('bar'), '.viz');
    writeTemplate(builtinDir, 'bullet', RECIPE('line'), '.json');
    const reg = loadTemplateRegistry(dirs(builtin()));
    expect(reg.viz.bullet.content.template.mark).toBe('bar');   // .viz wins by extension order
    expect(reg.skipped.some((s) => s.path.endsWith('bullet.json') && /collide|duplicate/i.test(s.reason))).toBe(true);
  });
});

describe('template loader — content validation', () => {
  it('skips malformed JSON and still loads its siblings', () => {
    writeTemplate(builtinDir, 'good', RECIPE('bar'));
    writeTemplate(builtinDir, 'broken', '{ "description": ', '.viz');
    const reg = loadTemplateRegistry(dirs(builtin()));
    expect(Object.keys(reg.viz)).toEqual(['good']);
    expect(reg.skipped.some((s) => s.path.endsWith('broken.viz') && /json/i.test(s.reason))).toBe(true);
  });

  it('skips an empty file', () => {
    writeTemplate(builtinDir, 'empty', '', '.viz');
    const reg = loadTemplateRegistry(dirs(builtin()));
    expect(reg.viz).toEqual({});
    expect(reg.skipped).toHaveLength(1);
  });

  it.each([
    ['an array', '[]'],
    ['a string', '"hello"'],
    ['null', 'null'],
    ['a number', '42'],
  ])('skips %s at the top level', (_label, json) => {
    writeTemplate(builtinDir, 'odd', json, '.viz');
    const reg = loadTemplateRegistry(dirs(builtin()));
    expect(reg.viz).toEqual({});
    expect(reg.skipped).toHaveLength(1);
  });

  it('skips content that is not a valid recipe, naming the problem', () => {
    writeTemplate(builtinDir, 'noslots', { description: 'x', engine: 'vega-lite', template: { mark: 'bar' } });
    const reg = loadTemplateRegistry(dirs(builtin()));
    expect(reg.viz).toEqual({});
    expect(reg.skipped[0].reason).toMatch(/bindings/i);
  });

  it('skips a template whose token is not declared — caught at BOOT, not at render', () => {
    const undeclared = {
      ...RECIPE('bar'),
      template: { mark: 'bar', encoding: { x: { field: '{{nope}}', type: 'nominal' } } },
    };
    writeTemplate(builtinDir, 'undeclared', undeclared);
    const reg = loadTemplateRegistry(dirs(builtin()));
    expect(reg.viz).toEqual({});
    expect(reg.skipped[0].reason).toMatch(/nope/);
  });
});

describe('template loader — names', () => {
  it.each([
    ['a space', 'my recipe'],
    ['an @ version suffix', 'bullet@1'],
    ['a leading dash', '-bullet'],
  ])('skips a file whose name has %s', (_label, name) => {
    writeTemplate(builtinDir, name, RECIPE('bar'));
    const reg = loadTemplateRegistry(dirs(builtin()));
    expect(reg.viz).toEqual({});
    expect(reg.skipped[0].reason).toMatch(/name/i);
  });

  it('treats names case-sensitively, the way file shadowing does', () => {
    writeTemplate(builtinDir, 'bullet', RECIPE('bar'));
    writeTemplate(deploymentDir, 'Bullet', RECIPE('line'));
    const reg = loadTemplateRegistry(dirs(builtin(), deployment()));
    expect(Object.keys(reg.viz).sort()).toEqual(['Bullet', 'bullet']);
    expect(reg.viz.bullet.content.template.mark).toBe('bar');
  });
});

describe('template loader — overlay, not replace', () => {
  it('lets a deployment template shadow a built-in of the same name', () => {
    writeTemplate(builtinDir, 'bullet', RECIPE('bar'));
    writeTemplate(deploymentDir, 'bullet', RECIPE('tick'));
    const reg = loadTemplateRegistry(dirs(builtin(), deployment()));
    expect(reg.viz.bullet.content.template.mark).toBe('tick');
    expect(reg.viz.bullet.origin).toBe('deployment');
  });

  it('keeps every built-in the deployment did not override', () => {
    writeTemplate(builtinDir, 'bullet', RECIPE('bar'));
    writeTemplate(builtinDir, 'lollipop', RECIPE('point'));
    writeTemplate(deploymentDir, 'bullet', RECIPE('tick'));
    const reg = loadTemplateRegistry(dirs(builtin(), deployment()));
    expect(Object.keys(reg.viz).sort()).toEqual(['bullet', 'lollipop']);
    expect(reg.viz.lollipop.origin).toBe('builtin');
  });

  it('adds deployment-only templates', () => {
    writeTemplate(builtinDir, 'bullet', RECIPE('bar'));
    writeTemplate(deploymentDir, 'company-kpi', RECIPE('rect'));
    const reg = loadTemplateRegistry(dirs(builtin(), deployment()));
    expect(reg.viz['company-kpi'].origin).toBe('deployment');
  });

  it('an INVALID deployment template must not knock out the built-in it would shadow', () => {
    // The failure that matters most: a typo in one operator file silently
    // deleting a working recipe from every workspace.
    writeTemplate(builtinDir, 'bullet', RECIPE('bar'));
    writeTemplate(deploymentDir, 'bullet', '{ broken json', '.viz');
    const reg = loadTemplateRegistry(dirs(builtin(), deployment()));
    expect(reg.viz.bullet.content.template.mark).toBe('bar');
    expect(reg.viz.bullet.origin).toBe('builtin');
    expect(reg.skipped).toHaveLength(1);
  });

  it('exposes the shadowed set as name → { content, origin }', () => {
    writeTemplate(builtinDir, 'bullet', RECIPE('bar'));
    writeTemplate(deploymentDir, 'bullet', RECIPE('tick'));
    const entries = vizTemplateEntries(loadTemplateRegistry(dirs(builtin(), deployment())));
    expect(Object.keys(entries)).toEqual(['bullet']);
    expect(entries.bullet.content.template.mark).toBe('tick');
    // Origin travels with it: an operator must be able to see their own override.
    expect(entries.bullet.origin).toBe('deployment');
  });
});

describe('template loader — hostile input', () => {
  it('does not follow a symlink out of the templates directory', () => {
    const outside = join(root, 'outside');
    mkdirSync(outside, { recursive: true });
    writeFileSync(join(outside, 'secret.viz'), JSON.stringify(RECIPE('bar')));
    mkdirSync(join(builtinDir, 'viz'), { recursive: true });
    symlinkSync(join(outside, 'secret.viz'), join(builtinDir, 'viz', 'linked.viz'));
    const reg = loadTemplateRegistry(dirs(builtin()));
    expect(reg.viz).toEqual({});
    expect(reg.skipped.some((s) => /symlink/i.test(s.reason))).toBe(true);
  });

  it('never throws, whatever the directory holds', () => {
    writeTemplate(builtinDir, 'ok', RECIPE('bar'));
    writeTemplate(builtinDir, 'bad', '{{{', '.viz');
    writeFileSync(join(builtinDir, 'viz', '.DS_Store'), '\0\0\0');
    expect(() => loadTemplateRegistry(dirs(builtin(), { dir: '/definitely/not/here', origin: 'deployment' }))).not.toThrow();
  });
});
