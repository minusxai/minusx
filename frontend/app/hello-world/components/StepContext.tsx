'use client';

import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { Box, VStack, HStack, Text, Heading, Button, Spinner } from '@chakra-ui/react';
import { LuSparkles } from 'react-icons/lu';
import SchemaTreeView, { type WhitelistItem, type SchemaTreeItem } from '@/components/SchemaTreeView';
import { fetchWithCache } from '@/lib/api/fetch-wrapper';
import { pulseKeyframes, sparkleKeyframes } from '@/lib/ui/animations';
import { useConnections } from '@/lib/hooks/useConnections';
import { useFile } from '@/lib/hooks/file-state-hooks';
import { useAppSelector, useAppDispatch } from '@/store/hooks';
import {
  setSidebarPendingMessage,
  setRightSidebarCollapsed,
  setActiveSidebarSection,
} from '@/store/uiSlice';
import Editor from '@monaco-editor/react';
import Markdown from '@/components/Markdown';
import type { ContextContent, DatabaseContext } from '@/lib/types';

const AGENT_DESCRIBE_MESSAGE = 'Write the data documentation for this knowledge base. Look at the schema, describe what the database contains, what the key tables are, and a tl;dr on what kinds of questions can be answered.';

interface StepContextProps {
  connectionName: string;
  connectionId: number;
  onComplete: (contextFileId: number) => void;
  /** Called when the agent chat should open. Parent renders RightSidebar. */
  onRequestChat?: (contextFileId: number) => void;
  /** Called as soon as the context file is created (eagerly on mount). Parent uses this for appState. */
  onContextCreated?: (contextFileId: number) => void;
}

/**
 * Onboarding Step 2: Simplified context setup.
 * - Reads schema from Redux (already loaded by useConnections)
 * - Shows SchemaTreeView with all tables pre-whitelisted
 * - Lets user add a data description (optional)
 * - "Let the agent figure it out" saves context and tells parent to show RightSidebar
 * - Creates a root context file on save
 */
