/**
 * Story template options for the Clarify `type: 'template'` preset — the structural-genre twin
 * of story-theme-options.ts.
 *
 * A pure PROJECTION of the template registry (`lib/data/story/story-templates.ts`, itself fed by
 * `orchestrator/prompts/story-guidance.yaml`): label/description/value from each entry. No
 * imageUrl on purpose — template options render as compact text rows (the theme picker owns the
 * visual preview cards; a template is a structure, told by its description). Options stay SLIM —
 * the fat `guidance` mini-skill is looked up from the registry at ANSWER time, so picker props
 * and the clarify stash never carry it.
 */
import { STORY_TEMPLATES } from '@/lib/data/story/story-templates';

export interface StoryTemplateOption {
  /** Short label shown on the option row. */
  label: string;
  /** One-line summary — returned to the agent with the pick. */
  description: string;
  /** The template `name` — what the agent writes into `<template>…</template>`. */
  value: string;
}

const STORY_TEMPLATE_OPTIONS: StoryTemplateOption[] = STORY_TEMPLATES.map(t => ({
  value: t.name,
  label: t.label,
  description: t.description,
}));

/** The options the frontend Clarify handler shows for `type: 'template'` (model-passed options are ignored). */
export function getStoryTemplateOptions(): StoryTemplateOption[] {
  return STORY_TEMPLATE_OPTIONS;
}
