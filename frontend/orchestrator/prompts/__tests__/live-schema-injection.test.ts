/**
 * End-to-end: each file type's skill must render the LIVE content schema (from atlas-schemas.ts)
 * when loaded — the `{schema_<type>}` placeholder is substituted by the prompt engine, the exact
 * rendered schema appears, and the old hand-typed examples are gone. This is what the LLM actually
 * sees, so it must match code, not a toy.
 */
import { describe, it, expect } from 'vitest';
import { loadSkill as getSkill } from '@/agents/skill-content';
import { contentSchemaText, ATLAS_SCHEMA_FILE_TYPES } from '@/lib/validation/atlas-json-schemas';

const SKILL_BY_TYPE: Record<string, string> = {
  question: 'questions',
  dashboard: 'dashboards',
  story: 'data_stories',
  notebook: 'notebooks',
};

describe('skills embed the LIVE per-file-type content schema', () => {
  for (const type of ATLAS_SCHEMA_FILE_TYPES) {
    it(`skill '${SKILL_BY_TYPE[type]}' renders the live ${type} schema (placeholder substituted)`, () => {
      const skill = getSkill(SKILL_BY_TYPE[type]);
      expect(skill).toBeTruthy();
      // the EXACT live schema is present...
      expect(skill).toContain(contentSchemaText(type));
      // ...and the {schema_x} placeholder was actually resolved (no raw token leaked)
      expect(skill).not.toContain(`{schema_${type}}`);
    });
  }

  it('dropped the old hand-typed example markup', () => {
    expect(getSkill('questions')).not.toContain('User demographics query');
    expect(getSkill('dashboards')).not.toContain('Section Header');
    expect(getSkill('notebooks')).not.toContain('GitHub activity analysis');
  });
});
