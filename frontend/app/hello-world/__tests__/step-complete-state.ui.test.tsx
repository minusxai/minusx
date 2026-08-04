/**
 * Regression: the "You're all set!" screen was a hardcoded list that never looked at the
 * workspace it was congratulating.
 *
 * Its first section is titled "Set up your workspace" and its first two rows are "Connect a
 * database" and "Add context about your data" — the two things the wizard had just spent
 * several minutes doing on the user's behalf. They rendered identically whether the user had
 * completed the whole flow or skipped it at the first screen. After watching an agent connect a
 * dataset, write a Knowledge Base and build a dashboard, the payoff screen listed the first two
 * as still to do and never mentioned any of it. It reads as though setup failed.
 *
 * Two changes, both driven by real state: completed rows are marked done, and a summary above
 * the list names what was actually produced.
 *
 * "Invite colleagues" is deliberately never auto-ticked — a solo workspace has genuinely not
 * done it, and it is the one row here that stays a real suggestion.
 */

const STATE: {
  connections: { id: number; name: string }[];
  contexts: { id: number; name: string; docCount: number }[];
  dashboards: { id: number; name: string; draft?: boolean }[];
} = { connections: [], contexts: [], dashboards: [] };

vi.mock('@/lib/hooks/useConfigs', () => ({
  useConfigs: () => ({ config: { branding: { agentName: 'MinusX' } }, loaded: true }),
}));

// Mirrors the real hook's two-tier shape, which the bug depended on: `contexts` is a
// `partial: true` load and carries METADATA ONLY — no `content` key at all, exactly as
// /api/files returns it — while `homeContext` is the single fully-loaded one. A mock that
// put `content` on the list would hide the very failure this test exists to catch.
vi.mock('@/lib/hooks/useContexts', () => ({
  useContexts: () => ({
    contexts: STATE.contexts.map(c => ({ id: c.id, name: c.name, type: 'context', path: `/org/${c.id}` })),
    homeContext: STATE.contexts.length
      ? {
          id: STATE.contexts[0].id,
          name: STATE.contexts[0].name,
          type: 'context',
          content: {
            fullDocs: Array.from({ length: STATE.contexts[0].docCount }, (_, i) => ({ title: `doc ${i}`, content: 'x' })),
          },
        }
      : undefined,
    loading: false,
    error: null,
  }),
}));

vi.mock('@/lib/hooks/file-state-hooks', () => ({
  useFilesByCriteria: ({ criteria }: { criteria: { type: string } }) => ({
    files: criteria.type === 'dashboard'
      ? STATE.dashboards.map(d => ({ id: d.id, name: d.name, type: 'dashboard', draft: d.draft ?? false }))
      : STATE.connections.map(c => ({ id: c.id, name: c.name, type: 'connection' })),
    loading: false,
    error: null,
  }),
  useFile: () => ({ fileState: undefined }),
}));

vi.mock('@/lib/navigation/use-navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}));

import { screen, within } from '@testing-library/react';
import { makeStore } from '@/store/store';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import StepComplete from '@/app/hello-world/components/StepComplete';

function render() {
  return renderWithProviders(<StepComplete />, { store: makeStore() });
}

/** The row's own container, so "done" is asserted on the row and not on the page. */
function row(title: string | RegExp): HTMLElement {
  const label = screen.getByText(title);
  const container = label.closest('[data-guide-item]');
  if (!container) throw new Error(`No guide row found for ${title}`);
  return container as HTMLElement;
}

function completedWorkspace() {
  STATE.connections = [{ id: 1007, name: 'static' }];
  STATE.contexts = [{ id: 1008, name: 'Knowledge Base', docCount: 1 }];
  STATE.dashboards = [{ id: 1013, name: 'Getting Started Dashboard' }];
}

describe('StepComplete — reflects what setup actually produced', () => {
  beforeEach(() => {
    STATE.connections = [];
    STATE.contexts = [];
    STATE.dashboards = [];
  });

  it('marks the rows the wizard just completed as done', () => {
    completedWorkspace();
    render();

    expect(within(row('Connect a database')).getByLabelText(/done/i)).toBeInTheDocument();
    expect(within(row('Add context about your data')).getByLabelText(/done/i)).toBeInTheDocument();
  });

  it('leaves those rows as to-do on a workspace that skipped setup', () => {
    render();

    expect(within(row('Connect a database')).queryByLabelText(/done/i)).not.toBeInTheDocument();
    expect(within(row('Add context about your data')).queryByLabelText(/done/i)).not.toBeInTheDocument();
  });

  it('does not count an empty context as added context', () => {
    // The workspace seeds a context file per folder; several ship named "Knowledge Base" with
    // nothing in them. Existence is not the same as the user having context.
    STATE.connections = [{ id: 1007, name: 'static' }];
    STATE.contexts = [{ id: 1009, name: 'Knowledge Base', docCount: 0 }];
    render();

    expect(within(row('Add context about your data')).queryByLabelText(/done/i)).not.toBeInTheDocument();
  });

  it('never auto-ticks "Invite colleagues"', () => {
    completedWorkspace();
    render();

    expect(within(row('Invite colleagues')).queryByLabelText(/done/i)).not.toBeInTheDocument();
  });

  it('names what was built', () => {
    completedWorkspace();
    render();

    const summary = screen.getByLabelText(/what setup created/i);
    expect(within(summary).getByText(/static/)).toBeInTheDocument();
    expect(within(summary).getByText(/Knowledge Base/)).toBeInTheDocument();
    expect(within(summary).getByText(/Getting Started Dashboard/)).toBeInTheDocument();
  });

  it('omits the summary entirely when setup produced nothing', () => {
    render();

    expect(screen.queryByLabelText(/what setup created/i)).not.toBeInTheDocument();
  });

  it('does not credit an unpublished draft dashboard', () => {
    STATE.connections = [{ id: 1007, name: 'static' }];
    STATE.contexts = [{ id: 1008, name: 'Knowledge Base', docCount: 1 }];
    STATE.dashboards = [{ id: 1013, name: 'Getting Started Dashboard', draft: true }];
    render();

    const summary = screen.getByLabelText(/what setup created/i);
    expect(within(summary).queryByText(/Getting Started Dashboard/)).not.toBeInTheDocument();
  });
});
