/**
 * Story design-theme options for the Clarify `type: 'design'` preset (Story_Design_V2 §6a Layer B).
 *
 * TEMPORARY hardcoded list of the six themes from the plan's §5 table.
 * TODO(Phase 3): `lib/data/story/story-themes.ts` (the theme registry) replaces this as the source —
 * when it lands, derive these options from the registry entries (name/label/description) instead of
 * maintaining this list. Preview images live at `public/story-themes/<name>.png` and are generated
 * by Phase 3's preview script.
 */

export interface DesignThemeOption {
  /** Short label shown on the option card. */
  label: string;
  /** One-line personality summary — returned to the agent with the pick. */
  description: string;
  /** Preview image rendered on the option card. */
  imageUrl: string;
  /** The theme `name` — what the agent writes into `<theme>…</theme>`. */
  value: string;
}

const DESIGN_THEME_OPTIONS: DesignThemeOption[] = [
  {
    value: 'modernist',
    label: 'Modernist',
    description: 'Stark Swiss editorial — white, near-black, one red accent; Archivo display over Inter, zero radius.',
    imageUrl: '/story-themes/modernist.png',
  },
  {
    value: 'classical',
    label: 'Classical',
    description: 'Old-print, bookish — cream with ochre/sepia; Cormorant Garamond display over Lora.',
    imageUrl: '/story-themes/classical.png',
  },
  {
    value: 'nocturne',
    label: 'Nocturne',
    description: 'Dark-first, technical — deep navy with violet accents; Inter throughout.',
    imageUrl: '/story-themes/nocturne.png',
  },
  {
    value: 'organic',
    label: 'Organic',
    description: 'Warm, soft, playful — sand, terracotta, olive; Fraunces display over Figtree, extra-round corners.',
    imageUrl: '/story-themes/organic.png',
  },
  {
    value: 'broadsheet',
    label: 'Broadsheet',
    description: 'Newspaper/report — paper white, ink, steel blue; Source Serif 4.',
    imageUrl: '/story-themes/broadsheet.png',
  },
  {
    value: 'industry',
    label: 'Industry',
    description: 'Professional, square — slate and industrial blue; Barlow Condensed display over Barlow.',
    imageUrl: '/story-themes/industry.png',
  },
];

/** The options the frontend Clarify handler shows for `type: 'design'` (model-passed options are ignored). */
export function getDesignThemeOptions(): DesignThemeOption[] {
  return DESIGN_THEME_OPTIONS;
}
