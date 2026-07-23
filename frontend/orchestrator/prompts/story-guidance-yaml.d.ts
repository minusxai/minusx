// Native, typed import of the story-guidance YAML (same mechanics as prompts-yaml.d.ts:
// yaml-loader for Turbopack/webpack, @rollup/plugin-yaml for Vitest parse it at build time;
// this declaration supplies the TYPE TypeScript cannot infer from a YAML file).
declare module '*/story-guidance.yaml' {
  /** One template's prose definition — the registry adds the `name` key. */
  export interface StoryTemplateGuidanceEntry {
    label: string;
    description: string;
    personality: string;
    beats: string[];
    guidance: string;
  }
  interface StoryGuidanceDoc {
    /** Full template definitions, keyed by STORY_TEMPLATE_NAMES values. */
    templates: Record<string, StoryTemplateGuidanceEntry>;
    /** Authoring guidance per design theme, keyed by STORY_THEME_NAMES values. */
    themes: Record<string, string>;
  }
  const doc: StoryGuidanceDoc;
  export default doc;
}
