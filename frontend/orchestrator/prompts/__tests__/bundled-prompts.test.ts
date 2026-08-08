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
  viz_recipes: '',
  role: '',
  schema: '',
  context: '',
  context_docs_catalog: '',
  skills_catalog: '',
  connection_id: '',
  home_folder: '',
  preloaded_skills: '',
  agent_persona: '',
};

describe('bundled prompts (standalone-safe, no backend filesystem)', () => {
  it('renders the real default.system prompt from the bundled YAML', () => {
    const out = renderPrompt('default.system', SYSTEM_VARS);
    expect(out.length).toBeGreaterThan(100);
    expect(out).toContain('MinusX');
  });

  it('default.system carries the {agent_persona} slot (custom agents, append mode)', () => {
    const out = renderPrompt('default.system', { ...SYSTEM_VARS, agent_persona: 'PERSONA_SLOT_MARKER' });
    expect(out).toContain('PERSONA_SLOT_MARKER');
    // empty persona leaves no dangling heading behind
    const empty = renderPrompt('default.system', SYSTEM_VARS);
    expect(empty).not.toContain('PERSONA_SLOT_MARKER');
  });

  it('renders custom_agent_replace.system: persona + app structure + dynamic sections, no intro/guidelines', () => {
    const out = renderPrompt('custom_agent_replace.system', {
      ...SYSTEM_VARS,
      agent_persona: 'REPLACE_BODY_MARKER',
      schema: 'tbl_a',
      connection_id: 'conn-x',
    });
    expect(out).toContain('REPLACE_BODY_MARKER');
    expect(out).toContain('## Application Structure');
    expect(out).toContain('## Available Database Schema');
    expect(out).toContain('conn-x');
    expect(out).not.toContain('expert data analyst');    // intro
    expect(out).not.toContain('### Response Guidelines'); // guidelines
  });

  it('lists real skills from the bundle', () => {
    expect(Object.keys(listSkills({ skipHidden: true })).length).toBeGreaterThan(0);
  });

  it('resolves a real skill\'s content from the bundle', () => {
    const firstSkill = Object.keys(listSkills())[0];
    expect(getSkill(firstSkill)).toBeTruthy();
  });

  it('teaches Tailwind as the only forward Story styling contract', () => {
    const stories = getSkill('stories') ?? '';
    const examples = [...stories.matchAll(/```[^\n]*\n([\s\S]*?)```/g)].map(match => match[1]).join('\n');
    expect(stories).toMatch(/Tailwind tokens \+ utilities are the ONLY authored styling path for the entire Story DOM/);
    expect(stories).toContain('There is no Story-CSS escape hatch');
    expect(stories).toContain('Do not author `<style>` blocks');
    expect(examples).not.toMatch(/<style\b/i);
    expect(examples).not.toMatch(/\sstyle\s*=/i);
    expect(examples).not.toMatch(/\blabelStyle\b/i);
    expect(examples).not.toMatch(/\bcss\s*:/i);
    expect(stories).not.toContain('table CSS contract');
    expect(stories).toContain('The one CSS exception is scoped table/pivot visualization CSS');
    expect(stories).toContain('use only `source.css` with the stable `.mx-table`, `.mx-th`, `.mx-row`, `.mx-cell`, `.mx-col-*`');
    expect(stories).toContain('Style the embed\'s surrounding Story element only with Tailwind');
  });

  it('localizes ordinary Story edits to the user\'s current viewport', () => {
    const stories = getSkill('stories') ?? '';
    expect(stories).toContain('Default to the user\'s current viewport');
    expect(stories).toContain('general, story-wide, repeated-pattern, or structural change');
    expect(stories).toContain('do not propagate them into off-screen sections');
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
