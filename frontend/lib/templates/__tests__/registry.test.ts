/**
 * The boot path itself — everything `loadTemplateRegistry` does NOT own: which
 * directories are read and in what order, the memo, and the side effect that
 * installs the built-in recipe set.
 *
 * The loader suite covers overlay semantics thoroughly, but every one of those
 * cases hands the loader its directory list directly. Flip the two entries in
 * `templateDirs()` and the overlay inverts — built-ins would shadow the
 * deployment — with all of them still green. This is the test that notices.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// TEMPLATE_DIR is read from the server config at module load, so it has to be
// mockable per test rather than baked in.
const configMock = vi.hoisted(() => ({ TEMPLATE_DIR: undefined as string | undefined }));
vi.mock('@/lib/config', () => configMock);

import { appTemplateDir, getTemplateRegistry, resetTemplateRegistryForTests, templateDirs } from '@/lib/templates/registry.server';
import { getBuiltinVizRecipes, setBuiltinVizTemplates } from '@/lib/viz/builtin-recipes';

const RECIPE = (mark: string) => ({
  description: `A ${mark} recipe`,
  engine: 'vega-lite',
  bindings: [
    { name: 'label', label: 'Label', accepts: ['nominal'] },
    { name: 'value', label: 'Value', accepts: ['quantitative'] },
  ],
  template: {
    mark,
    encoding: { x: { field: '{{label}}', type: '{{label:kind}}' }, y: { field: '{{value}}', type: 'quantitative' } },
  },
});

let deploymentDir: string;

beforeEach(() => {
  deploymentDir = mkdtempSync(join(tmpdir(), 'mx-registry-'));
  mkdirSync(join(deploymentDir, 'viz'), { recursive: true });
  configMock.TEMPLATE_DIR = undefined;
  resetTemplateRegistryForTests();
});

afterEach(() => {
  rmSync(deploymentDir, { recursive: true, force: true });
  configMock.TEMPLATE_DIR = undefined;
  resetTemplateRegistryForTests();
});

describe('template registry (boot path)', () => {
  it('reads the app templates that ship in the image', () => {
    // The real directory, not a fixture: if `templates/` is ever dropped from
    // the repo or the image, this is what says so.
    expect(appTemplateDir().endsWith('/templates')).toBe(true);
    const registry = getTemplateRegistry();
    expect(Object.keys(registry.viz)).toEqual(expect.arrayContaining(['bullet', 'lollipop', 'range-bar']));
    expect(registry.viz.bullet.origin).toBe('builtin');
  });

  it('lists TEMPLATE_DIR AFTER the app directory, so a deployment shadows and not the reverse', () => {
    configMock.TEMPLATE_DIR = deploymentDir;
    expect(templateDirs().map((d) => d.origin)).toEqual(['builtin', 'deployment']);
    expect(templateDirs()[1].dir).toBe(deploymentDir);
  });

  it('omits the deployment directory entirely when TEMPLATE_DIR is unset', () => {
    expect(templateDirs().map((d) => d.origin)).toEqual(['builtin']);
  });

  it('lets a deployment template override a shipped one, end to end', () => {
    writeFileSync(join(deploymentDir, 'viz', 'bullet.viz'), JSON.stringify(RECIPE('tick')));
    writeFileSync(join(deploymentDir, 'viz', 'company-kpi.viz'), JSON.stringify(RECIPE('rect')));
    configMock.TEMPLATE_DIR = deploymentDir;
    resetTemplateRegistryForTests();

    const registry = getTemplateRegistry();
    expect(registry.viz.bullet.origin).toBe('deployment');
    expect(registry.viz.bullet.content.template.mark).toBe('tick');
    expect(registry.viz['company-kpi'].origin).toBe('deployment');
    // …and the app templates it did not name are untouched.
    expect(registry.viz.lollipop.origin).toBe('builtin');
  });

  it('installs the built-in recipe registry as a side effect — resolution reads that, not the return value', () => {
    setBuiltinVizTemplates({});
    expect(getBuiltinVizRecipes()).toEqual({});
    getTemplateRegistry();
    expect(Object.keys(getBuiltinVizRecipes())).toEqual(expect.arrayContaining(['bullet']));
  });

  it('loads once and memoizes — boot cost is paid a single time', () => {
    const first = getTemplateRegistry();
    const second = getTemplateRegistry();
    expect(second).toBe(first);
  });
});
