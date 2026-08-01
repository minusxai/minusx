/**
 * Drift guard for the story content schema prompt text (Bug: the LLM authored legacy
 * components like <PageHeader>/<Eyebrow> because the schema description still documented
 * them, contradicting the shadcn registry that `format:'jsx'` stories are validated
 * against). The schema description flows LIVE into the `skill_stories` prompt
 * (`{schema_story}` via SCHEMA_TEMPLATE_VARS), so every Capitalized JSX tag it mentions
 * MUST be a component the validator actually accepts (JSX_STORY_COMPONENT_NAMES) —
 * otherwise the prompt teaches tags that fail validation.
 */
import { contentSchemaText } from '@/lib/validation/atlas-json-schemas';
import { JSX_STORY_COMPONENT_NAMES } from '@/lib/jsx/components';

describe('story schema text ↔ component registry drift', () => {
  it('mentions no Capitalized JSX tag outside JSX_STORY_COMPONENT_NAMES', () => {
    const text = contentSchemaText('story');
    const allowed = new Set<string>(JSX_STORY_COMPONENT_NAMES);
    const mentioned = [...text.matchAll(/<([A-Z][A-Za-z]*)/g)].map((m) => m[1]);
    const unknown = [...new Set(mentioned.filter((name) => !allowed.has(name)))];
    expect(unknown).toEqual([]);
  });

  it('teaches the registered shadcn component set (spot-check)', () => {
    const text = contentSchemaText('story');
    // The description should name the actual registry so the agent knows what IS allowed.
    for (const name of ['Card', 'Badge', 'Table', 'Accordion']) {
      expect(text).toContain(name);
    }
  });

  it('describes Tailwind classes as the only forward styling path', () => {
    const text = contentSchemaText('story');
    expect(text).toContain('Tailwind utilities on each element are the ONLY authored styling path');
    expect(text).toContain('Do not author <style> blocks');
    expect(text).toContain('className=');
    expect(text).not.toContain('A <style> block is allowed');
  });
});
