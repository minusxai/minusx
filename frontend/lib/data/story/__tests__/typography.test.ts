/**
 * Story typography class algebra (lib/data/story/typography.ts) — the pure vocabulary +
 * class-string transforms shared by the WYSIWYG typography toolbar (live DOM mutation) and
 * the JSX source write-back, so the two always converge.
 */
import { describe, it, expect } from 'vitest';

import {
  TYPOGRAPHY_GROUPS,
  TYPOGRAPHY_SIZE_SCALE,
  SPACE_ABOVE_SCALE,
  SPACE_BELOW_SCALE,
  MAX_WIDTH_DEFAULT,
  STORY_WYSIWYG_CLASSES,
  currentChoice,
  applyTypographyChoice,
  stepSizeClass,
  stepSpacingClass,
  currentSpacingStep,
  stepPaddingClass,
  currentPaddingStep,
  hasMaxWidth,
  stripMaxWidth,
  hasFullBleed,
  crumbHint,
  applyFullBleed,
  removeClassTokens,
  FULL_BLEED_CLASSES,
  INNER_PADDING_SCALE,
} from '@/lib/data/story/typography';

describe('typography vocabulary', () => {
  it('STORY_WYSIWYG_CLASSES is the flat union of every group (recipe-union contract)', () => {
    for (const classes of Object.values(TYPOGRAPHY_GROUPS)) {
      for (const cls of classes) expect(STORY_WYSIWYG_CLASSES).toContain(cls);
    }
    for (const cls of [...SPACE_ABOVE_SCALE, ...SPACE_BELOW_SCALE, MAX_WIDTH_DEFAULT,
      ...INNER_PADDING_SCALE, ...FULL_BLEED_CLASSES]) {
      expect(STORY_WYSIWYG_CLASSES).toContain(cls);
    }
    // No duplicates — the CSS compile unions by Set, but the contract should be clean anyway.
    expect(new Set(STORY_WYSIWYG_CLASSES).size).toBe(STORY_WYSIWYG_CLASSES.length);
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

  it('justify is a fourth alignment choice, mutually exclusive with the others', () => {
    expect(applyTypographyChoice('text-center', 'align', 'text-justify')).toBe('text-justify');
    expect(currentChoice('text-justify', 'align')).toBe('text-justify');
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

describe('stepSpacingClass', () => {
  it('steps up from no margin (adds the first step; mt-0 is never written for nothing)', () => {
    expect(stepSpacingClass('text-lg', 'above', 1)).toBe('text-lg mt-1');
    expect(stepSpacingClass('text-lg', 'above', -1)).toBe('text-lg');
  });

  it('walks the curated scale in place, skip-steps included', () => {
    expect(stepSpacingClass('mt-4 text-lg', 'above', 1)).toBe('mt-6 text-lg');
    expect(stepSpacingClass('mt-6 text-lg', 'above', -1)).toBe('mt-4 text-lg');
  });

  it('above and below are independent edges', () => {
    expect(stepSpacingClass('mt-4 mb-8', 'below', 1)).toBe('mt-4 mb-10');
    expect(stepSpacingClass('mt-4 mb-8', 'above', -1)).toBe('mt-3 mb-8');
  });

  it('shifts variant-prefixed spacing and clamps per token', () => {
    expect(stepSpacingClass('mt-4 @2xl:mt-10', 'above', 1)).toBe('mt-6 @2xl:mt-12');
    expect(stepSpacingClass('mt-24', 'above', 1)).toBe('mt-24');
    expect(stepSpacingClass('mt-0', 'above', -1)).toBe('mt-0');
  });

  it('replaces arbitrary margins with the stepped scale (manual control takes over)', () => {
    expect(stepSpacingClass('mt-[18px] text-lg', 'above', 1)).toBe('text-lg mt-1');
  });

  it('does not confuse other m-prefixed utilities', () => {
    expect(stepSpacingClass('mx-auto -mt-2 mb-4', 'above', 1)).toBe('mx-auto -mt-2 mb-4 mt-1');
  });
});

describe('currentSpacingStep', () => {
  it('reads the bare spacing step for an edge (variants and other edges ignored)', () => {
    expect(currentSpacingStep('mt-4 mb-8 @2xl:mt-10', 'above')).toBe('4');
    expect(currentSpacingStep('mt-4 mb-8 @2xl:mt-10', 'below')).toBe('8');
    expect(currentSpacingStep('mt-0', 'above')).toBe('0');
  });

  it('returns null when the edge has no bare scale token (absent or arbitrary)', () => {
    expect(currentSpacingStep('text-lg', 'above')).toBeNull();
    expect(currentSpacingStep('mt-[18px]', 'above')).toBeNull();
    expect(currentSpacingStep('@2xl:mt-10', 'above')).toBeNull();
  });
});

describe('full-width toggle algebra', () => {
  it('hasMaxWidth detects named, arbitrary and variant-prefixed constraints', () => {
    expect(hasMaxWidth('max-w-sm text-lg')).toBe(true);
    expect(hasMaxWidth('@2xl:max-w-4xl')).toBe(true);
    expect(hasMaxWidth('max-w-[42rem]')).toBe(true);
    expect(hasMaxWidth('w-full min-w-0 text-lg')).toBe(false);
  });

  it('stripMaxWidth removes every constraint and reports the removed tokens in order', () => {
    expect(stripMaxWidth('max-w-sm text-lg @2xl:max-w-4xl')).toEqual({
      className: 'text-lg',
      removed: ['max-w-sm', '@2xl:max-w-4xl'],
    });
    expect(stripMaxWidth('text-lg')).toEqual({ className: 'text-lg', removed: [] });
  });
});

describe('stepPaddingClass / currentPaddingStep', () => {
  it('steps inner padding on the p-* scale with the shared relative semantics', () => {
    expect(stepPaddingClass('bg-muted', 1)).toBe('bg-muted p-1');
    expect(stepPaddingClass('p-4 bg-muted', 1)).toBe('p-6 bg-muted');
    expect(stepPaddingClass('p-1', -1)).toBe('p-0');
    expect(stepPaddingClass('text-lg', -1)).toBe('text-lg'); // none → no p-0 written
  });

  it('does not disturb axis paddings (px/py belong to the band grammar)', () => {
    expect(stepPaddingClass('py-14 px-6', 1)).toBe('py-14 px-6 p-1');
  });

  it('reads the bare step', () => {
    expect(currentPaddingStep('p-6 py-14')).toBe('6');
    expect(currentPaddingStep('py-14')).toBeNull();
  });
});

describe('full-bleed toggle algebra', () => {
  it('hasFullBleed detects any negative horizontal margin', () => {
    expect(hasFullBleed('-mx-6 px-6')).toBe(true);
    expect(hasFullBleed('@2xl:-mx-12')).toBe(true);
    expect(hasFullBleed('mx-auto px-6')).toBe(false);
  });

  it('applyFullBleed adds the missing bleed recipe (negative margins + re-added gutter) and reports what it added', () => {
    expect(applyFullBleed('bg-primary')).toEqual({
      className: 'bg-primary -mx-6 @2xl:-mx-12 px-6 @2xl:px-12',
      added: ['-mx-6', '@2xl:-mx-12', 'px-6', '@2xl:px-12'],
    });
    // Tokens the author already had are not re-added (and so not reported — untoggle keeps them).
    expect(applyFullBleed('px-6 bg-primary')).toEqual({
      className: 'px-6 bg-primary -mx-6 @2xl:-mx-12 @2xl:px-12',
      added: ['-mx-6', '@2xl:-mx-12', '@2xl:px-12'],
    });
  });

  it('removeClassTokens removes exactly the listed tokens', () => {
    expect(removeClassTokens('px-6 bg-primary -mx-6 @2xl:-mx-12 @2xl:px-12', ['-mx-6', '@2xl:-mx-12', '@2xl:px-12']))
      .toBe('px-6 bg-primary');
  });
});

describe('crumbHint', () => {
  it('surfaces the most decision-relevant class for a breadcrumb: width first, then layout', () => {
    expect(crumbHint('mt-4 max-w-2xl text-lg')).toBe('max-w-2xl');
    expect(crumbHint('grid gap-8 @2xl:grid-cols-3')).toBe('grid');
    expect(crumbHint('flex flex-col py-14')).toBe('flex');
    expect(crumbHint('bg-primary py-14')).toBe('bg-primary');
    expect(crumbHint('py-14 border-b')).toBe('');
  });
});
