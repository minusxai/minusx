// The v2 (JS) orchestrator renders system prompts from prompts.json imported
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
  skills_catalog: '',
  connection_id: '',
  home_folder: '',
  preloaded_skills: '',
};

describe('bundled prompts (standalone-safe, no backend filesystem)', () => {
  it('renders the real default.system prompt from the bundled JSON', () => {
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
