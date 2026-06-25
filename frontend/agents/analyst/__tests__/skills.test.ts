// Skills logic for the analyst agent: page-type
// derivation, preloaded-skill selection (PAGE_SKILL_MAP + selected system
// skills + nav skill), the LoadSkill catalog, and the preloaded-skill content
// block.

import yaml from 'js-yaml';
import type { AgentSkillSelection } from '@/lib/types';
import type { PromptTree } from '@/orchestrator/prompts/prompt-loader';
import {
  getPageType,
  getPreloadedSkillNames,
  buildSkillsCatalog,
  buildPreloadedSkillsContent,
} from '../skills';

const TREE = yaml.load(`
templates:
  skill_questions:
    description: "Question files"
    content: "Questions content"
  skill_dashboards:
    description: "Dashboards"
    content: "Dashboards content"
  skill_explore:
    description: "Explore"
    content: "Explore content"
  skill_alerts:
    description: "Alerts"
    content: "Alerts content"
  skill_navigation_restricted:
    description: "restricted nav"
    content: "Restricted nav content"
  skill_navigation_unrestricted:
    description: "unrestricted nav"
    content: "Unrestricted nav content"
prompts:
  p: "x"
`) as PromptTree;

describe('getPageType', () => {
  it('passes through explore / folder / slack top-level types', () => {
    expect(getPageType({ type: 'explore' })).toBe('explore');
    expect(getPageType({ type: 'folder' })).toBe('folder');
    expect(getPageType({ type: 'slack' })).toBe('slack');
  });

  it('reads the file type from state.fileState.type for file pages', () => {
    expect(getPageType({ type: 'file', state: { fileState: { type: 'question' } } })).toBe('question');
    expect(getPageType({ type: 'file', state: { fileState: { type: 'dashboard' } } })).toBe('dashboard');
  });

  it('returns null for malformed file state or unknown / non-object app state', () => {
    expect(getPageType({ type: 'file' })).toBeNull();
    expect(getPageType({ type: 'file', state: {} })).toBeNull();
    expect(getPageType({ type: 'mystery' })).toBeNull();
    expect(getPageType(null)).toBeNull();
    expect(getPageType('nope')).toBeNull();
  });
});

describe('getPreloadedSkillNames', () => {
  it('maps page type to skills and appends the restricted nav skill by default', () => {
    expect(getPreloadedSkillNames({ pageType: 'question', selected: [], unrestrictedMode: false }))
      .toEqual(['questions', 'visualizations', 'navigation_restricted']);
    expect(getPreloadedSkillNames({ pageType: 'dashboard', selected: [], unrestrictedMode: false }))
      .toEqual(['dashboards', 'questions', 'visualizations', 'navigation_restricted']);
  });

  it('preloads the visualizations skill on every viz-authoring page (so a blank question page knows geo/pivot/etc.)', () => {
    for (const pageType of ['question', 'dashboard', 'story', 'notebook']) {
      expect(getPreloadedSkillNames({ pageType, selected: [], unrestrictedMode: false }),
        `${pageType} should preload visualizations`).toContain('visualizations');
    }
  });

  it('does NOT preload visualizations on non-viz page types', () => {
    for (const pageType of ['context', 'report', 'alert', 'explore', 'folder']) {
      expect(getPreloadedSkillNames({ pageType, selected: [], unrestrictedMode: false }),
        `${pageType} should not preload visualizations`).not.toContain('visualizations');
    }
  });

  it('falls back to the default skill set when page type is null/unknown', () => {
    expect(getPreloadedSkillNames({ pageType: null, selected: [], unrestrictedMode: false }))
      .toEqual(['questions', 'explore', 'navigation_restricted']);
  });

  it('appends selected SYSTEM skills (deduped, non-hidden); ignores user selections', () => {
    const selected: AgentSkillSelection[] = [
      { type: 'system', name: 'alerts' },
      { type: 'system', name: 'explore' }, // already present → not duplicated
      { type: 'system', name: 'navigation_restricted' }, // hidden → not added here
      { type: 'user', name: 'my_kb_skill', content: 'x' }, // user → ignored
    ];
    expect(getPreloadedSkillNames({ pageType: 'explore', selected, unrestrictedMode: false }))
      .toEqual(['explore', 'alerts', 'navigation_restricted']);
  });

  it('uses the unrestricted nav skill when unrestrictedMode is true', () => {
    expect(getPreloadedSkillNames({ pageType: 'explore', selected: [], unrestrictedMode: true }))
      .toEqual(['explore', 'navigation_unrestricted']);
  });
});

describe('buildSkillsCatalog', () => {
  it('lists system skills minus preloaded/hidden, with the catalog line format', () => {
    const catalog = buildSkillsCatalog({
      tree: TREE,
      preloaded: new Set(['questions', 'explore', 'navigation_restricted']),
      selected: [],
      userCatalog: [],
    });
    expect(catalog).toContain('System-defined skills:');
    expect(catalog).toContain('  - `"dashboards"` — Dashboards');
    expect(catalog).toContain('  - `"alerts"` — Alerts');
    expect(catalog).not.toContain('"questions"'); // preloaded
    expect(catalog).not.toContain('"explore"'); // preloaded
    expect(catalog).not.toContain('navigation_'); // hidden
  });

  it('lists user-defined skills, excluding ones already selected', () => {
    const catalog = buildSkillsCatalog({
      tree: TREE,
      preloaded: new Set(['questions', 'explore', 'dashboards', 'alerts', 'navigation_restricted']),
      selected: [{ type: 'user', name: 'picked_kb', content: 'c' }],
      userCatalog: [
        { name: 'picked_kb', description: 'already selected' },
        { name: 'free_kb', description: 'A KB skill' },
      ],
    });
    expect(catalog).toContain('User-defined skills:');
    expect(catalog).toContain('  - `"free_kb"` — A KB skill');
    expect(catalog).not.toContain('picked_kb');
  });

  it('returns the no-skills sentinel when nothing is available', () => {
    const catalog = buildSkillsCatalog({
      tree: TREE,
      preloaded: new Set(['questions', 'dashboards', 'explore', 'alerts', 'navigation_restricted']),
      selected: [],
      userCatalog: [],
    });
    expect(catalog).toBe('No additional skills are available for this turn.');
  });
});

describe('buildPreloadedSkillsContent', () => {
  it('concatenates resolved system-skill content (missing skills skipped)', () => {
    const out = buildPreloadedSkillsContent({
      tree: TREE,
      skillNames: ['explore', 'does_not_exist', 'navigation_restricted'],
      selected: [],
    });
    expect(out).toContain('Explore content');
    expect(out).toContain('Restricted nav content');
    expect(out).not.toContain('does_not_exist');
  });

  it('appends selected user skills with a user-defined header', () => {
    const out = buildPreloadedSkillsContent({
      tree: TREE,
      skillNames: ['explore'],
      selected: [
        { type: 'user', name: 'my_kb', content: 'KB body here' },
        { type: 'system', name: 'alerts' }, // not user → not appended as content here
      ],
    });
    expect(out).toContain('## Instructions: my_kb (user-defined)\nKB body here');
    expect(out).not.toContain('Alerts content'); // system selection not injected here
  });
});
