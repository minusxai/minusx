'use client';

/**
 * ContextEditorV2 - With Version Management
 * Pure controlled component with version management UI for admins
 * All changes go through onChange immediately
 */

import { Box, VStack, HStack, Text, Badge, Tabs } from '@chakra-ui/react';
import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { useRouter } from '@/lib/navigation/use-navigation';
import { LuCircleAlert } from 'react-icons/lu';
import type { ContextContent, ContextVersion, PublishedVersions, DocEntry, SkillEntry } from '@/lib/types';
import { StatusBanner } from '@/components/shared/StatusBanner';
import type { RunOptions } from '@/components/shared/RunNowHeader';
import type { JobRun } from '@/lib/types';
import { serializeDatabases, parseDatabasesYaml, findDocsMissingMeta } from '@/lib/context/context-utils';
import type { WhitelistItem } from '../schema-browser/SchemaTreeView';
import ContextDocsEditor from './ContextDocsEditor';
import { isDocContentOverLimit } from '@/lib/context/context-budgets';
import { shapeContextForAgent } from '@/lib/context/context-agent-view';
import { anyDocMetaIncomplete } from '@/lib/context/doc-validation';
import Editor from '@monaco-editor/react';
import DocumentHeader from '../file-browser/DocumentHeader';
import { FileHealthBadge } from '../file-browser/FileHealthPanel';
import CodeView from '../views/CodeView';
import { useAppSelector } from '@/store/hooks';
import { shallowEqual } from 'react-redux';
import { selectConnectionsLoading, selectPersistableContent, selectMergedContent } from '@/store/filesSlice';
import { HIDDEN_SYSTEM_FOLDERS } from '@/lib/mode/path-resolver';
import { canEdit } from '@/lib/auth/role-helpers';
import { useContext as useKnowledgeContext } from '@/lib/hooks/useContext';
import { DatabasesTabContent } from './DatabasesTabContent';
import SemanticModelsEditor from './SemanticModelsEditor';
import { SkillsTabContent } from './SkillsTabContent';
import { EvalsTabContent } from './EvalsTabContent';

type DatabaseSelection = {
  databaseName: string;
  whitelist: WhitelistItem[];
};

interface ContextEditorV2Props {
  content: ContextContent;
  fileName: string;
  isDirty: boolean;
  isSaving: boolean;
  saveError?: string | null;
  editMode: boolean;
  onChange: (updates: Partial<ContextContent>) => void;
  onMetadataChange: (changes: { name?: string }) => void;
  onSave: () => Promise<void>;
  onCancel: () => void;
  onEditModeChange: (mode: boolean) => void;
  // File info (for path filtering)
  file?: { id: number; path: string; type: string };
  // Original (saved) docs for diff view
  originalDocs?: DocEntry[];
  // Version management (admin only)
  isAdmin?: boolean;
  userId?: number;
  currentVersion?: number;
  allVersions?: ContextVersion[];
  publishedStatus?: PublishedVersions;
  onSwitchVersion?: (version: number) => void;
  onCreateVersion?: (description?: string) => void;
  onPublishVersion?: () => void;
  onDeleteVersion?: (version: number) => void;
  onUpdateDescription?: (version: number, description: string) => void;
  // Run history (context job runs)
  runs?: JobRun[];
  isRunning?: boolean;
  selectedRunId?: number | null;
  onRunAll?: (opts: RunOptions) => void;
  onSelectRun?: (runId: number | null) => void;
}

const MONACO_READ_ONLY_MESSAGE = { value: 'Switch to edit mode to make changes.' };

