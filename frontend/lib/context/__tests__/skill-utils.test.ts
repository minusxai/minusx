import { describe, expect, it } from 'vitest';
import {
  canonicalizeUserSkillName,
  getUserSkillDisplayName,
  uniqueUserSkillName,
} from '@/lib/context/skill-utils';

describe('user skill names', () => {
  it('keeps punctuation and spacing out of the canonical key', () => {
    expect(canonicalizeUserSkillName('Revenue & Growth / Q3')).toBe('revenue_growth_q3');
  });

  it('makes canonical keys unique without changing the display name', () => {
    expect(uniqueUserSkillName('Revenue & Growth', ['revenue_growth', 'revenue_growth_2']))
      .toBe('revenue_growth_3');
  });

  it('humanizes legacy entries that do not have a display name', () => {
    expect(getUserSkillDisplayName({ name: 'revenue_growth' })).toBe('Revenue Growth');
  });
});
