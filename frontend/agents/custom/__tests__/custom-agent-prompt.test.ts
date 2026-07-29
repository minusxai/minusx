// CustomAgent system-prompt assembly: user-defined agents (AgentEntry on the
// context file) resolved server-side into `context.customAgent`. Append mode
// injects the persona into the default analyst prompt; replace mode swaps out
// the intro + guidelines but KEEPS the app structure and the dynamic runtime
// sections (schema, context docs, skills catalog + preloaded skills,
// connection, home folder).

import { Orchestrator } from '@/orchestrator/orchestrator';
import { CustomAgent } from '../custom-agent';
import { WebAnalystAgent } from '@/agents/web-analyst/web-analyst';
import type { RemoteAnalystContext, ResolvedCustomAgent } from '@/agents/analyst/types';

const baseCtx: RemoteAnalystContext = {
  userId: 'u',
  mode: 'org',
  connectionId: 'conn-7',
  homeFolder: '/org/sales',
};

function newCustomAgent(overrides: Partial<RemoteAnalystContext> = {}) {
  const orch = new Orchestrator([CustomAgent]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const agent: any = new CustomAgent(
    orch,
    { userMessage: 'how many users?' },
    { ...baseCtx, ...overrides },
  );
  return agent;
}

function def(overrides: Partial<ResolvedCustomAgent> = {}): ResolvedCustomAgent {
  return {
    name: 'sales_helper',
    prompt: 'PERSONA_MARKER: you are a cheerful sales analyst.',
    promptMode: 'append',
    ...overrides,
  };
}

describe('CustomAgent append mode', () => {
  it('injects the persona into the default prompt, keeping the default body intact', () => {
    const sp: string = newCustomAgent({ customAgent: def() }).getSystemPrompt();
    expect(sp).toContain('PERSONA_MARKER');
    expect(sp).toContain('## Application Structure'); // default body still there
    expect(sp).toContain('## Available Database Schema');
    expect(sp).toContain('conn-7');
  });

  it('renders the persona exactly once, before the schema section', () => {
    const sp: string = newCustomAgent({ customAgent: def() }).getSystemPrompt();
    expect(sp.split('PERSONA_MARKER').length - 1).toBe(1);
    expect(sp.indexOf('PERSONA_MARKER')).toBeLessThan(sp.indexOf('## Available Database Schema'));
  });

  it('renders persona braces literally (pyFormat substitutes values, never re-scans them)', () => {
    const sp: string = newCustomAgent({
      customAgent: def({ prompt: 'Keep {braces} and {{double}} literal.' }),
    }).getSystemPrompt();
    expect(sp).toContain('Keep {braces} and {{double}} literal.');
  });
});

describe('CustomAgent replace mode', () => {
  const replaceDef = def({ promptMode: 'replace', prompt: 'REPLACE_PERSONA: terse SQL bot.' });

  it('replaces the intro + guidelines but keeps app structure and dynamic runtime sections', () => {
    const sp: string = newCustomAgent({ customAgent: replaceDef }).getSystemPrompt();
    expect(sp).toContain('REPLACE_PERSONA');
    // app structure + dynamic sections survive
    expect(sp).toContain('## Application Structure');
    expect(sp).toContain('## Available Database Schema');
    expect(sp).toContain('## Context');
    expect(sp).toContain('conn-7');           // connection_section
    expect(sp).toContain('/org/sales');       // home_folder_section
    expect(sp).toContain('LoadSkill');        // skills catalog advertised
    expect(sp).toContain('**Skill: questions**'); // preloaded skills still inlined
    // default intro + guidelines are gone
    expect(sp).not.toContain('expert data analyst');   // intro
    expect(sp).not.toContain('### Response Guidelines'); // guidelines
    expect(sp).not.toContain('### Workflow');            // guidelines
  });

  it('renders persona braces literally in replace mode too', () => {
    const sp: string = newCustomAgent({
      customAgent: def({ promptMode: 'replace', prompt: 'SELECT {col} FROM {{t}}' }),
    }).getSystemPrompt();
    expect(sp).toContain('SELECT {col} FROM {{t}}');
  });

  it('inlines preloaded user-skill content from selectedSkills', () => {
    const sp: string = newCustomAgent({
      customAgent: replaceDef,
      selectedSkills: [{ type: 'user', name: 'kb_pricing', content: 'KB_PRICING_BODY_77' }],
    }).getSystemPrompt();
    expect(sp).toContain('**Skill: kb_pricing (user-defined)**');
    expect(sp).toContain('KB_PRICING_BODY_77');
  });
});

describe('CustomAgent skill allowlist', () => {
  it('restricts the LoadSkill catalog to the allowlist (system + user skills)', () => {
    const sp: string = newCustomAgent({
      customAgent: def({ skillAllowlist: ['dashboards', 'allowed_kb'] }),
      userSkillCatalog: [
        { name: 'allowed_kb', description: 'in allowlist' },
        { name: 'blocked_kb', description: 'not in allowlist' },
      ],
    }).getSystemPrompt();
    expect(sp).toContain('- `"dashboards"`');
    expect(sp).toContain('- `"allowed_kb"`');
    expect(sp).not.toContain('- `"alerts"`');
    expect(sp).not.toContain('blocked_kb');
  });

  it('leaves the catalog unrestricted when no allowlist is set', () => {
    const sp: string = newCustomAgent({ customAgent: def() }).getSystemPrompt();
    expect(sp).toContain('- `"dashboards"`');
    expect(sp).toContain('- `"alerts"`');
  });
});

describe('CustomAgent without a definition', () => {
  it('falls back to the WebAnalystAgent prompt byte-for-byte', () => {
    const orch = new Orchestrator([CustomAgent, WebAnalystAgent]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const custom: any = new CustomAgent(orch, { userMessage: 'q' }, { ...baseCtx });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const web: any = new WebAnalystAgent(orch, { userMessage: 'q' }, { ...baseCtx });
    expect(custom.getSystemPrompt()).toBe(web.getSystemPrompt());
  });
});
