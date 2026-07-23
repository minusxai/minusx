/**
 * Clarify `type: 'template'` preset + fat guidance payloads (story templates feature).
 *
 * - The ClarifyFrontend `type` param widens to accept 'template' next to 'design'.
 * - `getStoryTemplateOptions()` projects the STORY_TEMPLATES registry (slim cards; guidance
 *   is looked up at ANSWER time so options/stash stay small).
 * - The handler's template answer returns the pick PLUS its mini-skill: `guidance`,
 *   `personality`, `beats` — and the design answer is enriched with the theme's `guidance`.
 * - "Figure it out" returns the full catalog (value/description/guidance per entry) so the
 *   agent can choose AND author without a second round-trip.
 * - `reconstructClarifyProps` re-populates template options on cold-load reopen.
 */
import { describe, it, expect } from 'vitest';
import { ClarifyFrontend } from '@/agents/web-analyst/web-tools';
import { clarifyFrontendHandler } from '@/lib/tools/handlers/clarify';
import { UserInputException, type UserInputProps } from '@/lib/tools/user-input-exception';
import { getStoryTemplateOptions } from '@/lib/branding/story-template-options';
import { STORY_TEMPLATES, getStoryTemplate, getStoryThemeGuidance } from '@/lib/data/story/story-templates';
import { STORY_THEMES } from '@/lib/data/story/story-themes';
import { getDesignThemeOptions } from '@/lib/branding/story-theme-options';
import { reconstructClarifyProps } from '@/lib/chat/clarify-answer-stash';

/** Run the handler expecting the pause — returns the thrown UserInputException props. */
async function captureExceptionProps(args: Record<string, unknown>): Promise<UserInputProps> {
  try {
    await clarifyFrontendHandler(args, { userInputs: [] });
  } catch (e) {
    expect(e).toBeInstanceOf(UserInputException);
    return (e as UserInputException).props;
  }
  throw new Error('expected clarifyFrontendHandler to throw UserInputException');
}

describe("ClarifyFrontend schema — type accepts 'template'", () => {
  const props = (ClarifyFrontend.schema.parameters as any).properties;

  it("declares an optional type param accepting both 'design' and 'template'", () => {
    expect(props.type).toBeDefined();
    const serialized = JSON.stringify(props.type);
    expect(serialized).toContain('design');
    expect(serialized).toContain('template');
    expect((ClarifyFrontend.schema.parameters as any).required).not.toContain('type');
  });
});

describe('getStoryTemplateOptions — projected from the STORY_TEMPLATES registry', () => {
  it('derives every option from its registry entry (SVG wireframe card, no guidance)', () => {
    const opts = getStoryTemplateOptions();
    expect(opts).toHaveLength(STORY_TEMPLATES.length);
    expect(opts.map((o) => o.value)).toEqual(['editorial', 'deck', 'scrolly']);
    for (const [i, t] of STORY_TEMPLATES.entries()) {
      expect(opts[i]).toEqual({
        value: t.name,
        label: t.label,
        description: t.description,
        imageUrl: `/story-templates/${t.name}.svg`,
      });
    }
  });
});

describe("clarifyFrontendHandler — type: 'template' preset", () => {
  it('ignores model-passed options and populates the four template options, single-select', async () => {
    const thrown = await captureExceptionProps({
      question: 'What kind of document?',
      options: [{ label: 'model-invented option' }],
      type: 'template',
      multiSelect: true,
    });
    expect(thrown.type).toBe('choice');
    expect(thrown.options).toHaveLength(3);
    expect(thrown.options!.map((o) => o.value)).toEqual(['editorial', 'deck', 'scrolly']);
    expect(thrown.options![1].imageUrl).toBe('/story-templates/deck.svg');
    expect(thrown.multiSelect).toBe(false);
  });

  it('returns the pick PLUS its mini-skill (guidance, personality, beats)', async () => {
    const deck = getStoryTemplateOptions().find((o) => o.value === 'deck')!;
    const result = await clarifyFrontendHandler(
      { question: 'What kind?', options: [], type: 'template' },
      { userInputs: [{ id: 'ui_1', props: { type: 'choice', title: 'x' }, result: deck }] },
    );
    const content = result.content as Record<string, unknown>;
    const registry = getStoryTemplate('deck')!;
    expect(content.success).toBe(true);
    expect(content.value).toBe('deck');
    expect(content.description).toBe(deck.description);
    expect(content.guidance).toBe(registry.guidance);
    expect(content.personality).toBe(registry.personality);
    expect(content.beats).toEqual(registry.beats);
    expect(String(content.message)).toContain('story template');
    expect(String(content.message)).toContain('deck');
    // The UI-facing details stay slim — no fat guidance in the chat log record.
    expect(JSON.stringify(result.details)).not.toContain(registry.guidance.slice(0, 60));
  });

  it("'Figure it out' returns the full template catalog with guidance", async () => {
    const result = await clarifyFrontendHandler(
      { question: 'What kind?', options: [], type: 'template' },
      { userInputs: [{ id: 'ui_1', props: { type: 'choice', title: 'x' }, result: { label: 'Figure it out', figureItOut: true } }] },
    );
    const content = result.content as Record<string, unknown>;
    expect(content.success).toBe(true);
    const catalog = content.templates as Array<Record<string, unknown>>;
    expect(catalog).toHaveLength(3);
    for (const entry of catalog) {
      expect(String(entry.value).length).toBeGreaterThan(0);
      expect(String(entry.description).length).toBeGreaterThan(0);
      expect(String(entry.guidance).length).toBeGreaterThan(0);
    }
    expect(String(content.message)).toContain('template');
  });
});

describe("clarifyFrontendHandler — enriched type: 'design' answers", () => {
  it('the design answer now ALSO returns the theme guidance (backward-compat fields kept)', async () => {
    const nocturne = getDesignThemeOptions().find((o) => o.value === 'nocturne')!;
    const result = await clarifyFrontendHandler(
      { question: 'What look?', options: [], type: 'design' },
      { userInputs: [{ id: 'ui_1', props: { type: 'choice', title: 'x' }, result: nocturne }] },
    );
    const content = result.content as Record<string, unknown>;
    expect(content.value).toBe('nocturne');
    expect(content.description).toBe(nocturne.description);
    expect(content.guidance).toBe(getStoryThemeGuidance('nocturne'));
    expect(String(content.guidance).length).toBeGreaterThan(0);
  });

  it("'Figure it out' for design returns the full theme catalog with guidance", async () => {
    const result = await clarifyFrontendHandler(
      { question: 'What look?', options: [], type: 'design' },
      { userInputs: [{ id: 'ui_1', props: { type: 'choice', title: 'x' }, result: { label: 'Figure it out', figureItOut: true } }] },
    );
    const content = result.content as Record<string, unknown>;
    expect(content.success).toBe(true);
    const catalog = content.themes as Array<Record<string, unknown>>;
    expect(catalog).toHaveLength(STORY_THEMES.length);
    for (const entry of catalog) {
      expect(String(entry.guidance).length).toBeGreaterThan(0);
    }
  });
});

describe('reconstructClarifyProps — template preset reopen path', () => {
  it("re-populates template preset options when args carry type: 'template'", () => {
    const props = reconstructClarifyProps({ question: 'Pick', options: [], type: 'template' });
    expect(props.options).toHaveLength(3);
    expect(props.options![1]).toMatchObject({ value: 'deck', label: 'Deck', imageUrl: '/story-templates/deck.svg' });
    expect(props.multiSelect).toBe(false);
  });
});
