import { fireEvent, screen, waitFor } from '@testing-library/react';
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
import { setDevMode, setEnableCustomAgents } from '@/store/uiSlice';

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

function renderEditor(
  tab: 'skills' | 'agents',
  content: ContextContent = CONTENT,
  { enableCustomAgents = tab === 'agents', devMode = false }: { enableCustomAgents?: boolean; devMode?: boolean } = {},
) {
  navigationState.tab = tab;
  const onChange = vi.fn();
  const onEditModeChange = vi.fn();
  const store = makeStore();
  if (enableCustomAgents) store.dispatch(setEnableCustomAgents(true));
  if (devMode) store.dispatch(setDevMode(true));
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
  it('does not replay stale section buffers when leaving whole-file Code view', () => {
    const { onChange } = renderEditor('skills', CONTENT, { devMode: true });

    fireEvent.click(screen.getByLabelText('Code view'));
    expect(screen.getByLabelText('File')).toBeVisible();
    expect(screen.getByLabelText('Markup')).toBeVisible();
    fireEvent.click(screen.getByLabelText('Visual view'));

    expect(onChange).not.toHaveBeenCalled();
  });

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
    expect(screen.getByLabelText('System skills catalog')).toBeVisible();
    expect(screen.getByLabelText('System skill dashboards')).toBeVisible();
    expect(screen.getByLabelText('System skill alerts')).toBeVisible();
    expect(screen.getByText('Build dashboard views')).toBeVisible();
    expect(screen.getByText('Configure alerting')).toBeVisible();
  });

  it('shows Add skill and keeps a friendly display name alongside its canonical key', async () => {
    const { onChange, onEditModeChange } = renderEditor('skills');

    fireEvent.click(screen.getByLabelText('Add skill'));

    expect(onEditModeChange).toHaveBeenCalledWith(true);
    expect(onChange).toHaveBeenCalledWith({
      skills: [expect.objectContaining({ name: 'new_skill', displayName: 'New skill', enabled: true })],
    });
    expect(screen.getByLabelText('Skill 1 content')).toBeVisible();
    expect(screen.getByLabelText('Skill 1 content')).toHaveAttribute('data-mentions', 'true');
    expect(screen.getByLabelText('Skill 1 content')).toHaveAttribute('data-show-pro-tip', 'false');

    const nameInput = screen.getByLabelText('Skill 1 name');
    fireEvent.change(nameInput, { target: { value: 'Revenue & Growth / Q3' } });

    expect(nameInput).toHaveValue('Revenue & Growth / Q3');
    expect(screen.getAllByText('#revenue_growth_q3').length).toBeGreaterThan(0);
    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith({
        skills: [expect.objectContaining({
          name: 'revenue_growth_q3',
          displayName: 'Revenue & Growth / Q3',
        })],
      });
    });
    expect(nameInput).toHaveValue('Revenue & Growth / Q3');
  });

  // The custom-agents surface is alpha: without the flag the editor must look
  // exactly like it did pre-agents — no tab, and a ?tab=agents deep link falls
  // back to Databases instead of rendering a hidden surface.
  it('hides the Agents tab unless the Custom Agents alpha flag is on', () => {
    renderEditor('skills', CONTENT, { enableCustomAgents: false });

    expect(screen.queryByRole('tab', { name: /Agents/ })).not.toBeInTheDocument();
  });

  it('falls back to the Databases tab when a ?tab=agents deep link arrives with the flag off', () => {
    renderEditor('agents', CONTENT, { enableCustomAgents: false });

    expect(screen.queryByRole('tab', { name: /Agents/ })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Add agent')).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Databases' })).toHaveAttribute('aria-selected', 'true');
  });

  it('shows the Agents tab when the Custom Agents alpha flag is on', () => {
    renderEditor('agents');

    expect(screen.getByRole('tab', { name: /Agents/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByLabelText('Add agent')).toBeInTheDocument();
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

  it('stores a friendly agent display name alongside its canonical key', () => {
    const { onChange } = renderEditor('agents');

    fireEvent.click(screen.getByLabelText('Add agent'));
    fireEvent.change(screen.getByLabelText('Agent name'), { target: { value: 'CEO Agent' } });
    expect(screen.getByLabelText('Agent name')).toHaveValue('CEO Agent');
    expect(screen.getByText('@ceo_agent')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Builder next'));
    fireEvent.change(screen.getByLabelText('Agent prompt'), { target: { value: 'Think like a CEO.' } });
    fireEvent.click(screen.getByLabelText('Builder next'));
    fireEvent.click(screen.getByLabelText('Builder next'));
    fireEvent.click(screen.getByLabelText('Save agent'));

    expect(onChange).toHaveBeenCalledWith({
      agents: [expect.objectContaining({
        name: 'ceo_agent',
        displayName: 'CEO Agent',
        prompt: 'Think like a CEO.',
      })],
    });
  });
});
