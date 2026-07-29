import { fireEvent, screen } from '@testing-library/react';
import { useState } from 'react';
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
vi.mock('@/components/lexical/LexicalTextEditor', () => {
  const React = require('react');
  return {
    __esModule: true,
    default: ({ initialMarkdown, onChange, ariaLabel, mentions, showProTip }: {
      initialMarkdown: string;
      onChange: (markdown: string) => void;
      ariaLabel?: string;
      mentions?: unknown;
      showProTip?: boolean;
    }) => React.createElement('textarea', {
      'aria-label': ariaLabel,
      'data-mentions': mentions ? 'true' : 'false',
      'data-show-pro-tip': String(showProTip ?? true),
      defaultValue: initialMarkdown,
      onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => onChange(event.target.value),
    }),
    LexicalTextViewer: ({ markdown }: { markdown: string }) => React.createElement('div', {}, markdown),
  };
});
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
  function ControlledEditor() {
    const [currentContent, setCurrentContent] = useState(content);
    const [editMode, setEditMode] = useState(false);
    return (
      <ContextEditorV2
        content={currentContent}
        fileName="Knowledge Base"
        isDirty={false}
        isSaving={false}
        editMode={editMode}
        onChange={(updates) => {
          onChange(updates);
          setCurrentContent((current) => ({ ...current, ...updates }));
        }}
        onMetadataChange={vi.fn()}
        onSave={vi.fn(async () => {})}
        onCancel={vi.fn()}
        onEditModeChange={(nextEditMode) => {
          onEditModeChange(nextEditMode);
          setEditMode(nextEditMode);
        }}
        file={{ id: 1, path: '/org/context.json', type: 'context' }}
      />
    );
  }
  renderWithProviders(
    <ControlledEditor />,
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
    expect(screen.getByLabelText('Skill 1 content')).toBeVisible();
    expect(screen.getByLabelText('Skill 1 content')).toHaveAttribute('data-mentions', 'true');
    expect(screen.getByLabelText('Skill 1 content')).toHaveAttribute('data-show-pro-tip', 'false');
  });

  it('shows Add agent and enters edit mode before opening the agent builder', () => {
    const { onChange, onEditModeChange } = renderEditor('agents');

    fireEvent.click(screen.getByLabelText('Add agent'));

    expect(onEditModeChange).toHaveBeenCalledWith(true);
    expect(screen.getByLabelText('Agent name')).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Agent name'), { target: { value: 'new_agent' } });
    fireEvent.click(screen.getByLabelText('Builder next'));
    expect(screen.getByLabelText('Agent prompt')).toHaveAttribute('data-mentions', 'true');
    expect(screen.getByLabelText('Agent prompt')).toHaveAttribute('data-show-pro-tip', 'false');
  });
});
