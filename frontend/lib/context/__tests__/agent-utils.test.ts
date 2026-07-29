import { describe, expect, it } from 'vitest';
import {
  buildAgentExploreHref,
  canonicalizeUserAgentName,
  getUserAgentDisplayName,
  uniqueUserAgentName,
} from '@/lib/context/agent-utils';

describe('user agent names', () => {
  it('keeps punctuation and spacing out of the canonical key', () => {
    expect(canonicalizeUserAgentName('CEO & Finance / Q3')).toBe('ceo_finance_q3');
  });

  it('makes canonical keys unique without changing the display name', () => {
    expect(uniqueUserAgentName('CEO Agent', ['ceo_agent', 'ceo_agent_2']))
      .toBe('ceo_agent_3');
  });

  it('preserves an authored display name and humanizes legacy entries', () => {
    expect(getUserAgentDisplayName({ name: 'ceo_agent', displayName: 'CEO Agent' })).toBe('CEO Agent');
    expect(getUserAgentDisplayName({ name: 'revenue_helper' })).toBe('Revenue Helper');
  });

  it('builds an Explore deep link without leaking unrelated editor params', () => {
    const current = new URLSearchParams('tab=agents&mode=tutorial&view=file');
    expect(buildAgentExploreHref({
      agentName: 'ceo_agent',
      contextPath: '/org/leadership/context.json',
      contextVersion: 3,
      currentSearchParams: current,
    })).toBe('/explore?agent=ceo_agent&context=%2Forg%2Fleadership%2Fcontext.json&contextVersion=3&mode=tutorial&view=file');
  });
});
