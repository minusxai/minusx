/**
 * Phase 4 Layer A (Story_Design_V2 §6a): Clarify image options end-to-end.
 *
 * - The ClarifyFrontend schema's options gain optional `imageUrl` + `value` and the tool gains an
 *   optional `type: 'design'` preset param.
 * - The frontend handler must PRESERVE those fields when throwing the UserInputException (it used
 *   to drop everything but label/description), and for `type: 'design'` must IGNORE model-passed
 *   options and populate the six story-theme options itself.
 * - The design result returns the chosen theme's `value` AND `description` so the agent knows the
 *   chosen design's personality.
 * - `reconstructClarifyProps` (cold-load reopen path) must also carry `imageUrl`/`value` through.
 */
import { describe, it, expect } from 'vitest';
import { ClarifyFrontend } from '@/agents/web-analyst/web-tools';
import { clarifyFrontendHandler } from '@/lib/tools/handlers/clarify';
import { UserInputException, type UserInputProps } from '@/lib/tools/user-input-exception';
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

describe('ClarifyFrontend schema (imageUrl / value / type)', () => {
  const props = (ClarifyFrontend.schema.parameters as any).properties;

  it('option items declare optional imageUrl and value strings', () => {
    const itemProps = props.options.items.properties;
    expect(itemProps.imageUrl).toBeDefined();
    expect(itemProps.imageUrl.type).toBe('string');
    expect(itemProps.value).toBeDefined();
    expect(itemProps.value.type).toBe('string');
    // Still optional — only label is required on an option.
    expect(props.options.items.required).toEqual(['label']);
  });

  it("declares an optional type param accepting 'design'", () => {
    expect(props.type).toBeDefined();
    expect(JSON.stringify(props.type)).toContain('design');
    expect((ClarifyFrontend.schema.parameters as any).required).not.toContain('type');
  });
});

describe('clarifyFrontendHandler — field preservation', () => {
  it('preserves imageUrl and value on options in the thrown UserInputException', async () => {
    const thrown = await captureExceptionProps({
      question: 'Pick a look',
      options: [
        { label: 'Dark', description: 'moody', value: 'dark', imageUrl: '/x/dark.png' },
        { label: 'Light' },
      ],
    });
    expect(thrown.type).toBe('choice');
    expect(thrown.options).toEqual([
      { label: 'Dark', description: 'moody', value: 'dark', imageUrl: '/x/dark.png' },
      { label: 'Light', description: undefined, value: undefined, imageUrl: undefined },
    ]);
  });
});

describe('getDesignThemeOptions', () => {
  it('returns the six §5 themes with label, description, value, imageUrl', () => {
    const opts = getDesignThemeOptions();
    expect(opts).toHaveLength(6);
    expect(opts.map((o) => o.value)).toEqual([
      'modernist', 'classical', 'nocturne', 'organic', 'broadsheet', 'industry',
    ]);
    for (const o of opts) {
      expect(o.label.length).toBeGreaterThan(0);
      expect(o.description.length).toBeGreaterThan(0);
      expect(o.imageUrl).toBe(`/story-themes/${o.value}.png`);
    }
  });
});

describe("clarifyFrontendHandler — type: 'design' preset", () => {
  it('ignores model-passed options and populates the six theme options', async () => {
    const thrown = await captureExceptionProps({
      question: 'What look?',
      options: [{ label: 'model-invented option' }],
      type: 'design',
    });
    expect(thrown.options).toHaveLength(6);
    expect(thrown.options!.map((o) => o.value)).toEqual([
      'modernist', 'classical', 'nocturne', 'organic', 'broadsheet', 'industry',
    ]);
    expect(thrown.options![0].imageUrl).toBe('/story-themes/modernist.png');
    // Theme pick is single-select regardless of what the model passed.
    expect(thrown.multiSelect).toBe(false);
  });

  it("returns the chosen option's value AND description in the tool result", async () => {
    const nocturne = getDesignThemeOptions().find((o) => o.value === 'nocturne')!;
    const result = await clarifyFrontendHandler(
      { question: 'What look?', options: [], type: 'design' },
      { userInputs: [{ id: 'ui_1', props: { type: 'choice', title: 'x' }, result: nocturne }] },
    );
    const content = result.content as Record<string, unknown>;
    expect(content.success).toBe(true);
    expect(content.value).toBe('nocturne');
    expect(content.description).toBe(nocturne.description);
    expect(String(content.message)).toContain('nocturne');
    expect(String(content.message)).toContain(nocturne.description);
  });

  it("'Figure it out' still resolves for the design preset", async () => {
    const result = await clarifyFrontendHandler(
      { question: 'What look?', options: [], type: 'design' },
      { userInputs: [{ id: 'ui_1', props: { type: 'choice', title: 'x' }, result: { label: 'Figure it out', figureItOut: true } }] },
    );
    expect((result.content as Record<string, unknown>).success).toBe(true);
    expect((result.details as unknown as Record<string, unknown>).success).toBe(true);
  });
});

describe('reconstructClarifyProps — reopen path carries new fields', () => {
  it('preserves value and imageUrl from the tool args', () => {
    const props = reconstructClarifyProps({
      question: 'Pick',
      options: [{ label: 'Dark', description: 'moody', value: 'dark', imageUrl: '/x/dark.png' }],
    });
    expect(props.options).toEqual([
      { label: 'Dark', description: 'moody', value: 'dark', imageUrl: '/x/dark.png' },
    ]);
  });

  it("re-populates design preset options when args carry type: 'design'", () => {
    const props = reconstructClarifyProps({ question: 'Pick', options: [], type: 'design' });
    expect(props.options).toHaveLength(6);
    expect(props.options![2]).toMatchObject({ value: 'nocturne', imageUrl: '/story-themes/nocturne.png' });
  });
});
