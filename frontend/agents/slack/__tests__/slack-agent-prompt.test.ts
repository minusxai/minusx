// The Slack agent hardcodes its skill slots (it does not go through the analyst
// PAGE_SKILL_MAP), so this pins that the questions skill — home of the `<viz>`
// envelope grammar (Vega-Lite specs, shipped recipes, table/pivot sources) — is
// preloaded into its system prompt, and that the slack_addendum defers to it
// instead of restating the grammar.
import { Orchestrator } from '@/orchestrator/orchestrator';
import { SlackAgent } from '../slack-agent';
import { PAGE_SKILL_MAP } from '@/agents/analyst/skills';
import type { AnalystAgentContext } from '@/agents/analyst/types';

describe('SlackAgent system prompt', () => {
  const ctx: AnalystAgentContext = { userId: 'u', mode: 'org', connectionId: 'conn-1' };

  function systemPrompt(): string {
    const orch = new Orchestrator([SlackAgent]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const agent: any = new SlackAgent(orch, { userMessage: 'hi' }, ctx);
    return agent.getSystemPrompt();
  }

  it('preloads the PAGE_SKILL_MAP slack skills (single source of truth)', () => {
    const sp = systemPrompt();
    expect(PAGE_SKILL_MAP['slack']).toContain('questions');
    for (const name of PAGE_SKILL_MAP['slack']) {
      expect(sp, `slack prompt should preload '${name}'`).toContain(`**Skill: ${name}**`);
    }
  });

  it('the preloaded questions skill carries the envelope grammar', () => {
    const sp = systemPrompt();
    expect(sp).toContain('<kind>vega-lite</kind>');
    expect(sp).toContain('minusx/funnel@1');
  });

  it('the chart addendum defers to the preloaded skill instead of restating the grammar', () => {
    const sp = systemPrompt();
    expect(sp).toContain('## Chart Visualization in Slack');
    expect(sp).toContain('preloaded questions skill');
  });
});
