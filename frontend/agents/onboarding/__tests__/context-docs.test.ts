// OnboardingDashboardAgent must render the user's resolved context docs (default
// inline + on-demand Context Library) and expose LoadContext — same context
// mechanism as the production analyst.
import { Orchestrator } from '@/orchestrator/orchestrator';
import { OnboardingDashboardAgent } from '../onboarding-agents';
import type { RemoteAnalystContext } from '@/agents/analyst/types';

function dashboardAgent(overrides: Partial<RemoteAnalystContext> = {}) {
  const orch = new Orchestrator([OnboardingDashboardAgent]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new OnboardingDashboardAgent(orch, { userMessage: 'build a dashboard' }, {
    userId: 'u', mode: 'org', connectionId: 'db', ...overrides,
  } as any);
}

describe('OnboardingDashboardAgent context docs', () => {
  it('exposes LoadContext in its toolset', () => {
    const names = (OnboardingDashboardAgent.tools ?? []).map((t) => t.name);
    expect(names).toContain('LoadContext');
  });

  it('renders resolvedContextDocs: default doc inline, lazy doc advertised by key only', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sp: string = (dashboardAgent({
      resolvedContextDocs: {
        docs: [
          { key: '', title: 'Pinned', content: 'PINNED ONB BODY', alwaysInclude: true },
          { key: 'glossary', title: 'Glossary', description: 'terms', content: 'GLOSSARY ONB BODY', alwaysInclude: false },
        ],
      },
    }) as any).getSystemPrompt();

    expect(sp).toContain('PINNED ONB BODY');   // alwaysInclude doc inline
    expect(sp).toContain('glossary');          // lazy doc advertised by key
    expect(sp).not.toContain('GLOSSARY ONB BODY'); // ...body withheld until LoadContext
  });
});
