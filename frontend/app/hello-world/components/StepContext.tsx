'use client';

import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { Box, VStack, HStack, Text, Heading, Button, Spinner, Collapsible, Icon } from '@chakra-ui/react';
import { LuSparkles, LuChevronDown, LuChevronRight } from 'react-icons/lu';
import SchemaTreeView, { type WhitelistItem, type SchemaTreeItem } from '@/components/SchemaTreeView';
import { pulseKeyframes, sparkleKeyframes, cursorBlinkKeyframes } from '@/lib/ui/animations';
import { useConnections } from '@/lib/hooks/useConnections';
import { useFile } from '@/lib/hooks/file-state-hooks';
import { createVirtualFile, editFile, publishFile } from '@/lib/api/file-state';
import { useAppSelector, useAppDispatch } from '@/store/hooks';
import { createConversation, selectActiveConversation, selectConversation, interruptChat, generateVirtualConversationId } from '@/store/chatSlice';
import { selectAugmentedFiles, compressAugmentedFile } from '@/lib/api/file-state';
import Editor from '@monaco-editor/react';
import Markdown from '@/components/Markdown';
import ChatInterface from '@/components/explore/ChatInterface';
import { useFilesByCriteria } from '@/lib/hooks/file-state-hooks';
import type { ContextContent, DatabaseContext } from '@/lib/types';

const TYPEWRITER_SPEED = 35;

const AGENT_DESCRIBE_MESSAGE = 'Write the data documentation for this database.';

interface StepContextProps {
  connectionName: string;
  connectionId: number;
  onComplete: (contextFileId: number) => void;
  onRequestChat?: (contextFileId: number) => void;
  onContextCreated?: (contextFileId: number) => void;
  greeting?: string;
}

/** Collapsible agent trace with toggle text and status indicator */
function AgentFeedCollapsible({ connectionName, isRunning }: { connectionName: string; isRunning: boolean }) {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <Collapsible.Root open={isOpen} onOpenChange={(e) => setIsOpen(e.open)}>
      <Collapsible.Trigger asChild>
        <HStack
          cursor="pointer"
          px={3}
          py={2}
          bg="bg.muted"
          borderRadius="lg"
          _hover={{ bg: 'bg.emphasis' }}
          gap={2}
          justify={"space-between"}
        >
          <HStack>
          <Icon as={LuSparkles} boxSize={3.5} color="accent.teal" />
          <Text fontSize="sm" fontFamily="mono" fontWeight="500" color="accent.teal">
            {isOpen ? 'Hide MinusX agent trace' : 'See MinusX agent in action'}
          </Text>
          </HStack>
          <HStack>
          {isRunning && (
            <Text fontSize="xs" fontFamily="mono" color="fg.subtle" flex={1}>
              Exploring tables & writing first draft (~30s)
            </Text>
          )}
          {!isRunning && (
            <Text fontSize="xs" fontFamily="mono" color="accent.teal" flex={1}>
              Done!
            </Text>
          )}
          {!isRunning && !isOpen && <Box flex={1} />}
          <Icon
            as={isOpen ? LuChevronDown : LuChevronRight}
            boxSize={4}
            color="fg.subtle"
          />
          </HStack>
        </HStack>
      </Collapsible.Trigger>
      <Collapsible.Content>
        <Box
          border="1px solid"
          borderColor="border.default"
          borderRadius="lg"
          overflow="hidden"
          h="350px"
          mt={2}
        >
          <ChatInterface
            contextPath="/org/context"
            databaseName={connectionName}
            container="sidebar"
            readOnly
          />
        </Box>
      </Collapsible.Content>
    </Collapsible.Root>
  );
}

