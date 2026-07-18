// The v2 (JS) orchestrator renders system prompts from prompts.yaml imported
// straight into the bundle — no backend filesystem read (the frontend standalone
// Docker image has no backend/ tree, which previously caused ENOENT → empty v2
// chat stream). These tests pin that the index API renders the real bundled
// prompts with no file access.

import { describe, it, expect } from 'vitest';
import { renderPrompt, listSkills, getSkill } from '../index';

const SYSTEM_VARS = {
  agent_name: 'MinusX',
  max_steps: '30',
  allowed_viz_types: 'all',
  role: '',
  schema: '',
  context: '',
  context_docs_catalog: '',
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

// Viz-first posture (Viz V2): the `<viz>` envelope is the DEFAULT authoring
// format everywhere the agent is taught charts. Legacy vizSettings stays
// documented (rollback path, Slack cheat-sheet) but must never be presented as
// the format to author for new charts.
describe('viz-first prompts — envelope is the default authoring format', () => {
  const questions = getSkill('questions') ?? '';
  const questionsDescription = listSkills()['questions'] ?? '';

  it('the envelope grammar + shipped recipes live in the questions skill', () => {
    for (const token of ['<kind>vega-lite</kind>', 'minusx/funnel@1', '<kind>recipe</kind>', '<kind>table</kind>']) {
      expect(questions).toContain(token);
    }
  });

  it('the questions skill teaches viz as the default and vizSettings as legacy-only', () => {
    expect(questions).toMatch(/author EVERY new chart as a `<viz>` envelope/i);
    expect(questions).toMatch(/Legacy VizSettings[\s\S]*do NOT author it for new charts/);
  });

  it('the questions skill teaches the grammar ladder — vega-lite/recipes first, native vega only as the escape hatch', () => {
    expect(questions).toMatch(/native `vega` ONLY when Vega-Lite cannot express/i);
    expect(questions).toMatch(/DetachViz/);
  });

  it('spreadsheet questions are charted via <viz>, not vizSettings', () => {
    expect(questions).toMatch(/spreadsheet data — author `<viz>`/);
  });

  it('skill catalog descriptions reflect the envelope-first split', () => {
    expect(questionsDescription).toContain('viz envelope');
  });

  // The legacy VizSettings deep-dive skill is deleted outright: vizSettings is
  // ignore-only for the agent (never authored, never modified), so its schema
  // needs no documentation. The envelope grammar lives in the questions skill.
  it('the legacy visualizations skill no longer exists', () => {
    expect(listSkills()['visualizations']).toBeUndefined();
    expect(getSkill('visualizations')).toBeFalsy();
    expect(getSkill('questions') ?? '').not.toContain('preloaded below');
  });

  it('the analyst tool docs point envelope-seekers at the questions skill (which explore/slack pages do not preload)', () => {
    const out = renderPrompt('default.system', SYSTEM_VARS);
    expect(out).toContain('LoadSkill("questions")');
    // the envelope is named by grammar, not just "V2"
    expect(out).toMatch(/viz envelope, i\.e\. a Vega-Lite v6 spec/);
    expect(out).not.toMatch(/envelope grammar[^\n]*LoadSkill\("visualizations"\)/);
  });

  it('allowed_viz_types restriction covers V2 recipe equivalents, not just vizSettings.type', () => {
    const out = renderPrompt('default.system', SYSTEM_VARS);
    expect(out).toMatch(/allowed visualization types[\s\S]{0,600}recipe equivalent/i);
  });

  it('the Slack chart section is viz-envelope-first and defers to the preloaded questions skill', () => {
    const out = renderPrompt('slack_addendum', {});
    expect(out).toMatch(/include an appropriate `viz` envelope/);
    expect(out).toContain('preloaded questions skill');
    expect(out).not.toMatch(/include appropriate `vizSettings`/);
    // the grammar itself is NOT restated here — it lives in the preloaded questions skill
    expect(out).not.toContain('"version": 2');
    expect(out).not.toMatch(/Use `bar` for vertical comparisons/);
  });

  it('onboarding dashboard prompt authors <viz> envelopes, never vizSettings', () => {
    const out = renderPrompt('onboarding_dashboard.system', {
      agent_name: 'MinusX',
      schema: '',
      context: '',
      connection_id: 'conn',
      max_steps: '25',
      dashboards_skill: '',
    });
    expect(out).toContain('<viz>');
    expect(out).toContain('<kind>vega-lite</kind>');
    expect(out).not.toContain('vizSettings');
  });
});
