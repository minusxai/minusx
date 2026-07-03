// OnboardingDashboardAgent must render the user's resolved context docs (default
// inline + on-demand Context Library) and expose LoadContext — same context
// mechanism as the production analyst.
import { Orchestrator } from '@/orchestrator/orchestrator';
import { OnboardingDashboardAgent } from '../onboarding-agents';
import type { RemoteAnalystContext } from '@/agents/analyst/types';
import { INLINE_ALL_DOCS_THRESHOLD } from '@/lib/sql/schema-filter';

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
    // Need at least INLINE_ALL_DOCS_THRESHOLD docs so lazy docs stay in the
    // catalog instead of being inlined wholesale (small-context optimization).
    const filler = Array.from({ length: Math.max(0, INLINE_ALL_DOCS_THRESHOLD - 2) }, (_, i) => ({
      key: `filler${i}`, title: `Filler ${i}`, description: 'x', content: `FILLER BODY ${i}`, alwaysInclude: false,
    }));
    const sp: string = (dashboardAgent({
      resolvedContextDocs: {
        docs: [
          { key: '', title: 'Pinned', content: 'PINNED ONB BODY', alwaysInclude: true },
          { key: 'glossary', title: 'Glossary', description: 'terms', content: 'GLOSSARY ONB BODY', alwaysInclude: false },
          ...filler,
        ],
      },
    }) as any).getSystemPrompt();

    expect(sp).toContain('PINNED ONB BODY');   // alwaysInclude doc inline
    expect(sp).toContain('glossary');          // lazy doc advertised by key
    expect(sp).not.toContain('GLOSSARY ONB BODY'); // ...body withheld until LoadContext
  });
});