export default function StepContext({ connectionName, connectionId, onComplete, onRequestChat, onContextCreated, greeting }: StepContextProps) {
  const { connections, loading: connectionsLoading } = useConnections({ skip: false });
  const colorMode = useAppSelector((state) => state.ui.colorMode);
  const showDebug = useAppSelector((state) => state.ui.showDebug);
  const dispatch = useAppDispatch();

  // Check if a context file already exists (persisted, id > 0)
  const contextCriteria = useMemo(() => ({ type: 'context' as const }), []);
  const { files: existingContextFiles } = useFilesByCriteria({ criteria: contextCriteria, partial: true });
  const existingContext = existingContextFiles.find(f => (f.id as number) > 0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [description, setDescription] = useState('');
  // Virtual file ID (negative) — only persisted on "Continue"
  const [virtualFileId, setVirtualFileId] = useState<number | null>(null);
  const [showAgentFeed, setShowAgentFeed] = useState(false);

  // Typewriter effect for greeting
  const [displayedText, setDisplayedText] = useState('');
  const [typingDone, setTypingDone] = useState(!greeting);

  useEffect(() => {
    if (!greeting) return;
    let i = 0;
    setDisplayedText('');
    setTypingDone(false);
    const interval = setInterval(() => {
      i++;
      setDisplayedText(greeting.slice(0, i));
      if (i >= greeting.length) {
        clearInterval(interval);
        setTypingDone(true);
      }
    }, TYPEWRITER_SPEED);
    return () => clearInterval(interval);
  }, [greeting]);

  // Track if agent is still running
  const activeConvId = useAppSelector(selectActiveConversation);
  const conversation = useAppSelector(state =>
    activeConvId ? selectConversation(state, activeConvId) : undefined
  );
  const isAgentRunning = showAgentFeed && conversation?.executionState !== 'FINISHED';

  // Watch the virtual file in Redux for agent edits
  const { fileState: contextFile } = useFile(virtualFileId ?? undefined) ?? {};

  // Sync description from Redux when agent edits the file
  const lastSyncedContent = useRef<string | null>(null);
  useEffect(() => {
    if (!contextFile || contextFile.loading) return;
    const content = contextFile.content as ContextContent | undefined;
    const merged = { ...content, ...contextFile.persistableChanges } as ContextContent;
    const versions = merged?.versions;
    if (!versions || versions.length === 0) return;
    const latestVersion = versions[versions.length - 1];
    const docContent = latestVersion?.docs?.[0]?.content ?? '';
    if (docContent !== lastSyncedContent.current && docContent !== description) {
      lastSyncedContent.current = docContent;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDescription(docContent);
    }
  }, [contextFile]);

  // Debounced markdown change — also pushes to Redux virtual file
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const handleEditorChange = useCallback((value: string | undefined) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      const newVal = value || '';
      lastSyncedContent.current = newVal;
      setDescription(newVal);
    }, 300);
  }, []);

  // Get schema from Redux
  const schemas: SchemaTreeItem[] = useMemo(() => {
    const conn = connections[connectionName];
    return conn?.schema?.schemas ?? [];
  }, [connections, connectionName]);

  const loading = connectionsLoading;

  const defaultWhitelist: WhitelistItem[] = useMemo(() => {
    return schemas.map(s => ({ type: 'schema' as const, name: s.schema }));
  }, [schemas]);

  const [whitelist, setWhitelist] = useState<WhitelistItem[] | null>(null);
  const effectiveWhitelist = whitelist ?? defaultWhitelist;

  const handleWhitelistChange = useCallback((newWhitelist: WhitelistItem[]) => {
    setWhitelist(newWhitelist);
  }, []);

  // Create virtual context file on mount (Redux-only, not persisted to DB)
  const hasCreatedVirtual = useRef(false);
  useEffect(() => {
    if (hasCreatedVirtual.current || loading || virtualFileId) return;
    hasCreatedVirtual.current = true;

    createVirtualFile('context').then((vId) => {
      // Set initial content with whitelisted tables + empty doc
      const databases: DatabaseContext[] = [{
        databaseName: connectionName,
        whitelist: schemas.map(s => ({ type: 'schema' as const, name: s.schema })),
      }];
      const contextContent: ContextContent = {
        versions: [{
          version: 1,
          databases,
          docs: [{ content: '' }],
          createdAt: new Date().toISOString(),
          createdBy: 0,
          description: 'Initial setup',
        }],
        published: { all: 1 },
      };
      editFile({ fileId: vId, changes: { content: contextContent } });
      setVirtualFileId(vId);
      onContextCreated?.(vId);
    }).catch((err) => {
      console.error('[StepContext] Virtual file creation failed:', err);
      hasCreatedVirtual.current = false;
    });
  }, [loading, virtualFileId, connectionName, schemas, onContextCreated]);

  /** Save (publish) the virtual file to DB and advance to next step.
   *  If a context file already exists, skip publishing and use the existing one. */
  const handleSave = useCallback(async () => {
    // If a context already exists in the DB, just use it
    if (existingContext) {
      onComplete(existingContext.id as number);
      return;
    }
    if (!virtualFileId) {
      setError('Context file is still being created. Please wait a moment.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      // Update content with latest description before publishing
      const databases: DatabaseContext[] = [{
        databaseName: connectionName,
        whitelist: effectiveWhitelist,
      }];
      const contextContent: ContextContent = {
        versions: [{
          version: 1,
          databases,
          docs: [{ content: description.trim() || '' }],
          createdAt: new Date().toISOString(),
          createdBy: 0,
          description: 'Initial setup',
        }],
        published: { all: 1 },
      };
      editFile({
        fileId: virtualFileId,
        changes: {
          content: contextContent,
          name: 'Knowledge Base',
          path: '/org/context',
        },
      });
      // Publish persists to DB and returns the real file ID
      const result = await publishFile({ fileId: virtualFileId });
      onComplete(result.id);
    } catch (err) {
      console.error('[StepContext] Save error:', err);
      setError('Failed to save context. Please try again.');
    } finally {
      setSaving(false);
    }
  }, [virtualFileId, connectionName, effectiveWhitelist, description, onComplete, existingContext]);

  /** Show inline agent activity feed and kick off the agent */
  const reduxState = useAppSelector(state => state);
  const handleAgentDescribe = useCallback(() => {
    if (!virtualFileId) {
      setError('Context file is still being created. Please wait a moment.');
      return;
    }
    onRequestChat?.(virtualFileId);

    // Build appState so the agent knows it's on a context file page
    let appState = null;
    const [augmented] = selectAugmentedFiles(reduxState, [virtualFileId]);
    if (augmented) {
      appState = { type: 'file' as const, state: compressAugmentedFile(augmented) };
    }

    // Build simplified schema from connections (same as ChatInterface)
    const conn = connections[connectionName];
    const simplifiedSchema = conn?.schema?.schemas?.map(s => ({
      schema: s.schema,
      tables: s.tables.map(t => t.table)
    })) || [];

    // Create a conversation and send the message directly (no sidebar needed)
    dispatch(createConversation({
      conversationID: generateVirtualConversationId(),
      agent: 'OnboardingContextAgent',
      agent_args: {
        connection_id: connectionName,
        context_path: '/org/context',
        context_version: null,
        schema: simplifiedSchema,
        context: description || '',
        app_state: appState,
      },
      message: AGENT_DESCRIBE_MESSAGE,
    }));
    setShowAgentFeed(true);
  }, [virtualFileId, dispatch, onRequestChat, connectionName, reduxState, connections, description]);

  /** Skip: interrupt agent if running, save context without docs, advance */
  const handleSkip = useCallback(async () => {
    // Interrupt agent if running
    if (activeConvId) {
      dispatch(interruptChat({ conversationID: activeConvId }));
    }
    // Save as-is (handleSave already uses current description which may be empty)
    await handleSave();
  }, [activeConvId, dispatch, handleSave]);

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
      {greeting && <style>{cursorBlinkKeyframes}</style>}

      {/* Header */}
      <Box>
        {greeting ? (
          <Heading
            fontSize="2xl"
            fontFamily="mono"
            fontWeight="400"
            mb={1}
            letterSpacing="-0.02em"
          >
            {displayedText}
            {!typingDone && (
              <Box
                as="span"
                display="inline-block"
                w="2px"
                h="1em"
                bg="accent.teal"
                ml="2px"
                verticalAlign="text-bottom"
                css={{ animation: 'cursorBlink 0.8s step-end infinite' }}
              />
            )}
          </Heading>
        ) : (
          <Heading size="md" fontFamily="mono" fontWeight="500" mb={1}>
            Tell us about your data
          </Heading>
        )}
        <Text color="fg.muted" fontSize="sm">
          {totalTables > 0
            ? <>We&apos;ve auto-selected {totalTables === 1 ? '' : 'all '}<Text as="span" color="accent.teal" fontWeight="600">{totalTables} {totalTables === 1 ? 'table' : 'tables'}</Text>. Deselect anything you don&apos;t need.</>
            : 'Add a description of your data to help us generate better queries.'
          }
        </Text>
      </Box>

      {/* Tables — collapsible */}
      {schemas.length > 0 && (
        <Collapsible.Root defaultOpen>
          <Collapsible.Trigger asChild>
            <HStack
              cursor="pointer"
              px={4}
              py={3}
              border="1px solid"
              borderColor="border.default"
              borderRadius="lg"
              _hover={{ bg: 'bg.muted' }}
              justify="space-between"
            >
              <HStack gap={2}>
                <Text fontSize="sm" fontWeight="600">Tables</Text>
                <Text fontSize="xs" fontFamily="mono" color="fg.subtle">
                  {whitelistedCount}/{totalTables} selected
                </Text>
              </HStack>
              <Icon
                as={LuChevronDown}
                boxSize={4}
                color="fg.subtle"
                css={{
                  '[data-state=closed] &': { transform: 'rotate(-90deg)' },
                  transition: 'transform 0.15s',
                }}
              />
            </HStack>
          </Collapsible.Trigger>
          <Collapsible.Content>
            <Box
              border="1px solid"
              borderColor="border.default"
              borderTop="0"
              borderRadius="0 0 lg lg"
              p={4}
              maxH="300px"
              overflowY="auto"
              mt="-1px"
            >
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
          </Collapsible.Content>
        </Collapsible.Root>
      )}

      {schemas.length === 0 && (
        <Box p={4} bg="bg.muted" borderRadius="lg">
          <Text color="fg.muted" fontSize="sm">
            No schema found for this connection. You can still add a description below.
          </Text>
        </Box>
      )}

      {/* Data context — collapsible */}
      <Collapsible.Root defaultOpen>
        <Collapsible.Trigger asChild>
          <HStack
            cursor="pointer"
            px={4}
            py={3}
            border="1px solid"
            borderColor="border.default"
            borderRadius="lg"
            _hover={{ bg: 'bg.muted' }}
            justify="space-between"
          >
            <HStack gap={2}>
              <Text fontSize="sm" fontWeight="600">Data Context</Text>
              <Text as="span" fontSize="xs" color="fg.subtle">(optional, markdown)</Text>
            </HStack>
            <Icon
              as={LuChevronDown}
              boxSize={4}
              color="fg.subtle"
              css={{
                '[data-state=closed] &': { transform: 'rotate(-90deg)' },
                transition: 'transform 0.15s',
              }}
            />
          </HStack>
        </Collapsible.Trigger>
        <Collapsible.Content>
          <Box
            border="1px solid"
            borderColor="border.default"
            borderTop="0"
            borderRadius="0 0 lg lg"
            overflow="hidden"
            mt="-1px"
          >
            <HStack gap={0} align="stretch" display="flex">
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
        </Collapsible.Content>
      </Collapsible.Root>

      {/* Agent activity feed — always rendered when active, not auto-expanded */}
      {showAgentFeed && (
        <AgentFeedCollapsible connectionName={connectionName} isRunning={isAgentRunning} />
      )}

      {/* Debug: appState */}
      {showDebug && virtualFileId && (
        <Collapsible.Root>
          <Collapsible.Trigger asChild>
            <HStack cursor="pointer" px={3} py={1.5} bg="bg.muted" borderRadius="md" gap={2}>
              <Text fontSize="xs" fontFamily="mono" color="fg.subtle">Debug: App State</Text>
              <Icon as={LuChevronRight} boxSize={3} color="fg.subtle" css={{ '[data-state=open] &': { transform: 'rotate(90deg)' }, transition: 'transform 0.15s' }} />
            </HStack>
          </Collapsible.Trigger>
          <Collapsible.Content>
            <Box mt={1} p={3} bg="bg.muted" borderRadius="md" maxH="200px" overflowY="auto">
              <Text fontSize="xs" fontFamily="mono" whiteSpace="pre-wrap">
                {JSON.stringify(
                  (() => {
                    const [aug] = selectAugmentedFiles(reduxState, [virtualFileId]);
                    return aug ? { type: 'file', state: compressAugmentedFile(aug) } : null;
                  })(),
                  null, 2
                )}
              </Text>
            </Box>
          </Collapsible.Content>
        </Collapsible.Root>
      )}

      {/* Error */}
      {error && (
        <Text color="accent.danger" fontSize="sm">{error}</Text>
      )}

      {/* Running indicator + skip escape hatch */}
      {isAgentRunning && (
        <HStack justify="space-between" align="center" pt={2}>
          <HStack gap={1}>
            <Box w="5px" h="5px" borderRadius="full" bg="accent.teal" css={{ animation: 'pulse 1.4s ease-in-out infinite' }} />
            <Box w="5px" h="5px" borderRadius="full" bg="accent.teal" css={{ animation: 'pulse 1.4s ease-in-out 0.2s infinite' }} />
            <Box w="5px" h="5px" borderRadius="full" bg="accent.teal" css={{ animation: 'pulse 1.4s ease-in-out 0.4s infinite' }} />
          </HStack>
          <Text
            as="button"
            fontSize="xs"
            color="fg.subtle"
            fontFamily="mono"
            cursor="pointer"
            _hover={{ color: 'fg.muted', textDecoration: 'underline' }}
            onClick={handleSkip}
          >
            Skip & figure out later
          </Text>
        </HStack>
      )}

      {/* Actions — hidden while agent is running */}
      {!isAgentRunning && (
        <HStack justify="flex-end" gap={3} pt={2}>
          {!showAgentFeed && (
            <Button
              bg="accent.teal"
              color="white"
              _hover={{ opacity: 0.9 }}
              size="sm"
              fontFamily="mono"
              onClick={handleAgentDescribe}
              disabled={saving}
            >
              <LuSparkles size={14} />
              Let the agent figure it out
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            fontFamily="mono"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? <Spinner size="xs" mr={2} /> : null}
            {showAgentFeed ? 'Save & Continue' : 'Skip & Continue'}
          </Button>
        </HStack>
      )}
    </VStack>
  );
}