export default function ContextEditorV2({
  content,
  fileName,
  isDirty,
  isSaving,
  saveError,
  editMode,
  onChange,
  onMetadataChange,
  onSave,
  onCancel,
  onEditModeChange,
  file,
  originalDocs,
  isAdmin = false,
  userId,
  currentVersion = 1,
  allVersions = [],
  publishedStatus = { all: 1 },
  onSwitchVersion,
  onCreateVersion,
  onPublishVersion,
  onDeleteVersion,
  onUpdateDescription,
  runs = [],
  isRunning = false,
  selectedRunId,
  onRunAll,
  onSelectRun,
}: ContextEditorV2Props) {
  const searchParams = useSearchParams();
  const router = useRouter();

  type TopTab = 'databases' | 'semantic' | 'docs' | 'skills' | 'evals';
  const validTabs: TopTab[] = ['databases', 'semantic', 'docs', 'skills', 'evals'];
  const parseTab = (val: string | null): TopTab => validTabs.includes(val as TopTab) ? val as TopTab : 'databases';

  const [topTab, setTopTabState] = useState<TopTab>(() => parseTab(searchParams.get('tab')));

  const setTopTab = useCallback((tab: TopTab) => {
    setTopTabState(tab);
    const params = new URLSearchParams(searchParams.toString());
    if (tab === 'databases') {
      params.delete('tab');
    } else {
      params.set('tab', tab);
    }
    const query = params.toString();
    router.replace(`${window.location.pathname}${query ? `?${query}` : ''}`, { scroll: false });
  }, [searchParams, router]);

  const [activeTab, setActiveTab] = useState<'picker' | 'yaml'>('picker');
  const [yamlText, setYamlText] = useState<string>('');
  const [docsJsonText, setDocsJsonText] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const colorMode = useAppSelector((state) => state.ui.colorMode);
  const showDebug = useAppSelector((state) => state.ui.devMode);
  const user = useAppSelector(state => state.auth.user);
  // shallowEqual: skip re-renders when state.files.files's top-level ref rotated
  // but no actual entry changed (Immer-induced on unrelated slice writes).
  const filesState = useAppSelector(state => state.files.files, shallowEqual); // Moved here for consistent hooks order

  const [userSkillsOpen, setUserSkillsOpen] = useState(true);
  const [systemSkillsOpen, setSystemSkillsOpen] = useState(false);
  const contextDir = useMemo(() => file?.path.substring(0, file.path.lastIndexOf('/')) || '/', [file?.path]);
  const contextInfo = useKnowledgeContext(contextDir, currentVersion, true);
  const systemSkills = useMemo(() => (
    contextInfo.availableSkills
      .filter(skill => skill.source === 'system')
      .map(skill => ({ name: skill.name, description: skill.description || '' }))
  ), [contextInfo.availableSkills]);

  // Collapsible database state
  const [expandedDatabases, setExpandedDatabases] = useState<Set<string>>(new Set());
  const hasInitializedExpanded = useRef(false);

  // Get connections loading state from Redux (for loading indicator)
  const isLoading = useAppSelector(selectConnectionsLoading);
  // Sourced here (rather than inside CodeView) per Container/View discipline (M4.2).
  const codeViewPersistableContent = useAppSelector(state => selectPersistableContent(state, file?.id as number));
  const codeViewMergedContent = useAppSelector(state => selectMergedContent(state, file?.id as number));

  // Use parentSchema (what the parent makes available to select) for the editor.
  // parentSchema is computed by the loader BEFORE applying this context's own whitelist,
  // so it always shows all databases the user can configure — even when the current
  // whitelist exposes nothing. Fall back to fullSchema for backward compatibility.
  const availableDatabases = (content.parentSchema || content.fullSchema || []).filter(db => db.schemas.length > 0);

  // Compute immediate child paths for path filtering UI
  const availableChildPaths = useMemo(() => {
    if (!file?.path) return [];

    // Get all child folders (any folder, not just ones with a knowledge base)
    // Exclude hidden system folders (database, configs, logs, etc.)
    const hiddenNames = new Set(HIDDEN_SYSTEM_FOLDERS.map(f => f.replace('/', '')));
    const allFolders = Object.values(filesState).filter(f => f.type === 'folder');

    // Find immediate child folders (one level deep)
    const fileDir = file.path.substring(0, file.path.lastIndexOf('/')) || '/';
    const children = allFolders
      .filter(f => {
        const relativePath = f.path.substring(fileDir.length);
        if (!relativePath.startsWith('/')) return false;
        const segments = relativePath.split('/').filter(Boolean);
        if (segments.length !== 1) return false; // Immediate child only
        return !hiddenNames.has(segments[0]); // Exclude system folders
      })
      .map(f => decodeURIComponent(f.path));

    return Array.from(new Set(children)).sort();
  }, [file?.path, filesState]);

  // Auto-expand/collapse databases on first load
  useEffect(() => {
    if (hasInitializedExpanded.current || availableDatabases.length === 0) return;
    hasInitializedExpanded.current = true;
    if (availableDatabases.length <= 2) {
      setExpandedDatabases(new Set(availableDatabases.map(db => db.databaseName)));
    } else {
      setExpandedDatabases(new Set());
    }
  }, [availableDatabases]);

  const toggleDatabase = (name: string) => {
    setExpandedDatabases(prev => {
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });
  };

  // Initialize databases array if empty (and not '*') when availableDatabases loads
  useEffect(() => {
    if (content.databases !== '*' && content.databases && content.databases.length === 0 && availableDatabases.length > 0) {
      const initialDatabases: DatabaseSelection[] = availableDatabases.map((db) => ({
        databaseName: db.databaseName,
        whitelist: []
      }));
      onChange({ databases: initialDatabases });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableDatabases.length]); // Re-run when fullSchema populates

  // Sync content to YAML when databases change
  useEffect(() => {
    const newYaml = serializeDatabases(content.databases);
    setYamlText(newYaml);
  }, [content.databases]);

  // Sync content to JSON when docs change
  useEffect(() => {
    setDocsJsonText(JSON.stringify(content.docs || [], null, 2));
  }, [content.docs]);

  // Block save when any doc exceeds the per-doc size cap (string docs are legacy
  // raw bodies; DocEntry docs carry `.content`). Mirrors the per-doc char count
  // shown in ContextDocsEditor — both read the same budget.
  const docsOverLimit = useMemo(
    () => (content.docs || []).some((d) => isDocContentOverLimit(typeof d === 'string' ? d : (d.content ?? ''))),
    [content.docs],
  );

  // Block save when any active doc is missing its title or description — those are
  // the only signals the analytics agent uses to LoadContext, so they're required.
  const docsMissingMeta = useMemo(
    () => anyDocMetaIncomplete(content.docs || []),
    [content.docs],
  );

  // Handle tab change - parse YAML/JSON when switching from code to picker
  const handleTabChange = (tab: string) => {
    if (activeTab === 'yaml' && tab === 'picker') {
      try {
        const parsedDatabases = parseDatabasesYaml(yamlText);
        onChange({ databases: parsedDatabases });
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Invalid YAML format');
        console.error('YAML parse error:', err);
        return;
      }
      try {
        const parsedDocs = JSON.parse(docsJsonText);
        onChange({ docs: parsedDocs });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Invalid docs JSON');
        console.error('Docs JSON parse error:', err);
        return;
      }
    }
    setActiveTab(tab as 'picker' | 'yaml');
  };

  // Handle YAML changes - update through onChange immediately
  const handleYamlChange = (newYaml: string) => {
    setYamlText(newYaml);
    // Don't parse immediately, wait for tab switch or save
  };

  // Save handler - delegate to container
  const handleSave = async () => {
    let docsForSave: (DocEntry | string)[] = content.docs || [];

    // If on code tab, validate and parse YAML/JSON first
    if (activeTab === 'yaml') {
      try {
        const parsedDatabases = parseDatabasesYaml(yamlText);
        onChange({ databases: parsedDatabases });
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Invalid YAML format');
        console.error('Cannot save - YAML parse error:', err);
        return;
      }
      try {
        const parsedDocs = JSON.parse(docsJsonText);
        onChange({ docs: parsedDocs });
        docsForSave = parsedDocs;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Invalid docs JSON');
        console.error('Cannot save - docs JSON parse error:', err);
        return;
      }
    }

    // Every active (non-draft) doc must carry a title + description — the agent
    // loads docs on demand by title, so both are required for new/edited docs.
    const missingMeta = findDocsMissingMeta(docsForSave);
    if (missingMeta.length > 0) {
      const labels = missingMeta.map((i) => `#${i + 1}`).join(', ');
      setError(`Every active doc needs a title and description before saving (missing on doc ${labels}). Mark a doc as draft to save it incomplete.`);
      return;
    }

    try {
      await onSave();
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save context');
      console.error('Save failed:', err);
    }
  };

  const canManageSkills = editMode && canEdit(user?.role || 'viewer');
  const systemSkillNames = new Set(systemSkills.map(skill => skill.name.toLowerCase()));

  const makeSkillName = useCallback((name: string, ignoreIndex?: number) => {
    const base = name.toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '') || 'skill';
    const existing = new Set((content.skills || [])
      .filter((_, index) => index !== ignoreIndex)
      .map(skill => skill.name)
      .concat(systemSkills.map(skill => skill.name)));
    let candidate = base;
    let suffix = 2;
    while (existing.has(candidate)) {
      candidate = `${base}_${suffix}`;
      suffix += 1;
    }
    return candidate;
  }, [content.skills, systemSkills]);

  const handleAddSkill = () => {
    const now = new Date().toISOString();
    const skill: SkillEntry = {
      name: makeSkillName('new_skill'),
      description: '',
      content: '',
      enabled: true,
      createdAt: now,
      updatedAt: now,
      createdBy: user?.id || 1,
    };
    onChange({ skills: [...(content.skills || []), skill] });
  };

  const handleUpdateSkill = useCallback((index: number, updates: Partial<SkillEntry>) => {
    const skills = [...(content.skills || [])];
    const current = skills[index];
    if (!current) return;
    const next = { ...current, ...updates, updatedAt: new Date().toISOString() };
    if (updates.name !== undefined) {
      next.name = makeSkillName(updates.name, index);
    }
    skills[index] = next;
    onChange({ skills });
  }, [content.skills, makeSkillName, onChange]);

  const handleDeleteSkill = useCallback((index: number) => {
    onChange({ skills: (content.skills || []).filter((_, i) => i !== index) });
  }, [content.skills, onChange]);

  return (
    <VStack gap={6} align="stretch" p={3}>
      {/* Document Header */}
      <Box borderBottomWidth="1px" borderColor="border.muted" pb={2}>
        <DocumentHeader
          name={fileName}
          fileType="context"
          editMode={editMode}
          isDirty={isDirty}
          isSaving={isSaving}
          validateBeforeSave={() => {
            // Save stays enabled; clicking surfaces whichever doc issue blocks it.
            if (docsOverLimit) return 'A document exceeds the size limit — shorten it before saving.';
            if (docsMissingMeta) return 'Every active document needs a title and description — fill them in (or use ✨ Auto) before saving.';
            return null;
          }}
          saveError={saveError}
          readOnlyName={true}
          hideDescription={true}
          onNameChange={(name) => onMetadataChange({ name })}
          onDescriptionChange={() => {}} // Context files don't have description
          onEditModeToggle={() => {
            if (editMode) {
              onCancel();
            } else {
              onEditModeChange(true);
            }
          }}
          onSave={handleSave}
          viewMode={activeTab === 'picker' ? 'visual' : 'json'}
          onViewModeChange={(mode) => handleTabChange(mode === 'visual' ? 'picker' : 'yaml')}
          additionalBadges={file ? <FileHealthBadge fileId={file.id} fileType="context" /> : undefined}
        />
      </Box>

      {/* Todo: Vivek - hide version manager for now, to be added back later */}
      {/* <ContextVersionManager
        content={content}
        showDebug={showDebug}
        isAdmin={isAdmin}
        currentVersion={currentVersion}
        allVersions={allVersions}
        publishedStatus={publishedStatus}
        isDirty={isDirty}
        onSwitchVersion={onSwitchVersion}
        onCreateVersion={onCreateVersion}
        onPublishVersion={onPublishVersion}
        onDeleteVersion={onDeleteVersion}
      /> */}

      {/* Error Display */}
      {error && (
        <Box
          p={3}
          bg="accent.danger/10"
          borderLeft="3px solid"
          borderColor="accent.danger"
          borderRadius="md"
        >
          <HStack gap={2}>
            <LuCircleAlert color="var(--chakra-colors-accent-danger)" />
            <Text color="accent.danger" fontSize="sm">
              {error}
            </Text>
          </HStack>
        </Box>
      )}

      {/* Status bar: Live/Draft toggle + suppress — shown when schedule is configured */}
      {content.schedule && (
        <StatusBanner
          status={content.status ?? 'draft'}
          label="evals"
          runLabel="Run Now"
          editMode={editMode}
          onChange={(s) => onChange({ status: s })}
          suppressUntil={content.suppressUntil}
          onSuppressChange={(val) => onChange({ suppressUntil: val })}
        />
      )}

      {/* Code view (whole-file JSON + agent XML) replaces the picker tabs when toggled. */}
      {activeTab === 'yaml' && file?.id !== undefined ? (
        // JSON tab: the real saved file (version-based), minus ALL loader-computed `full*`/parent
        // fields — derived, not authored, stripped on save — so it shows the true persisted content.
        // XML tab: EXACTLY what the agent sees — the flattened live-version knowledge view
        // (shapeContextForAgent), which differs from the saved JSON. Context is the one type
        // where the file-on-disk and the agent's view diverge.
        <CodeView
          fileId={file.id}
          fileType="context"
          persistableContent={codeViewPersistableContent}
          mergedContent={codeViewMergedContent}
          editable={editMode}
          omitKeys={['fullSchema', 'parentSchema', 'fullDocs', 'fullAnnotations', 'fullMetrics', 'fullRelationships', 'fullViews', 'fullSkills']}
          xmlContentTransform={shapeContextForAgent}
        />
      ) : (
      <Tabs.Root
        value={topTab}
        onValueChange={(e) => setTopTab(e.value as TopTab)}
        variant="line"
        colorPalette="teal"
      >
        <Tabs.List>
          <Tabs.Trigger value="databases" fontFamily="mono" fontSize="sm">
            Databases
          </Tabs.Trigger>
          <Tabs.Trigger value="semantic" fontFamily="mono" fontSize="sm">
            Semantic
            {(content.semanticModels?.length ?? 0) > 0 && (
              <Badge size="xs" colorPalette="gray" variant="subtle" ml={1.5}>
                {content.semanticModels!.length}
              </Badge>
            )}
          </Tabs.Trigger>
          <Tabs.Trigger value="docs" fontFamily="mono" fontSize="sm">
            Docs
            {(content.docs?.length ?? 0) > 0 && (
              <Box
                display="inline-flex"
                alignItems="center"
                justifyContent="center"
                w="18px"
                h="18px"
                // p={2}
                borderRadius="full"
                bg="accent.teal/20"
                color="accent.teal"
                fontSize="3xs"
                fontWeight="700"
                ml={1}
              >
                {content.docs!.length}
              </Box>
            )}
          </Tabs.Trigger>
          <Tabs.Trigger value="skills" fontFamily="mono" fontSize="sm">
            Skills
            {(content.skills?.length ?? 0) > 0 && (
              <Badge size="xs" colorPalette="gray" variant="subtle" ml={1.5}>
                {content.skills!.length}
              </Badge>
            )}
          </Tabs.Trigger>
          <Tabs.Trigger value="evals" fontFamily="mono" fontSize="sm">
            Evals
            {(content.evals?.length ?? 0) > 0 && (
              <Badge size="xs" colorPalette="gray" variant="subtle" ml={1.5}>
                {content.evals!.length}
              </Badge>
            )}
          </Tabs.Trigger>
        </Tabs.List>

        {/* Tables Tab */}
        <DatabasesTabContent
          isActive={topTab === 'databases'}
          activeTab={activeTab}
          colorMode={colorMode}
          editMode={editMode}
          isLoading={isLoading}
          availableDatabases={availableDatabases}
          content={content}
          onChange={onChange}
          availableChildPaths={availableChildPaths}
          expandedDatabases={expandedDatabases}
          toggleDatabase={toggleDatabase}
          yamlText={yamlText}
          onYamlChange={handleYamlChange}
          contextPath={file?.path ?? ''}
        />

        {/* Semantic Models Tab — authored SemanticModelV2 on the current
            version (Semantic_Model_v2.md M5b). Same onChange pattern as views;
            save-gate tier-1/2/3 errors surface through the shared saveError /
            error banner above. */}
        <Tabs.Content value="semantic">
          {topTab === 'semantic' && (
            <SemanticModelsEditor
              models={content.semanticModels || []}
              inheritedModels={content.fullSemanticModels || []}
              databases={availableDatabases}
              views={[...(content.fullViews || []), ...(content.views || [])]}
              editMode={editMode}
              onChange={(semanticModels) => onChange({ semanticModels })}
            />
          )}
        </Tabs.Content>

        {/* Docs Tab */}
        <Tabs.Content value="docs">
          {activeTab === 'picker' ? (
          <ContextDocsEditor
            docs={content.docs || []}
            onDocsChange={(docs) => onChange({ docs })}
            inheritedDocs={content.fullDocs}
            originalDocs={originalDocs}
            availableChildPaths={availableChildPaths}
            mentions={{ whitelistedSchemas: availableDatabases, metrics: [...(content.fullMetrics || []), ...(content.metrics || [])] }}
            editMode={editMode}
          />
          ) : (
            <Box
              border="1px solid"
              borderColor="border.default"
              borderRadius="md"
              overflow="hidden"
              minH="600px"
            >
              <Editor
                height="600px"
                language="json"
                value={docsJsonText}
                onChange={(value) => setDocsJsonText(value || '')}
                theme={colorMode === 'dark' ? 'vs-dark' : 'light'}
                options={{
                  readOnly: !editMode,
                  readOnlyMessage: MONACO_READ_ONLY_MESSAGE,
                  minimap: { enabled: false },
                  wordWrap: 'on',
                  lineNumbers: 'on',
                  fontSize: 14,
                  fontFamily: 'var(--font-jetbrains-mono)',
                  scrollBeyondLastLine: false,
                  automaticLayout: true,
                  tabSize: 2,
                }}
              />
            </Box>
          )}
        </Tabs.Content>

        {/* Skills Tab */}
        <SkillsTabContent
          activeTab={activeTab}
          colorMode={colorMode}
          content={content}
          onChange={onChange}
          canManageSkills={canManageSkills}
          systemSkills={systemSkills}
          systemSkillNames={systemSkillNames}
          userSkillsOpen={userSkillsOpen}
          onUserSkillsOpenChange={setUserSkillsOpen}
          systemSkillsOpen={systemSkillsOpen}
          onSystemSkillsOpenChange={setSystemSkillsOpen}
          onAddSkill={handleAddSkill}
          onUpdateSkill={handleUpdateSkill}
          onDeleteSkill={handleDeleteSkill}
        />

        {/* Evals Tab */}
        <EvalsTabContent
          activeTab={activeTab}
          colorMode={colorMode}
          editMode={editMode}
          content={content}
          onChange={onChange}
          runs={runs}
          isRunning={isRunning}
          selectedRunId={selectedRunId}
          onRunAll={onRunAll}
          onSelectRun={onSelectRun}
        />
      </Tabs.Root>
      )}
    </VStack>
  );
}
