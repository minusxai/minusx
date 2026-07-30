/**
 * Story typography vocabulary + class-string algebra (user-driven typography controls).
 *
 * The WYSIWYG typography toolbar edits an element's Tailwind classes directly in the story's
 * JSX source (`className` attr write-back via jsx-edit's applyClassEditsToJsx). This module is
 * the SINGLE source of truth for:
 *  - which classes the toolbar may apply (curated, token-based — never free-form, so stories
 *    stay theme-compatible and the banned-CSS guard never triggers), and
 *  - the pure class-string algebra the toolbar AND the source write-back both use, so the live
 *    DOM mutation (instant feedback) and the persisted source always converge.
 *
 * Every class listed here is unioned into the story CSS compile (story-css.server.ts), so the
 * whole palette is pre-compiled into every story's stylesheet — applying one is a pure DOM
 * attribute change with zero recompile latency.
 *
 * Pure module — no DOM, no React — unit-testable in the node project.
 */

/** Ordered font-size scale the size stepper walks — the FULL Tailwind scale (agent-authored
 *  stories freely use the large end). `null` choice = the element's default. */
export const TYPOGRAPHY_SIZE_SCALE = [
  'text-xs', 'text-sm', 'text-base', 'text-lg', 'text-xl',
  'text-2xl', 'text-3xl', 'text-4xl', 'text-5xl', 'text-6xl', 'text-7xl', 'text-8xl', 'text-9xl',
] as const;

/**
 * Mutually-exclusive class groups: applying a choice within a group removes the group's other
 * members. Single-member groups (`weight`, `fontStyle`, `decoration`) act as toggles (choice ↔
 * null). Text COLOR is not a group — it's a free value, applied as an inline style by the
 * toolbar's color picker (a class palette can't cover a picker's range).
 */
export const TYPOGRAPHY_GROUPS = {
  size: TYPOGRAPHY_SIZE_SCALE,
  weight: ['font-bold'],
  fontStyle: ['italic'],
  decoration: ['underline'],
  align: ['text-left', 'text-center', 'text-right'],
} as const satisfies Record<string, readonly string[]>;

export type TypographyGroup = keyof typeof TYPOGRAPHY_GROUPS;

/** Curated Tailwind spacing steps the space-above/below steppers walk (skip-steps match skill usage). */
export const SPACING_STEPS = ['0', '1', '2', '3', '4', '6', '8', '10', '12', '16', '20', '24'] as const;

export const SPACE_ABOVE_SCALE: readonly string[] = SPACING_STEPS.map(s => `mt-${s}`);
export const SPACE_BELOW_SCALE: readonly string[] = SPACING_STEPS.map(s => `mb-${s}`);

/** What the full-width toggle re-applies when un-toggling an element that never had a max-width. */
export const MAX_WIDTH_DEFAULT = 'max-w-prose';

/** Every class the toolbar can apply — unioned into the story CSS compile (recipe union). */
export const STORY_WYSIWYG_CLASSES: readonly string[] = [
  ...Object.values(TYPOGRAPHY_GROUPS).flat(),
  ...SPACE_ABOVE_SCALE,
  ...SPACE_BELOW_SCALE,
  MAX_WIDTH_DEFAULT,
];

const tokens = (className: string): string[] => className.split(/\s+/).filter(Boolean);

/** `@2xl:text-5xl` → `text-5xl`; unprefixed tokens come back whole. */
const variantTail = (token: string): string => token.slice(token.lastIndexOf(':') + 1);

