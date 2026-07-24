/**
 * ClarifyFrontend - Ask user for clarification with options
 * Supports single or multi-select responses, image-card options (options with `imageUrl`),
 * and the preset pickers (`type: 'design'` — story design themes; `type: 'template'` — story
 * templates), whose options are app-supplied and whose answers return the pick PLUS its
 * authoring guidance mini-skill (Story_Design_V2 §6a Layer B + story templates).
 */
import type { ClarifyDetails } from '@/lib/types';
import { getDesignThemeOptions } from '@/lib/branding/story-theme-options';
import { getStoryTemplateOptions } from '@/lib/branding/story-template-options';
import { STORY_TEMPLATES, getStoryTemplate, getStoryThemeGuidance } from '@/lib/data/story/story-templates';
import { STORY_THEMES, getStoryTheme } from '@/lib/data/story/story-themes';
import { UserInputException } from '../user-input-exception';
import type { FrontendToolHandler } from './types';

type ClarifyPreset = 'design' | 'template';

export const clarifyFrontendHandler: FrontendToolHandler = async (args, context) => {
  const { question, options, multiSelect = false, type } = args;
  const { userInputs } = context;
  const preset: ClarifyPreset | undefined = type === 'design' || type === 'template' ? type : undefined;

  const userResponse = userInputs?.[0]?.result;

  if (userResponse === undefined) {
    // Presets ignore model-passed options: the app owns the catalog (with preview images), so it
    // can never drift from the registry. Preset picks are single-select.
    const effectiveOptions =
      preset === 'design' ? getDesignThemeOptions()
      : preset === 'template' ? getStoryTemplateOptions()
      : options;
    throw new UserInputException({
      type: 'choice',
      title: 'Clarification needed',
      message: question,
      options: effectiveOptions.map((opt: any) => ({
        label: opt.label,
        description: opt.description,
        value: opt.value,
        imageUrl: opt.imageUrl,
      })),
      multiSelect: preset ? false : multiSelect,
      cancellable: true
    });
  }

  // Handle cancellation
  if (userResponse?.cancelled) {
    const msg = 'User cancelled the clarification request';
    const content = { success: false, message: msg };
    return { content, details: { success: false, error: msg, message: msg } satisfies ClarifyDetails };
  }

  // Handle "Figure it out" option. For presets, return the FULL catalog (value + description +
  // guidance) so the agent can both choose and author against the pick without a second round-trip
  // (it never saw the app-supplied options).
  if (userResponse?.figureItOut) {
    const selection = { label: 'Figure it out', figureItOut: true };
    if (preset === 'design') {
      const msg = 'User chose: Figure it out — pick the design theme yourself based on the story\'s content and audience, then follow that theme\'s guidance';
      const themes = STORY_THEMES.map((t) => ({ value: t.name, description: t.description, guidance: getStoryThemeGuidance(t.name) }));
      const content = { success: true, message: msg, selection, themes };
      return { content, details: { success: true, message: msg, selection } satisfies ClarifyDetails };
    }
    if (preset === 'template') {
      const msg = 'User chose: Figure it out — pick the story template yourself based on the story\'s content and audience, then follow that template\'s guidance';
      const templates = STORY_TEMPLATES.map((t) => ({ value: t.name, description: t.description, guidance: t.guidance }));
      const content = { success: true, message: msg, selection, templates };
      return { content, details: { success: true, message: msg, selection } satisfies ClarifyDetails };
    }
    const msg = 'User chose: Figure it out (agent should decide based on context)';
    const content = { success: true, message: msg, selection };
    return { content, details: { success: true, message: msg, selection } satisfies ClarifyDetails };
  }

  // Handle "Other" option with custom text
  if (userResponse?.other) {
    const selection = { label: 'Other', other: true, text: userResponse.text };
    const msg = `User provided custom response: ${userResponse.text}`;
    const content = { success: true, message: msg, selection };
    return { content, details: { success: true, message: msg, selection } satisfies ClarifyDetails };
  }

  // Preset answers: return the chosen `value` + `description` (backward compat) PLUS the pick's
  // authoring guidance mini-skill — the agent writes `<theme>`/`<template>` from `value` and
  // authors the body against `guidance`. The UI-facing `details` stay slim (no fat strings in
  // the chat-log record); only the LLM-facing `content` carries the guidance.
  if (preset) {
    const selection = userResponse;
    const value = selection?.value ?? selection?.label;
    const noun = preset === 'design' ? 'design theme' : 'story template';
    const template = preset === 'template' ? getStoryTemplate(value) : undefined;
    const theme = preset === 'design' ? getStoryTheme(value) : undefined;
    const description = selection?.description ?? (template ?? theme)?.description ?? '';
    const guidance = preset === 'design' ? getStoryThemeGuidance(value) : template?.guidance;
    const msg = `User selected ${noun}: ${value}${description ? ` — ${description}` : ''}`;
    const content = {
      success: true, message: msg, value, description, selection,
      ...(guidance ? { guidance } : {}),
      ...(template ? { personality: template.personality, beats: template.beats } : {}),
    };
    return { content, details: { success: true, message: msg, selection } satisfies ClarifyDetails };
  }

  // Format response message for regular selections
  const formatSelection = (sel: any) => {
    if (Array.isArray(sel)) {
      return sel.map((s: any) => s.label).join(', ');
    }
    return sel?.label || sel;
  };

  const selection = userResponse;
  const msg = `User selected: ${formatSelection(userResponse)}`;
  const content = { success: true, message: msg, selection };
  return { content, details: { success: true, message: msg, selection } satisfies ClarifyDetails };
};
