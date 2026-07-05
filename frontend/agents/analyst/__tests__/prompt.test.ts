import { Orchestrator } from '@/orchestrator/orchestrator';
import type { MXAgent } from '@/orchestrator/types';
import { AnalystAgent } from '../analyst-agent';
import type { AnalystAgentContext } from '../types';

const ctx: AnalystAgentContext = { userId: 'u', mode: 'org', connectionId: 'conn-7' };

function newAgent(overrides: Partial<AnalystAgentContext> = {}) {
  const orch = new Orchestrator([AnalystAgent]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const agent: any = new AnalystAgent(
    orch,
    { userMessage: 'how many users?' },
    { ...ctx, ...overrides },
  );
  return agent;
}

describe('AnalystAgent system prompt', () => {
  it('renders the production prompts.yaml with substituted variables', () => {
    const sp: string = newAgent().getSystemPrompt();
    expect(sp).toContain('## Application Structure');
    expect(sp).toContain('## Available Database Schema');
    expect(sp).toContain('You have a maximum of 30 tool calls');
    expect(sp).toContain('conn-7');
  });

  it('enforces the hard step cap (35)', () => {
    // The prompt hint (30) is maxSteps − 5; the loop hard-stops at maxSteps.
    expect((AnalystAgent as unknown as typeof MXAgent).maxSteps).toBe(35);
  });
});

describe('AnalystAgent skills rendering', () => {
  it('preloads page-relevant skills + the restricted nav skill by default', () => {
    const sp: string = newAgent({ pageType: 'question' }).getSystemPrompt();
    expect(sp).toContain('**Skill: questions**');
    expect(sp).toContain('**Skill: navigation_restricted**');
  });

  it('falls back to the default skill set when no page type is set', () => {
    const sp: string = newAgent().getSystemPrompt();
    expect(sp).toContain('**Skill: questions**');
    expect(sp).toContain('**Skill: explore**');
  });

  it('switches to the unrestricted nav skill when unrestrictedMode is set', () => {
    const sp: string = newAgent({ unrestrictedMode: true }).getSystemPrompt();
    expect(sp).toContain('**Skill: navigation_unrestricted**');
  });

  it('lists non-preloaded system skills in the LoadSkill catalog', () => {
    // explore page preloads explore + nav; dashboards/alerts stay loadable.
    const sp: string = newAgent({ pageType: 'explore' }).getSystemPrompt();
    expect(sp).toContain('- `"dashboards"`');
    expect(sp).toContain('- `"alerts"`');
  });

  it('preloads selected system skills and injects selected user-defined skills', () => {
    const sp: string = newAgent({
      pageType: 'explore',
      selectedSkills: [
        { type: 'system', name: 'alerts' },
        { type: 'user', name: 'kb_thing', content: 'KB_CONTENT_MARKER_42' },
      ],
      userSkillCatalog: [{ name: 'kb_thing', description: 'a kb skill' }],
    }).getSystemPrompt();
    expect(sp).toContain('**Skill: alerts**'); // selected system skill now preloaded
    expect(sp).toContain('**Skill: kb_thing (user-defined)**');
    expect(sp).toContain('KB_CONTENT_MARKER_42');
  });
});

// App state moved OUT of buildUserContent into the single projection pass (buildMessages →
// projectMessages). The current date moved INTO the system prompt (NOT per-message), so a turn's
// bytes don't change when it scrolls from current to prior (which broke the message-history cache).
// buildUserContent now emits only attachments + images + the raw goal — NO <CurrentDate>, NO <AppState>.
describe('AnalystAgent buildUserContent (no app state / no per-message date)', () => {
  it('emits just the RAW goal — no <AppState>, no <CurrentDate>', () => {
    const agent = newAgent({ appState: { page: 'explore', fileId: 42 } });
    const content = agent.buildUserContent();
    expect(content).toHaveLength(1);
    expect(content[0].type).toBe('text');
    expect(content[0].text).not.toContain('<AppState>');
    expect(content[0].text).not.toContain('<CurrentDate>');
    // The goal is a raw text block — no <Question> wrapper.
    expect(content[0].text).toBe('how many users?');
  });

  it('no concrete date/time is baked into the system prompt (it is a per-turn <CurrentTime>)', () => {
    const sp: string = newAgent().getSystemPrompt();
    // The system prompt only DESCRIBES CurrentTime; it must not embed a concrete date/time (which
    // would change daily/hourly and bust the system-prompt cache). The value rides in the user turn.
    expect(sp).toContain('CurrentTime');
    expect(sp).not.toMatch(/Current date: \d{4}-\d{2}-\d{2}/);
    expect(sp).not.toMatch(/<CurrentTime>\d/);
  });

  it('threads ImageContent items before the raw goal', () => {
    const orch = new Orchestrator([AnalystAgent]);
    const userMessage = [
      { type: 'text' as const, text: 'see chart' },
      { type: 'image' as const, mimeType: 'image/png', data: 'base64...' },
    ];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const agent: any = new AnalystAgent(orch, { userMessage } as any, ctx);
    const content = agent.buildUserContent();
    expect(content).toHaveLength(2);
    expect(content[0].type).toBe('image');
    expect(content[1].text).toBe('see chart');
  });

  it('injects image attachments (base64) and text attachments from context', () => {
    const agent = newAgent({
      attachments: [
        { type: 'image', data: 'CHARTB64', mimeType: 'image/jpeg' },
        { type: 'text', name: 'notes.txt', content: 'ATTACH_BODY', pages: 3 },
      ],
    });
    const content = agent.buildUserContent();
    // text attachment appended to the context block as an <Attachment> XML block
    expect(content[0].text).toContain('<Attachment [notes.txt] (3 pages)>\nATTACH_BODY\n</Attachment>');
    // image attachment becomes an ImageContent block before the goal
    const image = content.find((c: { type: string }) => c.type === 'image');
    expect(image).toBeDefined();
    expect(image.data).toBe('CHARTB64');
    expect(image.mimeType).toBe('image/jpeg');
    // goal is still the last block, raw
    expect(content[content.length - 1].text).toBe('how many users?');
  });
});

// App state is rendered + diffed by the projection pass at buildMessages time.
describe('AnalystAgent buildMessages (app state via projection)', () => {
  it('renders the <AppState> block (from context) before the current user content', () => {
    const agent = newAgent({ appState: { page: 'explore', fileId: 42 } });
    const msgs = agent.buildMessages();
    const user = msgs[msgs.length - 1];
    expect(user.role).toBe('user');
    expect(user.content[0].text).toContain('<AppState>{"page":"explore","fileId":42}</AppState>');
    // the non-wire marker is stripped by the pass
    expect(user._appState).toBeUndefined();
  });

  it('omits the AppState block when context.appState is unset', () => {
    const msgs = newAgent().buildMessages();
    const user = msgs[msgs.length - 1];
    const joined = user.content.map((c: { text?: string }) => c.text ?? '').join('\n');
    expect(joined).not.toContain('<AppState>');
  });

  it('renders the frozen <CurrentTime> right AFTER the AppState block', () => {
    const agent = newAgent({ appState: { page: 'explore', fileId: 42 } });
    // orchestrator.run() normally freezes this onto the context; set it directly for the unit test.
    (agent.context as { currentTime?: string }).currentTime = '2026-06-26 14:00 UTC';
    const msgs = agent.buildMessages();
    const texts = (msgs[msgs.length - 1].content as Array<{ type: string; text?: string }>)
      .filter((c) => c.type === 'text').map((c) => c.text ?? '');
    const appStateIdx = texts.findIndex((t) => t.includes('<AppState>'));
    const timeIdx = texts.findIndex((t) => t.includes('<CurrentTime>2026-06-26 14:00 UTC</CurrentTime>'));
    expect(appStateIdx).toBeGreaterThanOrEqual(0);
    expect(timeIdx).toBe(appStateIdx + 1); // immediately after app state
  });
});

describe('AnalystAgent context docs rendering', () => {
  it('inlines alwaysInclude docs and advertises lazy docs via the catalog only — from one docs list', () => {
    // Above the inline-all threshold (5 lazy docs total) so the lazy docs stay in
    // the catalog rather than being inlined for being a small context.
    const filler = Array.from({ length: 4 }, (_, i) => ({
      key: `filler_${i}`, title: `Filler ${i}`, description: 'noise', content: `FILLER BODY ${i}`, alwaysInclude: false,
    }));
    const sp: string = newAgent({
      resolvedContextDocs: {
        docs: [
          { key: '', title: 'Pinned Rules', content: 'INLINE PINNED BODY', alwaysInclude: true },
          { key: 'revenue_glossary', title: 'Revenue Glossary', description: 'how revenue maps to columns', content: 'GLOSSARY BODY', alwaysInclude: false },
          ...filler,
        ],
      },
    }).getSystemPrompt();

    // Pinned (alwaysInclude) doc body is present inline.
    expect(sp).toContain('INLINE PINNED BODY');
    // Lazy doc is advertised by key + title + description (catalog rendered from the
    // same list), but its body is NOT injected; the LoadContext tool is described.
    expect(sp).toContain('revenue_glossary');
    expect(sp).toContain('Revenue Glossary');
    expect(sp).not.toContain('GLOSSARY BODY');
    expect(sp).toContain('LoadContext');
  });

  it('renders the "none" fallback when there are no lazy docs', () => {
    const sp: string = newAgent().getSystemPrompt();
    expect(sp).toContain('No additional context documents are available.');
  });
});