export default function StepContext({ connectionName, connectionId, onComplete, onRequestChat, onContextCreated }: StepContextProps) {
  const { connections, loading: connectionsLoading } = useConnections({ skip: false });
  const colorMode = useAppSelector((state) => state.ui.colorMode);
  const dispatch = useAppDispatch();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [description, setDescription] = useState('');
  const [savedFileId, setSavedFileId] = useState<number | null>(null);

  // Watch the saved context file in Redux for agent edits
  const { fileState: savedContextFile } = useFile(savedFileId ?? undefined) ?? {};

  // Sync description from Redux when agent edits the file
  const lastSyncedContent = useRef<string | null>(null);
  useEffect(() => {
    if (!savedContextFile || savedContextFile.loading) return;
    const content = savedContextFile.content as ContextContent | undefined;
    const merged = { ...content, ...savedContextFile.persistableChanges } as ContextContent;
    // Get the latest version's first doc
    const versions = merged?.versions;
    if (!versions || versions.length === 0) return;
    const latestVersion = versions[versions.length - 1];
    const docContent = latestVersion?.docs?.[0]?.content ?? '';
    // Only sync if it changed externally (not from our own typing)
    if (docContent !== lastSyncedContent.current && docContent !== description) {
      lastSyncedContent.current = docContent;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDescription(docContent);
    }
  }, [savedContextFile]);

  // Debounced markdown change (same pattern as ContextEditorV2)
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const handleEditorChange = useCallback((value: string | undefined) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      const newVal = value || '';
      lastSyncedContent.current = newVal;
      setDescription(newVal);
    }, 300);
  }, []);

  // Get schema from Redux (already fetched by useConnections)
  const schemas: SchemaTreeItem[] = useMemo(() => {
    const conn = connections[connectionName];
    return conn?.schema?.schemas ?? [];
  }, [connections, connectionName]);

  const loading = connectionsLoading;

  // Build initial whitelist: all schemas whitelisted by default
  const defaultWhitelist: WhitelistItem[] = useMemo(() => {
    return schemas.map(s => ({ type: 'schema' as const, name: s.schema }));
  }, [schemas]);

  const [whitelist, setWhitelist] = useState<WhitelistItem[] | null>(null);
  const effectiveWhitelist = whitelist ?? defaultWhitelist;

  const handleWhitelistChange = useCallback((newWhitelist: WhitelistItem[]) => {
    setWhitelist(newWhitelist);
  }, []);

  /** Save context file and return the created file ID (or null on failure) */
  const saveContext = useCallback(async (descriptionText: string): Promise<number | null> => {
    const databases: DatabaseContext[] = [{
      databaseName: connectionName,
      whitelist: effectiveWhitelist,
    }];

    // Always include at least one doc entry so the agent can edit it via EditFile
    const docs = [{ content: descriptionText.trim() || '' }];

    const contextContent: ContextContent = {
      versions: [{
        version: 1,
        databases,
        docs,
        createdAt: new Date().toISOString(),
        createdBy: 0,
        description: 'Initial setup',
      }],
      published: { all: 1 },
    };

    const result = await fetchWithCache('/api/files', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Knowledge Base',
        path: '/org/context',
        type: 'context',
        content: contextContent,
        references: [],
      }),
      cacheStrategy: { ttl: 0, deduplicate: false },
    });

    return result?.data?.id ?? null;
  }, [connectionName, effectiveWhitelist]);

  // Eagerly create context file on mount (once schemas load) so appState is available for the agent.
  // If the file already exists (e.g., page refresh), look it up by path instead.
  const hasEagerCreated = useRef(false);
  useEffect(() => {
    if (hasEagerCreated.current || loading || savedFileId) return;
    hasEagerCreated.current = true;
    (async () => {
      try {
        // First check if context already exists (e.g., from a previous onboarding attempt)
        const existing = await fetchWithCache('/api/files?paths=/org&type=context&depth=-1&includeContent=true', {
          cacheStrategy: { ttl: 0, deduplicate: false },
        });
        const existingFile = existing?.data?.[0];
        if (existingFile) {
          setSavedFileId(existingFile.id);
          onContextCreated?.(existingFile.id);
          return;
        }
        // No existing context — create one (wait for schemas)
        if (schemas.length === 0) {
          hasEagerCreated.current = false; // retry when schemas load
          return;
        }
        const fileId = await saveContext('');
        if (fileId) {
          setSavedFileId(fileId);
          onContextCreated?.(fileId);
        }
      } catch (err) {
        console.error('[StepContext] Eager create failed:', err);
        hasEagerCreated.current = false; // allow retry
      }
    })();
  }, [loading, schemas.length, savedFileId, saveContext, onContextCreated]);

  /** Advance to next step — file is already created eagerly */
  const handleSave = useCallback(() => {
    if (savedFileId) {
      onComplete(savedFileId);
    } else {
      setError('Context file is still being created. Please wait a moment.');
    }
  }, [savedFileId, onComplete]);

  /** Open RightSidebar with agent message — file is already created eagerly */
  const handleAgentDescribe = useCallback(() => {
    if (!savedFileId) {
      setError('Context file is still being created. Please wait a moment.');
      return;
    }
    dispatch(setSidebarPendingMessage(AGENT_DESCRIBE_MESSAGE));
    dispatch(setRightSidebarCollapsed(false));
    dispatch(setActiveSidebarSection('chat'));
    onRequestChat?.(savedFileId);
  }, [savedFileId, dispatch, onRequestChat]);

  const totalTables = useMemo(() => {
    return schemas.reduce((sum, s) => sum + s.tables.length, 0);
  }, [schemas]);

  const whitelistedCount = useMemo(() => {
    let count = 0;
    for (const item of effectiveWhitelist) {
      if (item.type === 'schema') {
        const schema = schemas.find(s => s.schema === item.name);
        count += schema?.tables.length ?? 0;
      } else {
        count += 1;
      }
    }
    return count;
  }, [effectiveWhitelist, schemas]);

  if (loading) {
    return (
      <VStack gap={4} py={10} align="center">
        <style>{pulseKeyframes}</style>
        <style>{sparkleKeyframes}</style>
        <HStack gap={2} color="accent.teal">
          <Box css={{ animation: 'sparkle 2s ease-in-out infinite' }}>
            <LuSparkles size={16} />
          </Box>
          <Text fontFamily="mono" fontSize="sm" color="fg.muted">
            Loading your schema...
          </Text>
          <HStack gap={0.5}>
            <Box w="4px" h="4px" borderRadius="full" bg="accent.teal" css={{ animation: 'pulse 1.4s ease-in-out infinite' }} />
            <Box w="4px" h="4px" borderRadius="full" bg="accent.teal" css={{ animation: 'pulse 1.4s ease-in-out 0.2s infinite' }} />
            <Box w="4px" h="4px" borderRadius="full" bg="accent.teal" css={{ animation: 'pulse 1.4s ease-in-out 0.4s infinite' }} />
          </HStack>
        </HStack>
      </VStack>
    );
  }

  return (
    <VStack gap={6} align="stretch">
      {/* Header */}
      <Box>
        <Heading size="md" fontFamily="mono" fontWeight="500" mb={1}>
          Tell us about your data
        </Heading>
        <Text color="fg.muted" fontSize="sm">
          {totalTables > 0
            ? <>We&apos;ve auto-selected {totalTables === 1 ? '' : 'all '}<Text as="span" color="accent.teal" fontWeight="600">{totalTables} {totalTables === 1 ? 'table' : 'tables'}</Text>. Deselect anything you don&apos;t need.</>
            : 'Add a description of your data to help us generate better queries.'
          }
        </Text>
      </Box>

      {/* Schema browser */}
      {schemas.length > 0 && (
        <Box
          border="1px solid"
          borderColor="border.default"
          borderRadius="lg"
          p={4}
          maxH="300px"
          overflowY="auto"
        >
          <HStack justify="space-between" mb={3}>
            <Text fontSize="xs" fontFamily="mono" color="fg.subtle">
              {whitelistedCount}/{totalTables} tables selected
            </Text>
          </HStack>
          <SchemaTreeView
            schemas={schemas}
            selectable
            whitelist={effectiveWhitelist}
            onWhitelistChange={handleWhitelistChange}
            showColumns={false}
            connectionName={connectionName}
            defaultExpandedSchemas
          />
        </Box>
      )}

      {schemas.length === 0 && (
        <Box p={4} bg="bg.muted" borderRadius="lg">
          <Text color="fg.muted" fontSize="sm">
            No schema found for this connection. You can still add a description below.
          </Text>
        </Box>
      )}

      {/* Data description */}
      <Box>
        <HStack justify="space-between" mb={2}>
          <Text fontSize="sm" fontWeight="500">
            Data description <Text as="span" color="fg.subtle">(optional, markdown)</Text>
          </Text>
          <HStack gap={1}>
            <Button
              variant="ghost"
              size="xs"
              fontFamily="mono"
              color="accent.teal"
              _hover={{ bg: 'bg.muted' }}
              onClick={handleAgentDescribe}
              disabled={saving}
            >
              <LuSparkles size={12} />
              Let the agent figure it out
            </Button>
          </HStack>
        </HStack>
        <Box
          border="1px solid"
          borderColor="border.default"
          borderRadius="lg"
          overflow="hidden"
        >

          {/* Editor + optional preview panel */}
          <HStack gap={0} align="stretch" display={'flex'}>
            <Box flex={1} minW={0}>
              <Editor
                height="250px"
                language="markdown"
                value={description}
                onChange={handleEditorChange}
                theme={colorMode === 'dark' ? 'vs-dark' : 'light'}
                options={{
                  minimap: { enabled: false },
                  wordWrap: 'on',
                  lineNumbers: 'off',
                  fontSize: 13,
                  fontFamily: 'JetBrains Mono, monospace',
                  scrollBeyondLastLine: false,
                  automaticLayout: true,
                  tabSize: 2,
                  placeholder: 'Describe your data here... e.g.,\n\n# My Database\n\nThis contains our e-commerce data: orders, customers, products.',
                }}
              />
            </Box>
            <Box
              flex={1}
              p={3}
              bg="bg.muted"
                maxH="250px"
                overflowY="auto"
                borderLeft="1px solid"
                borderColor="border.default"
                minW={0}
              >
                {description.trim() ? (
                  <Markdown context="mainpage">{description}</Markdown>
                ) : (
                  <Text color="fg.muted" fontSize="sm">Preview will appear here...</Text>
                )}
              </Box>
          </HStack>
        </Box>
      </Box>

      {/* Error */}
      {error && (
        <Text color="accent.danger" fontSize="sm">{error}</Text>
      )}

      {/* Actions */}
      <HStack justify="flex-end" gap={3} pt={2}>
        <Button
          bg="accent.teal"
          color="white"
          _hover={{ opacity: 0.9 }}
          size="sm"
          fontFamily="mono"
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? <Spinner size="xs" mr={2} /> : null}
          Continue
        </Button>
      </HStack>
    </VStack>
  );
}
