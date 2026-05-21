import { Orchestrator } from '@/orchestrator/orchestrator';
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
});

describe('AnalystAgent buildUserContent', () => {
  it('wraps the user message in <AppState>/<CurrentDate>/<Question> blocks', () => {
    const agent = newAgent({ appState: { page: 'explore', fileId: 42 } });
    const content = agent.buildUserContent();
    expect(content).toHaveLength(2);
    expect(content[0].type).toBe('text');
    expect(content[0].text).toContain('<AppState>{"page":"explore","fileId":42}</AppState>');
    expect(content[0].text).toMatch(/<CurrentDate>\d{4}-\d{2}-\d{2}<\/CurrentDate>/);
    expect(content[1].text).toBe('<Question>how many users?</Question>');
  });

  it('emits null for AppState when context.appState is unset', () => {
    const content = newAgent().buildUserContent();
    expect(content[0].text).toContain('<AppState>null</AppState>');
  });

  it('threads ImageContent items between AppState and Question blocks', () => {
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
    expect(content[2].text).toBe('<Question>see chart</Question>');
  });
});
