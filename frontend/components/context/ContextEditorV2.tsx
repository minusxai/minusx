'use client';

/**
 * ContextEditorV2 - With Version Management
 * Pure controlled component with version management UI for admins
 * All changes go through onChange immediately
 */

import { Box, VStack, Heading, HStack, Button, Text, Badge, Menu, Input, Dialog, Field, Portal, Collapsible, Icon, Switch, Tabs } from '@chakra-ui/react';
import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { LuCircleAlert, LuCircleCheck, LuPlus, LuTrash2, LuChevronDown, LuGlobe, LuChevronRight, LuImage } from 'react-icons/lu';
import { uploadFile } from '@/lib/object-store/client';
import { ContextContent, DatabaseContext, WhitelistItem, ContextVersion, PublishedVersions, DocEntry, Test } from '@/lib/types';
import { SchedulePicker } from '@/components/shared/SchedulePicker';
import { DeliveryCard } from '@/components/shared/DeliveryPicker';
import { StatusBanner } from '@/components/shared/StatusBanner';
import { RunNowHeader, type RunOptions } from '@/components/shared/RunNowHeader';
import TestList from '../test/TestList';
import ContextRunView from '../views/ContextRunView';
import type { JobRun } from '@/lib/types';
import { serializeDatabases, parseDatabasesYaml, canDeleteVersion } from '@/lib/context/context-utils';
import SchemaTreeView from '../SchemaTreeView';
import ChildPathSelector from '../ChildPathSelector';
import { Checkbox } from '@/components/ui/checkbox';
import Editor, { DiffEditor } from '@monaco-editor/react';
import Markdown from '../Markdown';
import DocumentHeader from '../DocumentHeader';
import { toaster } from '@/components/ui/toaster';
import { useAppSelector } from '@/store/hooks';
import { selectConnectionsLoading } from '@/store/filesSlice';
import { HIDDEN_SYSTEM_FOLDERS } from '@/lib/mode/path-resolver';

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
  const [topTab, setTopTab] = useState<'tables' | 'docs' | 'evals'>('tables');
  const [activeTab, setActiveTab] = useState<'picker' | 'yaml'>('picker');
  const [yamlText, setYamlText] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const colorMode = useAppSelector((state) => state.ui.colorMode);
  const showDebug = useAppSelector((state) => state.ui.devMode);
  const user = useAppSelector(state => state.auth.user);
  const filesState = useAppSelector(state => state.files.files); // Moved here for consistent hooks order

  // Version management state
  const [isCreateVersionOpen, setIsCreateVersionOpen] = useState(false);
  const [newVersionDescription, setNewVersionDescription] = useState('');
  const [isDeleteVersionOpen, setIsDeleteVersionOpen] = useState(false);
  const [versionToDelete, setVersionToDelete] = useState<number | null>(null);
  const [deleteErrorMessage, setDeleteErrorMessage] = useState<string | null>(null);

  // Collapsible database state
  const [expandedDatabases, setExpandedDatabases] = useState<Set<string>>(new Set());
  const hasInitializedExpanded = useRef(false);

  // Collapsible doc entries state
  const [expandedDocs, setExpandedDocs] = useState<Set<number>>(() => new Set([0])); // First entry expanded by default
  // null = default (editor + preview side by side), 'editor' = editor only, 'preview' = preview only, 'diff' = diff side by side
  const [docViewModes, setDocViewModes] = useState<Record<number, 'editor' | 'preview' | 'diff' | null>>({});

  // Image upload: one hidden file input shared across all doc entries
  const imageUploadInputRef = useRef<HTMLInputElement>(null);
  const imageUploadTargetIndex = useRef<number | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const docEditorRefs = useRef<Record<number, any>>({});

  const handleImageUploadClick = useCallback((index: number) => {
    imageUploadTargetIndex.current = index;
    imageUploadInputRef.current?.click();
  }, []);

  const handleImageFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || imageUploadTargetIndex.current === null) return;

    const targetIndex = imageUploadTargetIndex.current;
    try {
      const { publicUrl } = await uploadFile(file);
      const markdownSnippet = `![${file.name}](${publicUrl})`;
      const editor = docEditorRefs.current[targetIndex];
      if (editor) {
        const selection = editor.getSelection();
        editor.executeEdits('image-upload', [{ range: selection, text: markdownSnippet }]);
        editor.focus();
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to upload image';
      toaster.create({ title: message, type: 'error' });
    }
  }, []);

  // Get connections loading state from Redux (for loading indicator)
  const isLoading = useAppSelector(selectConnectionsLoading);

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

  const toggleDoc = (index: number) => {
    setExpandedDocs(prev => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  const setDocViewMode = (index: number, mode: 'editor' | 'preview' | 'diff' | null) => {
    setDocViewModes(prev => ({ ...prev, [index]: mode }));
  };

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
      const initialDatabases: DatabaseContext[] = availableDatabases.map((db) => ({
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

  // Handle tab change - parse YAML when switching from YAML to picker
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
    }
    setActiveTab(tab as 'picker' | 'yaml');
  };

  // Handle YAML changes - update through onChange immediately
  const handleYamlChange = (newYaml: string) => {
    setYamlText(newYaml);
    // Don't parse immediately, wait for tab switch or save
  };

  // Handle docs changes - debounced to avoid re-rendering preview on every keystroke.
  // Monaco manages its own buffer so typing stays responsive.
  const markdownTimerRef = useRef<NodeJS.Timeout | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const contentDocsRef = useRef(content.docs);
  contentDocsRef.current = content.docs;

  const handleMarkdownChange = useCallback((index: number, newMarkdown: string) => {
    if (markdownTimerRef.current) clearTimeout(markdownTimerRef.current);
    markdownTimerRef.current = setTimeout(() => {
      const currentDocs = contentDocsRef.current || [];
      const newDocs = [...currentDocs];
      newDocs[index] = {
        ...newDocs[index],
        content: newMarkdown
      };
      onChangeRef.current({ docs: newDocs });
    }, 300);
  }, []);

  const handleAddDoc = () => {
    const currentDocs = content.docs || [];
    onChange({ docs: [...currentDocs, { content: '' }] });
  };

  const handleRemoveDoc = (index: number) => {
    const currentDocs = content.docs || [];
    onChange({ docs: currentDocs.filter((_, i) => i !== index) });
  };

  const handleToggleDraft = (index: number) => {
    const currentDocs = content.docs || [];
    const newDocs = [...currentDocs];
    newDocs[index] = {
      ...newDocs[index],
      draft: !newDocs[index].draft
    };
    onChange({ docs: newDocs });
  };

  const handleChildPathsChange = (index: number, childPaths: string[] | undefined) => {
    const currentDocs = content.docs || [];
    const newDocs = [...currentDocs];
    newDocs[index] = {
      ...newDocs[index],
      childPaths
    };
    onChange({ docs: newDocs });
  };

  // Handle whitelist change - pure controlled
  const handleWhitelistChange = (databaseName: string, newWhitelist: WhitelistItem[]) => {
    // When databases === '*', synthesize a full whitelist for all connections as the starting point
    // so that modifying one connection doesn't implicitly exclude all others.
    const databases: DatabaseContext[] = content.databases === '*'
      ? availableDatabases.map(db => ({
          databaseName: db.databaseName,
          whitelist: db.schemas.map(s => ({ type: 'schema' as const, name: s.schema })),
        }))
      : (content.databases || []);
    const dbIndex = databases.findIndex((db: DatabaseContext) => db.databaseName === databaseName);

    if (dbIndex >= 0) {
      // Update existing database
      const newDatabases = [...databases];
      newDatabases[dbIndex] = { ...newDatabases[dbIndex], whitelist: newWhitelist };
      onChange({ databases: newDatabases });
    } else {
      // Add new database if it doesn't exist yet
      onChange({
        databases: [...databases, { databaseName, whitelist: newWhitelist }]
      });
    }
  };

  // Save handler - delegate to container
  const handleSave = async () => {
    // If on YAML tab, validate and parse first
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
    }

    try {
      await onSave();
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save context');
      console.error('Save failed:', err);
    }
  };

  // Count total whitelisted items ('*' = all available)
  const totalWhitelisted = content.databases === '*'
    ? availableDatabases.reduce((sum: number, db) => sum + db.schemas.reduce((s: number, sc) => s + sc.tables.length, 0), 0)
    : (content.databases || []).reduce((sum: number, db: DatabaseContext) => sum + db.whitelist.length, 0);

  // Version management helpers
  const getVersionLabel = (version: ContextVersion) => {
    const labels: string[] = [`Version ${version.version}`];

    if (publishedStatus.all === version.version) {
      labels.push('Published');
    }

    return labels.join(' • ');
  };

  const handleCreateVersionClick = () => {
    setNewVersionDescription('');
    setIsCreateVersionOpen(true);
  };

  const handleCreateVersionConfirm = () => {
    if (onCreateVersion) {
      onCreateVersion(newVersionDescription);
    }
    setIsCreateVersionOpen(false);
  };

  const handleDeleteVersionClick = (version: number) => {
    if (!canDeleteVersion(content, version)) {
      setDeleteErrorMessage('Cannot delete this version: it is either the only version or is currently published.');
      return;
    }

    setVersionToDelete(version);
    setIsDeleteVersionOpen(true);
  };

  const handleDeleteVersionConfirm = () => {
    if (versionToDelete !== null && onDeleteVersion) {
      onDeleteVersion(versionToDelete);
    }
    setIsDeleteVersionOpen(false);
    setVersionToDelete(null);
  };

  const evalsSelectedRun = runs.find(r => r.id === selectedRunId) ?? runs[0] ?? null;

  return (
    <VStack gap={6} align="stretch" p={3}>
      {/* Hidden file input shared across all markdown editors for image upload */}
      <input
        aria-label="Upload image to insert in documentation"
        type="file"
        accept="image/*"
        ref={imageUploadInputRef}
        style={{ display: 'none' }}
        onChange={handleImageFileSelect}
      />

      {/* Document Header */}
      <Box borderBottomWidth="1px" borderColor="border.muted" pb={2}>
        <DocumentHeader
          name={fileName}
          fileType="context"
          editMode={editMode}
          isDirty={isDirty}
          isSaving={isSaving}
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
        />
      </Box>

      {/* Version Management (Admin Only, behind debug toggle) */}
      {showDebug && isAdmin && allVersions.length > 0 && (
        <HStack justify="space-between" px={3} py={2} bg="bg.muted" borderRadius="md">
          <HStack gap={3}>
            <Text fontSize="sm" fontWeight="600" color="fg.muted">
              Version:
            </Text>
            <Menu.Root>
              <Menu.Trigger asChild>
                <Button size="xs" variant="outline">
                  {getVersionLabel(allVersions.find(v => v.version === currentVersion)!)}
                  <LuChevronDown />
                </Button>
              </Menu.Trigger>
              <Portal>
                <Menu.Positioner>
                  <Menu.Content>
                    {allVersions.map(version => (
                      <Menu.Item
                        key={version.version}
                        value={version.version.toString()}
                        onClick={() => onSwitchVersion?.(version.version)}
                      >
                        <HStack justify="space-between" width="100%">
                          <Text>{getVersionLabel(version)}</Text>
                          {publishedStatus.all === version.version && (
                            <Badge size="xs" colorPalette="green">
                              <LuCircleCheck /> Published
                            </Badge>
                          )}
                        </HStack>
                      </Menu.Item>
                    ))}
                  </Menu.Content>
                </Menu.Positioner>
              </Portal>
            </Menu.Root>
            {allVersions.find(v => v.version === currentVersion)?.description && (
              <Text fontSize="xs" color="fg.muted">
                — {allVersions.find(v => v.version === currentVersion)!.description}
              </Text>
            )}
          </HStack>

          {/* Version Actions */}
          <HStack gap={2}>
            <Button
              size="xs"
              variant="outline"
              onClick={handleCreateVersionClick}
            >
              <LuPlus />
              New Version
            </Button>

            {/* Show publish button if not already published */}
            {publishedStatus.all !== currentVersion && (
              <Button
                size="xs"
                variant="outline"
                disabled={isDirty}
                onClick={onPublishVersion}
              >
                <LuGlobe />
                Publish
              </Button>
            )}

            {allVersions.length > 1 && canDeleteVersion(content, currentVersion) && (
              <Button
                size="xs"
                variant="outline"
                colorPalette="red"
                onClick={() => handleDeleteVersionClick(currentVersion)}
              >
                <LuTrash2 />
              </Button>
            )}
          </HStack>
        </HStack>
      )}

      {/* Create Version Dialog */}
      <Dialog.Root open={isCreateVersionOpen} onOpenChange={(e: { open: boolean }) => setIsCreateVersionOpen(e.open)}>
        <Portal>
          <Dialog.Backdrop />
          <Dialog.Positioner>
            <Dialog.Content
              maxW="500px"
              bg="bg.surface"
              borderRadius="lg"
              border="1px solid"
              borderColor="border.default"
            >
              <Dialog.Header px={6} py={4} borderBottom="1px solid" borderColor="border.default">
                <Dialog.Title fontWeight="700" fontSize="xl">Create New Version</Dialog.Title>
              </Dialog.Header>
              <Dialog.Body px={6} py={5}>
                <Field.Root>
                  <Field.Label>Description (optional)</Field.Label>
                  <Input
                    value={newVersionDescription}
                    onChange={(e) => setNewVersionDescription(e.target.value)}
                    placeholder="e.g., Added marketing tables"
                  />
                </Field.Root>
              </Dialog.Body>
              <Dialog.Footer px={6} py={4} gap={3} borderTop="1px solid" borderColor="border.default" justifyContent="flex-end">
                <Dialog.ActionTrigger asChild>
                  <Button variant="outline" onClick={() => setIsCreateVersionOpen(false)}>
                    Cancel
                  </Button>
                </Dialog.ActionTrigger>
                <Button bg="accent.cyan" color="white" onClick={handleCreateVersionConfirm}>
                  Create Version
                </Button>
              </Dialog.Footer>
              <Dialog.CloseTrigger />
            </Dialog.Content>
          </Dialog.Positioner>
        </Portal>
      </Dialog.Root>

      {/* Delete Version Confirmation Dialog */}
      <Dialog.Root open={isDeleteVersionOpen} onOpenChange={(e: { open: boolean }) => setIsDeleteVersionOpen(e.open)}>
        <Portal>
          <Dialog.Backdrop />
          <Dialog.Positioner>
            <Dialog.Content
              maxW="500px"
              bg="bg.surface"
              borderRadius="lg"
              border="1px solid"
              borderColor="border.default"
            >
              <Dialog.Header px={6} py={4} borderBottom="1px solid" borderColor="border.default">
                <Dialog.Title fontWeight="700" fontSize="xl">Delete Version</Dialog.Title>
              </Dialog.Header>
              <Dialog.Body px={6} py={5}>
                <Text fontSize="sm" lineHeight="1.6">
                  Are you sure you want to delete <Text as="span" fontWeight="600" fontFamily="mono">Version {versionToDelete}</Text>? This action cannot be undone.
                </Text>
              </Dialog.Body>
              <Dialog.Footer px={6} py={4} gap={3} borderTop="1px solid" borderColor="border.default" justifyContent="flex-end">
                <Dialog.ActionTrigger asChild>
                  <Button variant="outline" onClick={() => setIsDeleteVersionOpen(false)}>
                    Cancel
                  </Button>
                </Dialog.ActionTrigger>
                <Button bg="accent.danger" color="white" onClick={handleDeleteVersionConfirm}>
                  Delete Version
                </Button>
              </Dialog.Footer>
              <Dialog.CloseTrigger />
            </Dialog.Content>
          </Dialog.Positioner>
        </Portal>
      </Dialog.Root>

      {/* Delete Error Dialog */}
      <Dialog.Root open={deleteErrorMessage !== null} onOpenChange={(e: { open: boolean }) => !e.open && setDeleteErrorMessage(null)}>
        <Portal>
          <Dialog.Backdrop />
          <Dialog.Positioner>
            <Dialog.Content
              maxW="500px"
              bg="bg.surface"
              borderRadius="lg"
              border="1px solid"
              borderColor="border.default"
            >
              <Dialog.Header px={6} py={4} borderBottom="1px solid" borderColor="border.default">
                <Dialog.Title fontWeight="700" fontSize="xl">Cannot Delete Version</Dialog.Title>
              </Dialog.Header>
              <Dialog.Body px={6} py={5}>
                <Text fontSize="sm" lineHeight="1.6">
                  {deleteErrorMessage}
                </Text>
              </Dialog.Body>
              <Dialog.Footer px={6} py={4} gap={3} borderTop="1px solid" borderColor="border.default" justifyContent="flex-end">
                <Button variant="outline" onClick={() => setDeleteErrorMessage(null)}>
                  OK
                </Button>
              </Dialog.Footer>
              <Dialog.CloseTrigger />
            </Dialog.Content>
          </Dialog.Positioner>
        </Portal>
      </Dialog.Root>

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

      {/* Top-level Tabs */}
      <Tabs.Root
        value={topTab}
        onValueChange={(e) => setTopTab(e.value as 'tables' | 'docs' | 'evals')}
        variant="line"
        colorPalette="teal"
      >
        <Tabs.List>
          <Tabs.Trigger value="tables" fontFamily="mono" fontSize="sm">
            Databases
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
        <Tabs.Content value="tables">
          {activeTab === 'picker' ? (
            <VStack gap={6} align="stretch">
              {/* Database Sections */}
              <Box>
                {!isLoading && availableDatabases.length > 0 && (
                  <HStack justify="space-between" mb={2}>
                    <HStack
                      gap={1.5}
                      px={2.5}
                      py={1}
                      bg={content.databases === '*' ? 'accent.teal/10' : 'bg.muted'}
                      borderRadius="full"
                    >
                      <Icon as={LuGlobe} boxSize={3} color={content.databases === '*' ? 'accent.teal' : 'fg.muted'} />
                      <Text fontSize="xs" fontWeight="600" fontFamily="mono" color={content.databases === '*' ? 'accent.teal' : 'fg.muted'}>
                        {content.databases === '*' ? 'All databases selected — includes future connections' : 'Custom selection'}
                      </Text>
                    </HStack>
                    {content.databases === '*' ? (
                      <Button
                        size="xs"
                        variant="outline"
                        onClick={() => {
                          const explicitDbs: DatabaseContext[] = availableDatabases.map(db => ({
                            databaseName: db.databaseName,
                            whitelist: db.schemas.map(s => ({ type: 'schema' as const, name: s.schema })),
                          }));
                          onChange({ databases: explicitDbs });
                        }}
                        fontFamily="mono"
                      >
                        Edit selection
                      </Button>
                    ) : (
                      <Button
                        size="xs"
                        variant="outline"
                        onClick={() => onChange({ databases: '*' })}
                        fontFamily="mono"
                      >
                        Wildcard — select all
                      </Button>
                    )}
                  </HStack>
                )}
                {!isLoading && availableDatabases.length > 0 && totalWhitelisted === 0 && (
                  <Box
                    p={3}
                    mb={3}
                    bg="accent.warning/10"
                    borderLeft="3px solid"
                    borderColor="accent.warning"
                    borderRadius="md"
                  >
                    <HStack gap={2}>
                      <LuCircleAlert color="var(--chakra-colors-accent-warning)" />
                      <Text color="accent.warning" fontSize="sm">
                        No schemas or tables whitelisted. Select at least one below.
                      </Text>
                    </HStack>
                  </Box>
                )}
                {isLoading ? (
                  <Box p={8} textAlign="center">
                    <Text color="fg.muted">Loading context...</Text>
                  </Box>
                ) : availableDatabases.length === 0 ? (
                  <Box p={8} textAlign="center">
                    <Text color="fg.muted">No schemas available from parent context</Text>
                  </Box>
                ) : (
                  <VStack gap={4} align="stretch">
                    {availableDatabases.map((database) => {
                      const isConnectionWildcard = content.databases === '*';
                      // When databases === '*', pass empty whitelist and let connectionWhitelisted prop handle visuals
                      const whitelist: WhitelistItem[] = isConnectionWildcard
                        ? []
                        : ((content.databases || []) as DatabaseContext[]).find(
                            (db: DatabaseContext) => db.databaseName === database.databaseName
                          )?.whitelist || [];

                      const isExpanded = expandedDatabases.has(database.databaseName);
                      const whitelistedSchemas = whitelist.filter(w => w.type === 'schema');
                      const whitelistedTables = whitelist.filter(w => w.type === 'table');
                      const totalTables = database.schemas.reduce((sum, s) => sum + s.tables.length, 0);
                      const tablesFromSchemas = database.schemas
                        .filter(s => whitelistedSchemas.some(ws => ws.name === s.schema))
                        .reduce((sum, s) => sum + s.tables.length, 0);
                      // When wildcarded, all tables are effectively included
                      const effectiveTableCount = isConnectionWildcard ? totalTables : tablesFromSchemas + whitelistedTables.length;
                      const hasAny = effectiveTableCount > 0;

                      // Connection-level checkbox state
                      const connectionCheckboxState: { checked: boolean; indeterminate: boolean } = (() => {
                        if (isConnectionWildcard) return { checked: true, indeterminate: false };
                        if (whitelist.length === 0) return { checked: false, indeterminate: false };
                        const isFullyCovered = database.schemas.every(s =>
                          whitelistedSchemas.some(ws => ws.name === s.schema) ||
                          s.tables.every(t => whitelistedTables.some(wt => wt.name === t.table && wt.schema === s.schema))
                        );
                        if (isFullyCovered) return { checked: true, indeterminate: false };
                        return { checked: false, indeterminate: true };
                      })();

                      return (
                        <Box
                          key={database.databaseName}
                          border="1px solid"
                          borderColor="border.default"
                          borderRadius="md"
                          overflow="hidden"
                          bg="bg.surface"
                        >
                          <Collapsible.Root open={isExpanded} onOpenChange={() => toggleDatabase(database.databaseName)}>
                            <Collapsible.Trigger asChild>
                              <Box
                                px={4}
                                py={3}
                                bg="bg.muted"
                                cursor="pointer"
                                _hover={{ bg: 'bg.emphasized' }}
                                {...(isExpanded ? { borderBottom: '1px solid', borderColor: 'border.default' } : {})}
                              >
                                <HStack gap={2}>
                                  <Box
                                    position="relative"
                                    onClick={(e: React.MouseEvent) => { e.stopPropagation(); }}
                                  >
                                    <Checkbox
                                      checked={connectionCheckboxState.checked}
                                      onCheckedChange={() => {
                                        if (connectionCheckboxState.checked || connectionCheckboxState.indeterminate) {
                                          handleWhitelistChange(database.databaseName, []);
                                        } else {
                                          handleWhitelistChange(database.databaseName, database.schemas.map(s => ({ type: 'schema' as const, name: s.schema })));
                                        }
                                      }}
                                    />
                                    {connectionCheckboxState.indeterminate && (
                                      <Box
                                        position="absolute"
                                        top="50%"
                                        left="50%"
                                        transform="translate(-50%, -50%)"
                                        width="8px"
                                        height="2px"
                                        bg="accent.teal"
                                        borderRadius="sm"
                                        pointerEvents="none"
                                      />
                                    )}
                                  </Box>
                                  <Icon
                                    as={isExpanded ? LuChevronDown : LuChevronRight}
                                    boxSize={4}
                                    color="fg.muted"
                                  />
                                  <Text
                                    fontSize="md"
                                    fontWeight="700"
                                    color="fg.default"
                                    fontFamily="mono"
                                  >
                                    {database.databaseName}
                                  </Text>
                                  {isConnectionWildcard && (
                                    <Box
                                      px={2}
                                      py={0.5}
                                      bg="accent.teal/15"
                                      borderRadius="sm"
                                      border="1px solid"
                                      borderColor="accent.teal/30"
                                    >
                                      <Text fontSize="2xs" fontWeight="700" color="accent.teal" fontFamily="mono">
                                        all schemas
                                      </Text>
                                    </Box>
                                  )}
                                  <Box
                                    px={2}
                                    py={0.5}
                                    bg={hasAny ? 'accent.cyan/15' : 'bg.canvas'}
                                    borderRadius="sm"
                                    border="1px solid"
                                    borderColor={hasAny ? 'accent.cyan/30' : 'border.muted'}
                                  >
                                    <Text
                                      fontSize="2xs"
                                      fontWeight="700"
                                      color={hasAny ? 'accent.cyan' : 'fg.subtle'}
                                      fontFamily="mono"
                                    >
                                      {effectiveTableCount}/{totalTables} {totalTables === 1 ? 'table' : 'tables'}
                                    </Text>
                                  </Box>
                                </HStack>
                              </Box>
                            </Collapsible.Trigger>
                            <Collapsible.Content>
                              <Box p={4}>
                                <SchemaTreeView
                                  schemas={database.schemas}
                                  selectable={true}
                                  whitelist={whitelist}
                                  onWhitelistChange={(newWhitelist) =>
                                    handleWhitelistChange(database.databaseName, newWhitelist)
                                  }
                                  showColumns={true}
                                  showStats={true}
                                  showPathFilter={true}
                                  availableChildPaths={availableChildPaths}
                                  connectionWhitelisted={isConnectionWildcard}
                                />
                              </Box>
                            </Collapsible.Content>
                          </Collapsible.Root>
                        </Box>
                      );
                    })}
                  </VStack>
                )}
              </Box>

            </VStack>
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
                language="yaml"
                value={yamlText}
                onChange={(value) => handleYamlChange(value || '')}
                theme={colorMode === 'dark' ? 'vs-dark' : 'light'}
                options={{
                  minimap: { enabled: false },
                  wordWrap: 'on',
                  lineNumbers: 'on',
                  fontSize: 14,
                  fontFamily: 'JetBrains Mono, monospace',
                  scrollBeyondLastLine: false,
                  automaticLayout: true,
                  tabSize: 2,
                }}
              />
            </Box>
          )}
          {/* Stats Footer */}
          {!isLoading && totalWhitelisted > 0 && (
            <Box
              p={3}
              bg="bg.surface"
              borderRadius="md"
              border="1px solid"
              borderColor="border.default"
            >
              <HStack gap={2} fontSize="sm" color="fg.muted">
                <LuCircleCheck color="var(--chakra-colors-accent-success)" />
                <Text>
                  <strong>{content.databases?.length || 0}</strong> databases configured with{' '}
                  <strong>{totalWhitelisted}</strong> total whitelisted items
                </Text>
              </HStack>
            </Box>
          )}
        </Tabs.Content>

        {/* Docs Tab */}
        <Tabs.Content value="docs">
          <VStack gap={6} align="stretch">
              <Box>
                {(!content.docs || content.docs.length === 0) && (
                  <HStack gap={1} color="accent.warning" mb={3}>
                    <LuCircleAlert size={16} />
                    <Text fontSize="sm" fontWeight="500">No documentation added</Text>
                  </HStack>
                )}
                <Text fontSize="sm" color="fg.muted" mb={3}>
                  Add notes and documentation about the databases
                </Text>

                {/* Inherited docs (read-only) */}
                {content.fullDocs && content.fullDocs.length > 0 && (
                  <Box mb={4}>
                    <Text fontSize="sm" fontWeight="600" color="fg.muted" mb={2}>
                      Inherited Documentation (from parent contexts)
                    </Text>
                    <VStack gap={2} align="stretch">
                      {content.fullDocs.map((docEntry, idx) => (
                        <Box
                          key={`inherited-${idx}`}
                          p={3}
                          border="1px solid"
                          borderColor="border.default"
                          borderRadius="md"
                          bg="bg.muted"
                          opacity={0.7}
                        >
                          <Markdown context="mainpage">{docEntry.content}</Markdown>
                        </Box>
                      ))}
                    </VStack>
                  </Box>
                )}

                {/* Own docs (editable) */}
                <VStack gap={4} align="stretch">
                  {(content.docs || []).map((docEntry, index) => {
                    const isDocExpanded = expandedDocs.has(index);
                    const hasDiff = originalDocs?.[index] != null && originalDocs[index].content !== docEntry.content;
                    const rawDocView = docViewModes[index] ?? null;
                    // Auto-fallback: if on diff but no diff exists, show default
                    const docView = rawDocView === 'diff' && !hasDiff ? null : rawDocView;
                    const previewLine = docEntry.content.trim().split('\n')[0]?.slice(0, 80) || 'Empty';

                    return (
                    <Box
                      key={index}
                      border="1px solid"
                      borderColor={docEntry.draft ? 'border.muted' : 'border.default'}
                      borderRadius="md"
                      overflow="hidden"
                      opacity={docEntry.draft ? 0.6 : 1}
                    >
                      {/* Collapsible header */}
                      <Collapsible.Root open={isDocExpanded} onOpenChange={() => toggleDoc(index)}>
                        <Collapsible.Trigger asChild>
                          <Box
                            px={3}
                            py={2}
                            bg="bg.muted"
                            cursor="pointer"
                            _hover={{ bg: 'bg.emphasized' }}
                            {...(isDocExpanded ? { borderBottom: '1px solid', borderColor: 'border.default' } : {})}
                          >
                            <HStack justify="space-between">
                              <HStack gap={2}>
                                <Icon
                                  as={isDocExpanded ? LuChevronDown : LuChevronRight}
                                  boxSize={4}
                                  color="fg.muted"
                                />
                                <Text fontSize="sm" fontWeight="600">
                                  Documentation Entry {index + 1}
                                </Text>
                                {!isDocExpanded && (
                                  <Text fontSize="xs" color="fg.muted" truncate maxW="400px">
                                    {previewLine}
                                  </Text>
                                )}
                              </HStack>
                              <HStack gap={3} onClick={(e) => e.stopPropagation()}>
                                <HStack gap={1.5}>
                                  <Badge size="sm" colorPalette={docEntry.draft ? 'yellow' : 'green'} variant="subtle">
                                    {docEntry.draft ? 'Draft' : 'Active'}
                                  </Badge>
                                  <Switch.Root
                                    size="sm"
                                    checked={!docEntry.draft}
                                    onCheckedChange={() => handleToggleDraft(index)}
                                    colorPalette="green"
                                  >
                                    <Switch.HiddenInput />
                                    <Switch.Control>
                                      <Switch.Thumb />
                                    </Switch.Control>
                                  </Switch.Root>
                                </HStack>
                                <Button
                                  size="xs"
                                  variant="ghost"
                                  colorPalette="red"
                                  onClick={() => handleRemoveDoc(index)}
                                >
                                  <LuTrash2 />
                                </Button>
                              </HStack>
                            </HStack>
                          </Box>
                        </Collapsible.Trigger>
                        <Collapsible.Content>
                          {/* childPaths selector */}
                          <Box px={3} py={2} bg="bg.muted" borderBottom="1px solid" borderColor="border.default">
                            <ChildPathSelector
                              availablePaths={availableChildPaths}
                              selectedPaths={docEntry.childPaths}
                              onChange={(paths) => handleChildPathsChange(index, paths)}
                            />
                          </Box>

                          {/* Toolbar: view mode + image upload */}
                          <HStack px={3} py={1.5} bg="bg.muted" borderBottom="1px solid" borderColor="border.default" gap={1} justify="space-between">
                            <HStack gap={1}>
                              <Button
                                size="xs"
                                variant={docView === 'editor' ? 'solid' : 'ghost'}
                                onClick={() => setDocViewMode(index, docView === 'editor' ? null : 'editor')}
                              >
                                Editor
                              </Button>
                              <Button
                                size="xs"
                                variant={docView === 'preview' ? 'solid' : 'ghost'}
                                onClick={() => setDocViewMode(index, docView === 'preview' ? null : 'preview')}
                              >
                                Preview
                              </Button>
                              {originalDocs?.[index] != null && (
                                <Button
                                  size="xs"
                                  variant={docView === 'diff' ? 'solid' : 'ghost'}
                                  onClick={() => setDocViewMode(index, docView === 'diff' ? null : 'diff')}
                                  disabled={!hasDiff}
                                >
                                  Diff
                                </Button>
                              )}
                            </HStack>
                            <Button
                              aria-label="Upload image"
                              size="xs"
                              variant="ghost"
                              onClick={() => handleImageUploadClick(index)}
                              title="Insert image"
                            >
                              <LuImage />
                              Image
                            </Button>
                          </HStack>

                          {/* Preview-only mode */}
                          {docView === 'preview' && (
                            <Box
                              p={4}
                              minH="500px"
                              maxH="500px"
                              overflowY="auto"
                            >
                              {docEntry.content.trim() ? (
                                <Markdown context="mainpage">{docEntry.content}</Markdown>
                              ) : (
                                <Text color="fg.muted" fontSize="sm">No content to preview.</Text>
                              )}
                            </Box>
                          )}

                          {/* Editor (always mounted, hidden in preview-only mode) + optional side panel */}
                          <HStack gap={0} align="stretch" display={docView === 'preview' ? 'none' : 'flex'}>
                            <Box flex={1} minW={0}>
                              <Editor
                                height="500px"
                                language="markdown"
                                value={docEntry.content}
                                onChange={(value) => handleMarkdownChange(index, value || '')}
                                onMount={(editor) => { docEditorRefs.current[index] = editor; }}
                                theme={colorMode === 'dark' ? 'vs-dark' : 'light'}
                                options={{
                                  minimap: { enabled: false },
                                  wordWrap: 'on',
                                  lineNumbers: 'on',
                                  fontSize: 14,
                                  fontFamily: 'JetBrains Mono, monospace',
                                  scrollBeyondLastLine: false,
                                  automaticLayout: true,
                                  tabSize: 2,
                                }}
                              />
                            </Box>
                            {/* Default (null) mode: editor + preview side by side */}
                            {docView === null && (
                              <Box
                                flex={1}
                                p={3}
                                bg="bg.muted"
                                maxH="500px"
                                overflowY="auto"
                                borderLeft="1px solid"
                                borderColor="border.default"
                                minW={0}
                              >
                                {docEntry.content.trim() ? (
                                  <Markdown context="mainpage">{docEntry.content}</Markdown>
                                ) : (
                                  <Text color="fg.muted" fontSize="sm">Preview will appear here...</Text>
                                )}
                              </Box>
                            )}
                            {/* Diff mode: editor + diff side by side */}
                            {originalDocs?.[index] && (
                              <Box
                                flex={1}
                                borderLeft="1px solid"
                                borderColor="border.default"
                                minW={0}
                                display={docView === 'diff' ? 'block' : 'none'}
                              >
                                <DiffEditor
                                  height="500px"
                                  language="markdown"
                                  original={originalDocs[index].content}
                                  modified={docEntry.content}
                                  theme={colorMode === 'dark' ? 'vs-dark' : 'light'}
                                  keepCurrentOriginalModel
                                  keepCurrentModifiedModel
                                  options={{
                                    minimap: { enabled: false },
                                    wordWrap: 'on',
                                    fontSize: 14,
                                    fontFamily: 'JetBrains Mono, monospace',
                                    scrollBeyondLastLine: false,
                                    automaticLayout: true,
                                    readOnly: true,
                                    renderSideBySide: false,
                                  }}
                                />
                              </Box>
                            )}
                          </HStack>
                        </Collapsible.Content>
                      </Collapsible.Root>
                    </Box>
                    );
                  })}

                  {/* Add doc button */}
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleAddDoc}
                  >
                    <LuPlus />
                    Add Documentation Entry
                  </Button>
                </VStack>
              </Box>
          </VStack>
        </Tabs.Content>

        {/* Evals Tab */}
        <Tabs.Content value="evals">
          {activeTab === 'picker' ? (
            <Box display="flex" flexDirection="row" gap={4} alignItems="stretch" minH="400px">
              {/* Left Panel: Evals list */}
              <Box
                flex={1}
                overflow="auto"
                border="1px solid"
                borderColor="border.muted"
                borderRadius="md"
                p={3}
              >
                <HStack mb={3} justify="space-between">
                  <Text fontSize="xs" fontWeight="700" textTransform="uppercase" letterSpacing="wider" color="fg.muted">Evals</Text>
                </HStack>
                <TestList
                  tests={content.evals || []}
                  onChange={(evals: Test[]) => onChange({ evals })}
                  editMode={editMode}
                  forcedType="llm"
                  alwaysShowAdd
                  addLabel="Add eval"
                />

                <SchedulePicker
                  schedule={{ cron: content.schedule?.cron || '0 9 * * 1', timezone: content.schedule?.timezone || 'America/New_York' }}
                  onChange={(s) => onChange({ schedule: s })}
                  editMode={editMode}
                />

                <DeliveryCard
                  recipients={content.recipients || []}
                  onChange={(recipients) => onChange({ recipients })}
                  disabled={!editMode}
                />
              </Box>

              {/* Right Panel: Run history */}
              <Box
                flex={1}
                overflow="auto"
                border="1px solid"
                borderColor="border.muted"
                borderRadius="md"
                p={3}
              >
                <RunNowHeader
                  title="Run History"
                  runs={runs ?? []}
                  selectedRunId={selectedRunId}
                  onSelectRun={onSelectRun}
                  isRunning={!!isRunning}
                  disabled={!content.evals?.length}
                  onRunNow={(opts) => onRunAll?.(opts)}
                  buttonLabel="Run all"
                />
                {evalsSelectedRun?.output_file_id ? (
                  <ContextRunView fileId={evalsSelectedRun.output_file_id} />
                ) : runs.length === 0 ? (
                  <Text fontSize="sm" color="fg.muted">No runs yet. Click &quot;Run all&quot; to evaluate.</Text>
                ) : (
                  <Text fontSize="sm" color="fg.muted">Run in progress...</Text>
                )}
              </Box>
            </Box>
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
                value={JSON.stringify(content.evals || [], null, 2)}
                onChange={(value) => {
                  try {
                    const parsed = JSON.parse(value || '[]');
                    if (Array.isArray(parsed)) onChange({ evals: parsed });
                  } catch { /* ignore parse errors while typing */ }
                }}
                theme={colorMode === 'dark' ? 'vs-dark' : 'light'}
                options={{
                  minimap: { enabled: false },
                  wordWrap: 'on',
                  lineNumbers: 'on',
                  fontSize: 14,
                  fontFamily: 'JetBrains Mono, monospace',
                  scrollBeyondLastLine: false,
                  automaticLayout: true,
                  tabSize: 2,
                }}
              />
            </Box>
          )}
        </Tabs.Content>
      </Tabs.Root>
    </VStack>
  );
}
