// The v2 (JS) orchestrator renders system prompts from prompts.yaml imported
// straight into the bundle — no backend filesystem read (the frontend standalone
// Docker image has no backend/ tree, which previously caused ENOENT → empty v2
// chat stream). These tests pin that the index API renders the real bundled
// prompts with no file access.

import { describe, it, expect } from 'vitest';
import { renderPrompt, listSkills, getSkill } from '../index';
import { VizSettings } from '@/lib/validation/atlas-schemas';

const SYSTEM_VARS = {
  agent_name: 'MinusX',
  max_steps: '30',
  allowed_viz_types: 'all',
  role: '',
  schema: '',
  context: '',
  skills_catalog: '',
  connection_id: '',
  home_folder: '',
  preloaded_skills: '',
};

describe('bundled prompts (standalone-safe, no backend filesystem)', () => {
  it('renders the real default.system prompt from the bundled YAML', () => {
    const out = renderPrompt('default.system', SYSTEM_VARS);
    expect(out.length).toBeGreaterThan(100);
    expect(out).toContain('MinusX');
  });

  it('lists real skills from the bundle', () => {
    expect(Object.keys(listSkills({ skipHidden: true })).length).toBeGreaterThan(0);
  });

  it('resolves a real skill\'s content from the bundle', () => {
    const firstSkill = Object.keys(listSkills())[0];
    expect(getSkill(firstSkill)).toBeTruthy();
  });
});

// The analyst learns complex viz config exclusively from this skill (the tool
// schemas keep vizSettings permissive on purpose so a chart mistake never blocks
// the data query). Combo/dual-axis was undocumented here, so the model invented
// dead keys (`yAxisRight`, `seriesTypes`) — these tests pin the documentation.
describe('visualizations skill — combo + previously-undocumented chart types', () => {
  const viz = getSkill('visualizations') ?? '';
  const vizDescription = listSkills()['visualizations'] ?? '';

  it('documents combo dual-axis configuration', () => {
    for (const token of ['combo', 'yRightCols', 'dualAxis', 'styleConfig']) {
      expect(viz).toContain(token);
    }
  });

  it('documents the other previously-missing chart types', () => {
    for (const token of ['waterfall', 'trend', 'single_value']) {
      expect(viz).toContain(token);
    }
  });

  it('advertises combo in the skill description so the agent loads it', () => {
    expect(vizDescription).toContain('combo');
  });

  // Drift guard: every VizSettings field the skill teaches must still exist on
  // the TypeBox single-source. Rename a field there and this fails, forcing a
  // docs update instead of silently teaching the model a dead key.
  it('only teaches real VizSettings fields (drift guard)', () => {
    const vizKeys = Object.keys((VizSettings as unknown as { properties: Record<string, unknown> }).properties);
    for (const field of ['xCols', 'yCols', 'yRightCols', 'axisConfig', 'styleConfig', 'trendConfig']) {
      expect(vizKeys).toContain(field);
    }
  });

  // Sync guard: every viz type in the TypeBox `type` enum must be documented in
  // the skill. Add a new type to VIZ_TYPES in atlas-schemas.ts and this fails
  // until it's taught here — keeps the prose docs in lock-step with the source
  // without injecting a (semantically poorer) raw schema dump into the prompt.
  it('documents every viz type defined in the TypeBox source', () => {
    const typeEnum = (VizSettings as unknown as {
      properties: { type: { enum?: string[] } };
    }).properties.type.enum ?? [];
    expect(typeEnum.length).toBeGreaterThan(0);
    for (const t of typeEnum) {
      // `table` needs no config section, but is still named in the type list.
      expect(viz, `viz type '${t}' is not documented in the visualizations skill`).toContain(t);
    }
  });
});