/** Arbitrary font-size value (`text-[15px]`) — numeric-leading, unlike `text-[#hex]` colors. */
const isArbitrarySize = (token: string): boolean => /^text-\[[0-9.]/.test(token);

/**
 * Whether `token` belongs to `group` for REMOVAL purposes. An explicit choice must displace ANY
 * competing utility the agent authored — group members under variant prefixes (the story skill
 * mandates responsive type like `text-3xl @2xl:text-5xl`, and a surviving variant wins the
 * cascade and masks the choice), and for `size` also arbitrary length values (`text-[15px]`) —
 * while leaving the other `text-*` families (colors, `text-[#hex]`) alone.
 */
function inGroup(token: string, group: TypographyGroup): boolean {
  const tail = variantTail(token);
  if ((TYPOGRAPHY_GROUPS[group] as readonly string[]).includes(tail)) return true;
  return group === 'size' && isArbitrarySize(tail);
}

/** The group member currently present in `className`, or null (first match wins on conflict). */
export function currentChoice(className: string, group: TypographyGroup): string | null {
  const members: readonly string[] = TYPOGRAPHY_GROUPS[group];
  return tokens(className).find(t => members.includes(t)) ?? null;
}

/**
 * Set `choice` within `group` on a class string: every other member of the group is removed
 * (for `size`, any font-size token — see {@link inGroup}); `choice` (when non-null) is appended
 * if absent. Unrelated tokens keep their order; the result is single-space normalized.
 */
export function applyTypographyChoice(
  className: string,
  group: TypographyGroup,
  choice: string | null,
): string {
  const kept = tokens(className).filter(t => !inGroup(t, group) || t === choice);
  if (choice !== null && !kept.includes(choice)) kept.push(choice);
  return kept.join(' ');
}

/**
 * Step the font size along TYPOGRAPHY_SIZE_SCALE — RELATIVE semantics: every size token shifts
 * one step IN PLACE, variant-prefixed ones included (`text-3xl @2xl:text-5xl` →
 * `text-4xl @2xl:text-6xl`), so the skill's responsive type ratios survive the click. Each
 * token clamps at the scale ends independently. An element with no base size steps from
 * `text-base` (appended); arbitrary size values (`text-[15px]`) are replaced by the stepped
 * scale — stepping means the user is taking manual control.
 */
/** One steppable utility scale: ordered tokens + where a bare element sits + its arbitrary form. */
interface ClassScaleSpec {
  tokens: readonly string[];
  /** Treated as the current position when the element carries no scale token. */
  defaultToken: string;
  /** Arbitrary-value form of this utility (`text-[15px]`, `mt-[18px]`) — replaced on step. */
  arbitraryRe: RegExp;
}

/**
 * Generic RELATIVE stepper over a utility scale: every matching token shifts one step IN
 * PLACE, variant-prefixed ones included, clamping at the scale ends per token — so the skill's
 * responsive patterns (`text-3xl @2xl:text-5xl`, `mt-4 @2xl:mt-10`) survive the click.
 * Arbitrary values are replaced by the stepped scale (stepping = the user taking manual
 * control). With no bare token, steps from `defaultToken`, appending the result — unless the
 * step clamps back onto the default itself, which stays unwritten (no `mt-0` for nothing).
 */
function stepScaleClass(className: string, spec: ClassScaleSpec, direction: 1 | -1): string {
  const shift = (t: string): string =>
    spec.tokens[Math.min(spec.tokens.length - 1, Math.max(0, spec.tokens.indexOf(t) + direction))];
  let sawBase = false;
  const out: string[] = [];
  for (const token of tokens(className)) {
    const tail = variantTail(token);
    if (spec.tokens.includes(tail)) {
      if (tail === token) sawBase = true;
      out.push(token.slice(0, token.length - tail.length) + shift(tail));
      continue;
    }
    if (spec.arbitraryRe.test(tail)) continue; // dropped — replaced by the stepped scale below
    out.push(token);
  }
  if (!sawBase) {
    const stepped = shift(spec.defaultToken);
    if (stepped !== spec.defaultToken) out.push(stepped);
  }
  return out.join(' ');
}

const SIZE_SPEC: ClassScaleSpec = {
  tokens: TYPOGRAPHY_SIZE_SCALE,
  defaultToken: 'text-base',
  arbitraryRe: /^text-\[[0-9.]/,
};

const SPACING_SPECS: Record<'above' | 'below', ClassScaleSpec> = {
  above: { tokens: SPACE_ABOVE_SCALE, defaultToken: 'mt-0', arbitraryRe: /^mt-\[/ },
  below: { tokens: SPACE_BELOW_SCALE, defaultToken: 'mb-0', arbitraryRe: /^mb-\[/ },
};

export function stepSizeClass(className: string, direction: 1 | -1): string {
  return stepScaleClass(className, SIZE_SPEC, direction);
}

/**
 * Step the spacing above/below an element along the curated {@link SPACING_STEPS} scale —
 * same relative semantics as {@link stepSizeClass}. Stepping DOWN from no margin is a no-op.
 */
export function stepSpacingClass(className: string, edge: 'above' | 'below', direction: 1 | -1): string {
  return stepScaleClass(className, SPACING_SPECS[edge], direction);
}

/**
 * The BARE spacing step for an edge ('4' for `mt-4`), or null when the element carries none
 * (absent, variant-only, or arbitrary) — the toolbar's readout, mirroring how the size label
 * reads only the base token.
 */
export function currentSpacingStep(className: string, edge: 'above' | 'below'): string | null {
  const spec = SPACING_SPECS[edge];
  const token = tokens(className).find(t => (spec.tokens as readonly string[]).includes(t));
  return token ? token.slice(token.indexOf('-') + 1) : null;
}

const isMaxWidthToken = (token: string): boolean => variantTail(token).startsWith('max-w-');

/** Whether the class string constrains width (`max-w-*`, bare or variant-prefixed). */
export function hasMaxWidth(className: string): boolean {
  return tokens(className).some(isMaxWidthToken);
}

/**
 * Strip every width constraint (`max-w-*` in all forms — named, arbitrary, variant-prefixed),
 * returning the stripped class string and the removed tokens (so the full-width toggle can
 * restore them verbatim when un-toggled).
 */
export function stripMaxWidth(className: string): { className: string; removed: string[] } {
  const all = tokens(className);
  return {
    className: all.filter(t => !isMaxWidthToken(t)).join(' '),
    removed: all.filter(isMaxWidthToken),
  };
}
