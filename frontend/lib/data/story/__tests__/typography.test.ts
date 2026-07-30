/**
 * Story typography class algebra (lib/data/story/typography.ts) — the pure vocabulary +
 * class-string transforms shared by the WYSIWYG typography toolbar (live DOM mutation) and
 * the JSX source write-back, so the two always converge.
 */
import { describe, it, expect } from 'vitest';

import {
  TYPOGRAPHY_GROUPS,
  TYPOGRAPHY_SIZE_SCALE,
  STORY_TYPOGRAPHY_CLASSES,
  currentChoice,
  applyTypographyChoice,
  stepSizeClass,
} from '@/lib/data/story/typography';

describe('typography vocabulary', () => {
  it('STORY_TYPOGRAPHY_CLASSES is the flat union of every group (recipe-union contract)', () => {
    for (const classes of Object.values(TYPOGRAPHY_GROUPS)) {
      for (const cls of classes) expect(STORY_TYPOGRAPHY_CLASSES).toContain(cls);
    }
    // No duplicates — the CSS compile unions by Set, but the contract should be clean anyway.
    expect(new Set(STORY_TYPOGRAPHY_CLASSES).size).toBe(STORY_TYPOGRAPHY_CLASSES.length);
  });
});

describe('currentChoice', () => {
  it('reads the group member present in the class string', () => {
    expect(currentChoice('mt-4 text-2xl font-bold', 'size')).toBe('text-2xl');
    expect(currentChoice('mt-4 text-2xl font-bold', 'weight')).toBe('font-bold');
    expect(currentChoice('mt-4 text-2xl font-bold', 'align')).toBeNull();
    expect(currentChoice('', 'size')).toBeNull();
  });

  it('does not confuse non-member tokens that share a prefix', () => {
    // text-muted-foreground is a color utility — neither a size nor an alignment.
    expect(currentChoice('text-muted-foreground text-left', 'size')).toBeNull();
    expect(currentChoice('text-muted-foreground text-left', 'align')).toBe('text-left');
  });
});

describe('applyTypographyChoice', () => {
  it('adds a choice to an empty class string', () => {
    expect(applyTypographyChoice('', 'size', 'text-xl')).toBe('text-xl');
  });

  it('swaps within the group and preserves unrelated tokens in order', () => {
    expect(applyTypographyChoice('mt-4 text-sm leading-7', 'size', 'text-2xl'))
      .toBe('mt-4 leading-7 text-2xl');
  });

  it('null clears the group without touching anything else', () => {
    expect(applyTypographyChoice('mt-4 text-2xl font-bold', 'size', null)).toBe('mt-4 font-bold');
    expect(applyTypographyChoice('italic underline', 'fontStyle', null)).toBe('underline');
  });

  it('is idempotent when the choice is already applied', () => {
    expect(applyTypographyChoice('text-xl font-bold', 'size', 'text-xl')).toBe('text-xl font-bold');
  });

  it('normalizes whitespace', () => {
    expect(applyTypographyChoice('  mt-4   text-sm ', 'size', 'text-lg')).toBe('mt-4 text-lg');
  });

  it('size choices strip ANY font-size token — full Tailwind scale and arbitrary values', () => {
    expect(applyTypographyChoice('text-6xl font-serif', 'size', 'text-xl')).toBe('font-serif text-xl');
    expect(applyTypographyChoice('text-[15px] mt-2', 'size', 'text-lg')).toBe('mt-2 text-lg');
    // ...but not color/align/arbitrary-color utilities that share the text- prefix.
    expect(applyTypographyChoice('text-primary text-center text-[#a1b2c3] text-sm', 'size', 'text-lg'))
      .toBe('text-primary text-center text-[#a1b2c3] text-lg');
  });

  it('an explicit set FLATTENS variant-prefixed group members (exact choice wins at all widths)', () => {
    // The story skill mandates responsive type (`text-3xl @2xl:text-5xl`) — an explicit size
    // pick replaces the whole responsive set, and the same holds for the other groups.
    expect(applyTypographyChoice('text-3xl @2xl:text-5xl font-semibold', 'size', 'text-xl'))
      .toBe('font-semibold text-xl');
    expect(applyTypographyChoice('text-left @2xl:text-center', 'align', 'text-right')).toBe('text-right');
    expect(applyTypographyChoice('hover:font-bold', 'weight', null)).toBe('');
  });

  it('independent toggles compose (bold + italic + underline)', () => {
    let cls = applyTypographyChoice('', 'weight', 'font-bold');
    cls = applyTypographyChoice(cls, 'fontStyle', 'italic');
    cls = applyTypographyChoice(cls, 'decoration', 'underline');
    expect(cls.split(' ').sort()).toEqual(['font-bold', 'italic', 'underline']);
    // Clearing one leaves the others.
    expect(applyTypographyChoice(cls, 'fontStyle', null).split(' ').sort())
      .toEqual(['font-bold', 'underline']);
  });
});

describe('stepSizeClass', () => {
  it('steps from text-base when no explicit size is present', () => {
    expect(stepSizeClass('mt-2', 1)).toBe('mt-2 text-lg');
    expect(stepSizeClass('mt-2', -1)).toBe('mt-2 text-sm');
  });

  it('steps along the scale from the current size', () => {
    expect(stepSizeClass('text-xl', 1)).toBe('text-2xl');
    expect(stepSizeClass('text-xl', -1)).toBe('text-lg');
  });

  it('walks the full Tailwind scale (agent stories author beyond 5xl)', () => {
    expect(stepSizeClass('text-6xl', 1)).toBe('text-7xl');
    expect(stepSizeClass('text-9xl', -1)).toBe('text-8xl');
  });

  it('SHIFTS variant-prefixed sizes with the base — responsive ratios survive a step', () => {
    // Skill-mandated responsive type: stepping moves the whole set, in place.
    expect(stepSizeClass('text-3xl @2xl:text-5xl font-semibold', 1))
      .toBe('text-4xl @2xl:text-6xl font-semibold');
    expect(stepSizeClass('mt-2 text-5xl @2xl:text-8xl', -1)).toBe('mt-2 text-4xl @2xl:text-7xl');
  });

  it('a variant size without a base still shifts; the new base lands at the end', () => {
    expect(stepSizeClass('@2xl:text-5xl', 1)).toBe('@2xl:text-6xl text-lg');
  });

  it('per-token clamp at the scale ends', () => {
    expect(stepSizeClass('text-8xl @2xl:text-9xl', 1)).toBe('text-9xl @2xl:text-9xl');
  });

  it('arbitrary size values are replaced by the stepped scale (manual control takes over)', () => {
    expect(stepSizeClass('text-[15px] mt-2', 1)).toBe('mt-2 text-lg');
  });

  it('clamps at both ends of the scale', () => {
    const largest = TYPOGRAPHY_SIZE_SCALE[TYPOGRAPHY_SIZE_SCALE.length - 1];
    expect(stepSizeClass(largest, 1)).toBe(largest);
    expect(stepSizeClass('text-xs', -1)).toBe('text-xs');
  });
});
