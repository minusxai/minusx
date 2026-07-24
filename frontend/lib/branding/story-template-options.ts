/**
 * Story template options for the Clarify `type: 'template'` preset — the structural-genre twin
 * of story-theme-options.ts.
 *
 * A pure PROJECTION of the template registry (`lib/data/story/story-templates.ts`, itself fed by
 * `orchestrator/prompts/story-guidance.yaml`): label/description/value from each entry; imageUrl
 * points at the hand-authored structure WIREFRAME (`public/story-templates/<name>.svg` — line-art
 * of the genre's skeleton, deliberately theme-neutral: the theme picker owns color). Options stay
 * SLIM — the fat `guidance` mini-skill is looked up from the registry at ANSWER time, so picker
 * props and the clarify stash never carry it.
 */
import { STORY_TEMPLATES } from '@/lib/data/story/story-templates';

export interface StoryTemplateOption {
  /** Short label shown on the option card. */
  label: string;
  /** One-line summary — returned to the agent with the pick. */
  description: string;
  /** Structure wireframe rendered on the option card. */
  imageUrl: string;
  /** The template `name` — what the agent writes into `<template>…</template>`. */
  value: string;
}

const STORY_TEMPLATE_OPTIONS: StoryTemplateOption[] = STORY_TEMPLATES.map(t => ({
  value: t.name,
  label: t.label,
  description: t.description,
  imageUrl: `/story-templates/${t.name}.svg`,
}));

/** The options the frontend Clarify handler shows for `type: 'template'` (model-passed options are ignored). */
export function getStoryTemplateOptions(): StoryTemplateOption[] {
  return STORY_TEMPLATE_OPTIONS;
}
