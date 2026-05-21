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

  it('enforces the same hard step cap as Python (MAX_STEPS_LOWER_LEVEL = 35)', () => {
    // The prompt hint (30) is maxSteps − 5; the loop hard-stops at maxSteps.
    expect((AnalystAgent as unknown as typeof MXAgent).maxSteps).toBe(35);
  });
});

describe('AnalystAgent skills rendering', () => {
  it('preloads page-relevant skills + the restricted nav skill by default', () => {
    const sp: string = newAgent({ pageType: 'question' }).getSystemPrompt();
    expect(sp).toContain('## Instructions: Questions');
    expect(sp).toContain('## Instructions: Navigation & Background File Rules');
  });

  it('falls back to the default skill set when no page type is set', () => {
    const sp: string = newAgent().getSystemPrompt();
    expect(sp).toContain('## Instructions: Questions');
    expect(sp).toContain('## Instructions: Explore / Folder Page');
  });

  it('switches to the unrestricted nav skill when unrestrictedMode is set', () => {
    const sp: string = newAgent({ unrestrictedMode: true }).getSystemPrompt();
    expect(sp).toContain('## Instructions: Navigation & Background File Rules (Background Agent Mode)');
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
    expect(sp).toContain('## Instructions: Alerts'); // selected system skill now preloaded
    expect(sp).toContain('## Instructions: kb_thing (user-defined)');
    expect(sp).toContain('KB_CONTENT_MARKER_42');
  });
});

describe('AnalystAgent buildUserContent', () => {
  it('emits <AppState>/<CurrentDate> context block then the RAW goal (matches Python)', () => {
    const agent = newAgent({ appState: { page: 'explore', fileId: 42 } });
    const content = agent.buildUserContent();
    expect(content).toHaveLength(2);
    expect(content[0].type).toBe('text');
    expect(content[0].text).toContain('<AppState>{"page":"explore","fileId":42}</AppState>');
    expect(content[0].text).toMatch(/<CurrentDate>\d{4}-\d{2}-\d{2}<\/CurrentDate>/);
    // Python sends the goal as a raw text block — no <Question> wrapper.
    expect(content[1].text).toBe('how many users?');
  });

  it('emits null for AppState when context.appState is unset', () => {
    const content = newAgent().buildUserContent();
    expect(content[0].text).toContain('<AppState>null</AppState>');
  });

  it('threads ImageContent items between the context block and the raw goal', () => {
    const orch = new Orchestrator([AnalystAgent]);
    const userMessage = [
      { type: 'text' as const, text: 'see chart' },
      { type: 'image' as const, mimeType: 'image/png', data: 'base64...' },
    ];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const agent: any = new AnalystAgent(orch, { userMessage } as any, ctx);
    const content = agent.buildUserContent();
    expect(content).toHaveLength(3);
    expect(content[0].text).toContain('<AppState>');
    expect(content[1].type).toBe('image');
    expect(content[2].text).toBe('see chart');
  });

  it('injects image attachments (base64) and text attachments from context (matches Python)', () => {
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
