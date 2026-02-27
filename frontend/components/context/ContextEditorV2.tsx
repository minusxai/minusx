'use client';

/**
 * ContextEditorV2 - With Version Management
 * Pure controlled component with version management UI for admins
 * All changes go through onChange immediately
 */

import { Box, VStack, Heading, HStack, Button, Text, SimpleGrid, Badge, Menu, Input, Dialog, Field, Portal, Collapsible, Icon } from '@chakra-ui/react';
import { useState, useEffect, useMemo, useRef } from 'react';
import { LuCircleAlert, LuCircleCheck, LuPlus, LuTrash2, LuChevronDown, LuGlobe, LuChevronRight } from 'react-icons/lu';
import { ContextContent, DatabaseContext, WhitelistItem, ContextVersion, PublishedVersions, DocEntry } from '@/lib/types';
import { serializeDatabases, parseDatabasesYaml, canDeleteVersion } from '@/lib/context/context-utils';
import SchemaTreeView from '../SchemaTreeView';
import ChildPathSelector from '../ChildPathSelector';
import Editor from '@monaco-editor/react';
import Markdown from '../Markdown';
import DocumentHeader from '../DocumentHeader';
import { useAppSelector } from '@/store/hooks';
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
  isAdmin = false,
  userId,
  currentVersion = 1,
  allVersions = [],
  publishedStatus = { all: 1 },
  onSwitchVersion,
  onCreateVersion,
  onPublishVersion,
  onDeleteVersion,
  onUpdateDescription
}: ContextEditorV2Props) {
  const [activeTab, setActiveTab] = useState<'picker' | 'yaml'>('picker');
  const [yamlText, setYamlText] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const colorMode = useAppSelector((state) => state.ui.colorMode);
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

  // Get connections loading state from Redux (for loading indicator)
  const isLoading = useAppSelector(state =>
    Object.values(state.files.files).some(f => f.type === 'connection' && f.loading)
  );

  // Use fullSchema from content (what parent makes available)
  // This ensures hierarchical filtering - children can only whitelist from parent's whitelist
  // Filter out databases with no schemas (not exposed from parent)
  const availableDatabases = (content.fullSchema || []).filter(db => db.schemas.length > 0);

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
      .map(f => f.path);

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

  // Initialize databases array if empty when availableDatabases loads
  useEffect(() => {
    if (content.databases && content.databases.length === 0 && availableDatabases.length > 0) {
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

  // Handle docs changes - pure controlled
  const handleMarkdownChange = (index: number, newMarkdown: string) => {
    const currentDocs = content.docs || [];
    const newDocs = [...currentDocs];
    newDocs[index] = {
      ...newDocs[index],
      content: newMarkdown
    };
    onChange({ docs: newDocs });
  };

  const handleAddDoc = () => {
    const currentDocs = content.docs || [];
    onChange({ docs: [...currentDocs, { content: '' }] });
  };

  const handleRemoveDoc = (index: number) => {
    const currentDocs = content.docs || [];
    onChange({ docs: currentDocs.filter((_, i) => i !== index) });
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
    const databases = content.databases || [];
    const dbIndex = databases.findIndex(db => db.databaseName === databaseName);

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

  // Count total whitelisted items
  const totalWhitelisted = content.databases?.reduce((sum, db) => sum + db.whitelist.length, 0) || 0;

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

  return (
    <VStack gap={6} align="stretch" p={3}>
      {/* Document Header */}
      <Box borderBottomWidth="1px" borderColor="border.muted" pb={2} position="sticky" top={0} zIndex={10} bg="bg.canvas" mx={-3} px={3}>
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

      {/* Version Management (Admin Only) */}
      {isAdmin && allVersions.length > 0 && (
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

      {/* Content Area */}
      {activeTab === 'picker' ? (
        <VStack gap={6} align="stretch">
          {/* Database Sections */}
          <Box>
            <HStack gap={2} mb={0}>
              <Heading size="md">
                Database Connections
              </Heading>
            </HStack>
            <Text fontSize="sm" color="fg.muted" mb={3}>
              Whitelist schemas and tables from the available database connections
            </Text>
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
                    No schemas or tables whitelisted. Select at least one schema or table below to make data available for this context.
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
                  const databases = content.databases || [];
                  const dbContext = databases.find(db => db.databaseName === database.databaseName);
                  const whitelist = dbContext?.whitelist || [];

                  const isExpanded = expandedDatabases.has(database.databaseName);
                  const whitelistedSchemas = whitelist.filter(w => w.type === 'schema');
                  const whitelistedTables = whitelist.filter(w => w.type === 'table');
                  const totalTables = database.schemas.reduce((sum, s) => sum + s.tables.length, 0);
                  // Tables covered by schema-level whitelists + individually whitelisted tables
                  const tablesFromSchemas = database.schemas
                    .filter(s => whitelistedSchemas.some(ws => ws.name === s.schema))
                    .reduce((sum, s) => sum + s.tables.length, 0);
                  const effectiveTableCount = tablesFromSchemas + whitelistedTables.length;
                  const hasAny = effectiveTableCount > 0;

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

          {/* Markdown Documentation */}
          <Box>
            <HStack gap={2} mb={0}>
              <Heading size="md">
                Documentation (Markdown)
              </Heading>
              {(!content.docs || content.docs.length === 0) && (
                <HStack gap={1} color="accent.warning">
                  <LuCircleAlert size={16} />
                  <Text fontSize="sm" fontWeight="500">No documentation added</Text>
                </HStack>
              )}
            </HStack>
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
              {(content.docs || []).map((docEntry, index) => (
                <Box
                  key={index}
                  border="1px solid"
                  borderColor="border.default"
                  borderRadius="md"
                  overflow="hidden"
                >
                  {/* Header with remove button */}
                  <HStack
                    justify="space-between"
                    px={3}
                    py={2}
                    bg="bg.muted"
                    borderBottom="1px solid"
                    borderColor="border.default"
                  >
                    <Text fontSize="sm" fontWeight="600">
                      Documentation Entry {index + 1}
                    </Text>
                    <Button
                      size="xs"
                      variant="ghost"
                      colorPalette="red"
                      onClick={() => handleRemoveDoc(index)}
                    >
                      <LuTrash2 />
                    </Button>
                  </HStack>

                  {/* childPaths selector */}
                  <Box px={3} py={2} bg="bg.muted" borderBottom="1px solid" borderColor="border.default">
                    <ChildPathSelector
                      availablePaths={availableChildPaths}
                      selectedPaths={docEntry.childPaths}
                      onChange={(paths) => handleChildPathsChange(index, paths)}
                    />
                  </Box>

                  {/* Editor and preview */}
                  <SimpleGrid columns={{ base: 1, lg: 2 }} gap={0}>
                    <Box minH="300px">
                      <Editor
                        height="300px"
                        language="markdown"
                        value={docEntry.content}
                        onChange={(value) => handleMarkdownChange(index, value || '')}
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
                    <Box
                      p={3}
                      bg="bg.muted"
                      minH="300px"
                      maxH="300px"
                      overflowY="auto"
                      borderLeft="1px solid"
                      borderColor="border.default"
                    >
                      {docEntry.content.trim() ? (
                        <Markdown context="mainpage">{docEntry.content}</Markdown>
                      ) : (
                        <Text color="fg.muted" fontSize="sm">
                          Preview will appear here...
                        </Text>
                      )}
                    </Box>
                  </SimpleGrid>
                </Box>
              ))}

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
    </VStack>
  );
}
