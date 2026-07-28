import { fireEvent, screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import { setUser } from '@/store/authSlice';
import { makeStore } from '@/store/store';
import type { ContextContent } from '@/lib/types';

const navigationState = vi.hoisted(() => ({ tab: 'skills' }));

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(`tab=${navigationState.tab}`),
}));
vi.mock('@/lib/navigation/use-navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));
vi.mock('@/lib/hooks/useContext', () => ({
  useContext: () => ({
    contextId: undefined,
    databases: [],
    skills: [],
    availableSkills: [
      { type: 'skill', source: 'system', name: 'dashboards', description: 'Build dashboard views' },
      { type: 'skill', source: 'system', name: 'alerts', description: 'Configure alerting' },
    ],
    hasContext: false,
    contextLoading: false,
  }),
}));
vi.mock('@monaco-editor/react', () => ({
  __esModule: true,
  default: () => null,
}));
vi.mock('@/lib/hooks/useUsers', () => ({
  useUsers: () => ({ users: [], loading: false }),
  loadUsers: vi.fn(async () => []),
  setUsersInStore: vi.fn(),
}));
vi.mock('@/lib/hooks/useConfigs', () => ({
  useConfigs: () => ({ config: { branding: { agentName: 'MinusX' } }, loading: false }),
}));

import ContextEditorV2 from '@/components/context/ContextEditorV2';

const CONTENT = {
  versions: [{ version: 1, whitelist: [], docs: [], createdAt: '2026-01-01T00:00:00.000Z', createdBy: 1 }],
  published: { all: 1 },
  docs: [],
  skills: [],
  agents: [],
  evals: [],
  fullSchema: [],
  parentSchema: [],
  fullDocs: [],
  fullSkills: [],
  fullAgents: [],
} as unknown as ContextContent;

function renderEditor(tab: 'skills' | 'agents', content: ContextContent = CONTENT) {
  navigationState.tab = tab;
  const onChange = vi.fn();
  const onEditModeChange = vi.fn();
  const store = makeStore();
  store.dispatch(setUser({
    id: 1,
    email: 'editor@minusx.ai',
    name: 'Editor',
    role: 'editor',
    mode: 'org',
  }));
  renderWithProviders(
    <ContextEditorV2
      content={content}
      fileName="Knowledge Base"
      isDirty={false}
      isSaving={false}
      editMode={false}
      onChange={onChange}
      onMetadataChange={vi.fn()}
      onSave={vi.fn(async () => {})}
      onCancel={vi.fn()}
      onEditModeChange={onEditModeChange}
      file={{ id: 1, path: '/org/context.json', type: 'context' }}
    />,
    { store },
  );
  return { onChange, onEditModeChange };
}

describe('ContextEditorV2 add actions outside edit mode', () => {
  it('counts user and system skills together and opens System Skills by default', () => {
    renderEditor('skills', {
      ...CONTENT,
      skills: [{
        name: 'pricing',
        description: 'Pricing knowledge',
        content: 'Use current pricing.',
        enabled: true,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        createdBy: 1,
      }],
    });

    expect(screen.getByRole('tab', { name: /Skills/ })).toHaveTextContent('3');
    expect(screen.getByText('Build dashboard views')).toBeVisible();
    expect(screen.getByText('Configure alerting')).toBeVisible();
  });

  it('shows Add skill and enters edit mode before adding the default skill', () => {
    const { onChange, onEditModeChange } = renderEditor('skills');

    fireEvent.click(screen.getByLabelText('Add skill'));

    expect(onEditModeChange).toHaveBeenCalledWith(true);
    expect(onChange).toHaveBeenCalledWith({
      skills: [expect.objectContaining({ name: 'new_skill', enabled: true })],
    });
  });

  it('shows Add agent and enters edit mode before opening the agent builder', () => {
    const { onChange, onEditModeChange } = renderEditor('agents');

    fireEvent.click(screen.getByLabelText('Add agent'));

    expect(onEditModeChange).toHaveBeenCalledWith(true);
    expect(screen.getByLabelText('Agent name')).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });
});
