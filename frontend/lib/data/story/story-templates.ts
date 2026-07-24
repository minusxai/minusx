/**
 * Story templates — the structural-genre registry next to the design themes (story-themes.ts).
 *
 * A template is the document's GENRE: its beat structure and layout grammar (editorial long-read,
 * slide deck, executive brief, scrollytelling) — orthogonal to the design theme, which is purely
 * a token set. Templates carry NO runtime CSS: `content.template` is metadata, and the `guidance`
 * mini-skill returned with the Clarify `type: 'template'` pick drives what the agent authors.
 *
 * The prose (labels, personalities, beats, guidance markdown) is human-edited in
 * `orchestrator/prompts/story-guidance.yaml`; this module is the thin typed projection over it.
 * Theme guidance is ALSO accessed from here (`getStoryThemeGuidance`) rather than from
 * story-themes.ts, because story-themes.ts must remain importable by tsx scripts
 * (generate-theme-previews), which cannot parse native YAML imports.
 *
 * Consumers: the Clarify handler (lib/tools/handlers/clarify.ts — fat pick payloads and the
 * "Figure it out" catalogs) and the option projection (lib/branding/story-template-options.ts).
 */
import type { StoryTemplateName } from '@/lib/validation/atlas-schemas';
import { STORY_TEMPLATE_NAMES, STORY_THEME_NAMES } from '@/lib/validation/atlas-schemas';
import STORY_GUIDANCE from '@/orchestrator/prompts/story-guidance.yaml';

export type { StoryTemplateName };
export { STORY_TEMPLATE_NAMES };

export interface StoryTemplate {
  /** The schema enum value — what `<template>…</template>` carries. */
  name: StoryTemplateName;
  /** Short human label for the picker card. */
  label: string;
  /** One-line summary (picker card + `description` in the clarify result). */
  description: string;
  /** 2–3 sentence voice/personality statement. */
  personality: string;
  /** Ordered beat names — the section skeleton of the genre. */
  beats: string[];
  /** The markdown mini-skill (beats, layout grammar, self-documenting skeleton, Do/Don't). */
  guidance: string;
}

export const STORY_TEMPLATES: StoryTemplate[] = STORY_TEMPLATE_NAMES.map((name) => {
  const entry = STORY_GUIDANCE.templates[name];
  if (!entry) throw new Error(`story-guidance.yaml is missing templates.${name}`);
  return { name, ...entry };
});

/** Registry lookup by template name; undefined for unknown/absent names. */
export function getStoryTemplate(name: string | null | undefined): StoryTemplate | undefined {
  return STORY_TEMPLATES.find((t) => t.name === name);
}

/** Authoring guidance for a design theme (story-guidance.yaml `themes:`); undefined if unknown. */
export function getStoryThemeGuidance(name: string | null | undefined): string | undefined {
  return name && (STORY_THEME_NAMES as readonly string[]).includes(name)
    ? STORY_GUIDANCE.themes[name]
    : undefined;
}
