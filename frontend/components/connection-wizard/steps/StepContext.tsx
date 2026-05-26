'use client';

import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { Box, VStack, HStack, Text, Heading, Button, Spinner, Collapsible, Icon, Progress } from '@chakra-ui/react';
import { LuSparkles, LuChevronDown, LuChevronRight } from 'react-icons/lu';
import SchemaTreeView, { type WhitelistItem, type SchemaTreeItem } from '@/components/SchemaTreeView';
import { pulseKeyframes, sparkleKeyframes, cursorBlinkKeyframes } from '@/lib/ui/animations';
import type { ConnectionWithSchema } from '@/store/filesSlice';
import { useFile } from '@/lib/hooks/file-state-hooks';
import { useContext as useContextHook } from '@/lib/hooks/useContext';
import { editFile, publishFile } from '@/lib/api/file-state';
import { logInitFailure } from '@/lib/api/report-client-error';
import { getStore } from '@/store/store';
import { useAppSelector, useAppDispatch } from '@/store/hooks';
import { createConversation, selectActiveConversation, selectConversation, interruptChat } from '@/store/chatSlice';
import { selectAugmentedFiles } from '@/lib/store/file-selectors';
import { compressAugmentedFile } from '@/lib/api/compress-augmented';
import { resolvePath } from '@/lib/mode/path-resolver';
import Editor from '@monaco-editor/react';
import Markdown from '@/components/Markdown';
import ChatInterface from '@/components/explore/ChatInterface';
import type { ContextContent, Whitelist, WhitelistNode } from '@/lib/types';
import { useAgentProgress, getProgressMessage } from '../useAgentProgress';
import type { QuestionnaireAnswers } from '../ConnectionWizardTypes';

const TYPEWRITER_SPEED = 35;

const AGENT_DESCRIBE_MESSAGE = 'Write the data documentation for this database.';

type ContextSubStep = 'tables' | 'docs';

interface StepContextProps {
  connectionName: string;
  connectionId: number;
  onComplete: (contextFileId: number) => void;
  onRequestChat?: (contextFileId: number) => void;
  onContextCreated?: (contextFileId: number) => void;
  greeting?: string;
  /** For static connections: schema names just uploaded. Auto-selects only these and skips to docs. */
  staticSchemas?: string[] | null;
  /** Answers from the questionnaire step — used to enrich agent messages and auto-trigger agent. */
  questionnaireAnswers?: QuestionnaireAnswers | null;
  /** Connections map from parent (lifted useConnections). */
  connections?: Record<string, ConnectionWithSchema>;
  /** Whether connections are still loading. */
  connectionsLoading?: boolean;
}

/** Collapsible agent trace — auto-opens when first rendered */
function AgentFeedCollapsible({ connectionName, contextPath, isRunning }: { connectionName: string; contextPath: string; isRunning: boolean }) {
  const [isOpen, setIsOpen] = useState(true);
  const wasRunningRef = useRef(isRunning);
  useEffect(() => {
    // Auto-close when agent transitions from running → done
    if (wasRunningRef.current && !isRunning) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setIsOpen(false);
    }
    wasRunningRef.current = isRunning;
  }, [isRunning]);
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
            contextPath={contextPath}
            databaseName={connectionName}
            container="sidebar"
            readOnly
          />
        </Box>
      </Collapsible.Content>
    </Collapsible.Root>
  );
}

const SAVE_TAU = 9; // ~80% at 15s

function SaveProgressBar() {
  const progress = useAgentProgress(true, false, SAVE_TAU);
  return (
    <VStack gap={2} align="stretch" pt={2}>
      <style>{`@keyframes saveShimmer { 0% { transform: translateX(-100%); } 100% { transform: translateX(100%); } }`}</style>
      <Text fontSize="xs" fontFamily="mono" color="accent.teal">
        {getProgressMessage(progress, [
          [0, 'Saving context...'],
          [30, 'Building knowledge base...'],
          [60, 'Syncing schema metadata...'],
          [80, 'Almost there...'],
        ])}
      </Text>
      <Progress.Root size="sm" value={progress} colorPalette="teal">
        <Progress.Track borderRadius="full" overflow="hidden">
          <Progress.Range
            style={{ transition: 'width 0.4s ease-out' }}
            css={{
              position: 'relative',
              '&::after': {
                content: '""',
                position: 'absolute',
                inset: 0,
                background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.3), transparent)',
                animation: 'saveShimmer 1.5s ease-in-out infinite',
              },
            }}
          />
        </Progress.Track>
      </Progress.Root>
    </VStack>
  );
}

export default function StepContext({
  connectionName, connectionId, onComplete, onRequestChat, onContextCreated, greeting, staticSchemas,
  questionnaireAnswers, connections: connectionsProp, connectionsLoading: connectionsLoadingProp,
}: StepContextProps) {
  const connections = connectionsProp ?? {};
  const connectionsLoading = connectionsLoadingProp ?? false;
  const colorMode = useAppSelector((state) => state.ui.colorMode);
  const showDebug = useAppSelector((state) => state.ui.devMode);
  const dispatch = useAppDispatch();
  const user = useAppSelector(state => state.auth.user);
  const userMode = user?.mode ?? 'org';
  const homeFolder = user?.home_folder ?? '';
  const homePath = resolvePath(userMode, homeFolder || '/');

  // Resolve context file via the same pattern as ConnectionFormV2
  const { contextId: realFileId, contextLoading } = useContextHook(homePath, undefined, true);
  const contextPath = `${homePath}/context`;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAgentFeed, setShowAgentFeed] = useState(false);
  const [subStep, setSubStep] = useState<ContextSubStep>('tables');
  const hasAppendedDoc = useRef(false);

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
  const isAgentDone = showAgentFeed && conversation?.executionState === 'FINISHED';
  const agentProgress = useAgentProgress(isAgentRunning, isAgentDone);

  // Watch the real context file in Redux for agent edits
  const { fileState: contextFile } = useFile(realFileId) ?? {};

  // Get the effective content (base + persistable changes merged)
  const effectiveContent = useMemo(() => {
    if (!contextFile) return undefined;
    return { ...contextFile.content, ...contextFile.persistableChanges } as ContextContent;
  }, [contextFile]);

  // Extract existing docs (all docs except the last one which is our new empty doc)
  const existingDocs = useMemo(() => {
    if (!effectiveContent?.versions?.length) return [];
    const latestVersion = effectiveContent.versions[effectiveContent.versions.length - 1];
    const docs = latestVersion?.docs ?? [];
    // If we've appended a new doc, existing = all but the last
    if (hasAppendedDoc.current && docs.length > 1) {
      return docs.slice(0, -1).filter(d => d.content.trim());
    }
    // Before append, all existing docs
    return docs.filter(d => d.content.trim());
  }, [effectiveContent]);

  // The new doc content — last doc in the array after we've appended
  const newDocContent = useMemo(() => {
    if (!hasAppendedDoc.current || !effectiveContent?.versions?.length) return '';
    const latestVersion = effectiveContent.versions[effectiveContent.versions.length - 1];
    const docs = latestVersion?.docs ?? [];
    return docs[docs.length - 1]?.content ?? '';
  }, [effectiveContent]);

  // Append a new empty doc when entering the docs sub-step
  useEffect(() => {
    if (subStep !== 'docs' || !realFileId || !contextFile || contextFile.loading || hasAppendedDoc.current) return;
    hasAppendedDoc.current = true;
    const content = { ...contextFile.content, ...contextFile.persistableChanges } as ContextContent;
    const versions = content?.versions;
    if (!versions?.length) return;
    const latestVersion = versions[versions.length - 1];
    const updatedVersions = versions.map((v, i) => {
      if (i !== versions.length - 1) return v;
      return { ...v, docs: [...(latestVersion.docs || []), { content: '' }] };
    });
    editFile({ fileId: realFileId, changes: { content: { ...content, versions: updatedVersions } } });
  }, [subStep, realFileId, contextFile]);

  // Debounced editor change — writes to the last doc in the version via editFile
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const handleEditorChange = useCallback((value: string | undefined) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      if (!realFileId || !contextFile) return;
      const content = { ...contextFile.content, ...contextFile.persistableChanges } as ContextContent;
      const versions = content?.versions;
      if (!versions?.length) return;
      const updatedVersions = versions.map((v, i) => {
        if (i !== versions.length - 1) return v;
        const docs = [...(v.docs || [])];
        docs[docs.length - 1] = { ...docs[docs.length - 1], content: value || '' };
        return { ...v, docs };
      });
      editFile({ fileId: realFileId, changes: { content: { ...content, versions: updatedVersions } } });
    }, 300);
  }, [realFileId, contextFile]);

  // Get schema from Redux — filter to uploaded schemas for static connections
  const schemas: SchemaTreeItem[] = useMemo(() => {
    const conn = connections[connectionName];
    const allSchemas = conn?.schema?.schemas ?? [];
    if (staticSchemas?.length) {
      return allSchemas.filter(s => staticSchemas.includes(s.schema));
    }
    return allSchemas;
  }, [connections, connectionName, staticSchemas]);

  const loading = connectionsLoading || contextLoading;

  const defaultWhitelist: WhitelistItem[] = useMemo(() => {
    return schemas.map(s => ({ type: 'schema' as const, name: s.schema }));
  }, [schemas]);

  const [whitelist, setWhitelist] = useState<WhitelistItem[] | null>(null);
  const effectiveWhitelist = whitelist ?? defaultWhitelist;

  const handleWhitelistChange = useCallback((newWhitelist: WhitelistItem[]) => {
    setWhitelist(newWhitelist);
  }, []);

  // Fire onContextCreated once the real context file is loaded
  const hasNotifiedRef = useRef(false);
  useEffect(() => {
    if (hasNotifiedRef.current || !realFileId) return;
    hasNotifiedRef.current = true;
    onContextCreated?.(realFileId);
  }, [realFileId, onContextCreated]);

  /** Save the context file (already exists in DB) and advance to next step. */
  const handleSave = useCallback(async () => {
    if (!realFileId) {
      setError('Context file is still loading. Please wait a moment.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      // Convert WhitelistItem[] to WhitelistNode[] grouped by schema
      const schemaItems = effectiveWhitelist.filter(w => w.type === 'schema');
      const tableItems = effectiveWhitelist.filter(w => w.type === 'table');
      const tablesBySchema = new Map<string, typeof tableItems>();
      tableItems.forEach(item => {
        const s = item.schema || '';
        if (!tablesBySchema.has(s)) tablesBySchema.set(s, []);
        tablesBySchema.get(s)!.push(item);
      });
      const schemaChildren: WhitelistNode[] = [
        ...schemaItems.map(s => ({ name: s.name, type: 'schema' as const } as WhitelistNode)),
        ...Array.from(tablesBySchema.entries()).map(([schemaName, tables]) => ({
          name: schemaName,
          type: 'schema' as const,
          children: tables.map(t => ({ name: t.name, type: 'table' as const } as WhitelistNode)),
        } as WhitelistNode)),
      ];
      const wl: Whitelist = [{
        name: connectionName,
        type: 'connection' as const,
        children: schemaChildren.length > 0 ? schemaChildren : undefined,
      }];
      // Preserve existing docs and include the new doc (last in array) if non-empty
      const allDocs = effectiveContent?.versions?.[effectiveContent.versions.length - 1]?.docs ?? [];
      const docsToSave = allDocs.filter(d => d.content.trim());
      // If no docs at all, include a single empty doc
      if (docsToSave.length === 0) docsToSave.push({ content: '' });
      const existingVersion = effectiveContent?.versions?.[effectiveContent.versions.length - 1];
      const contextContent: ContextContent = {
        versions: [{
          version: existingVersion?.version ?? 1,
          whitelist: wl,
          docs: docsToSave,
          createdAt: existingVersion?.createdAt ?? new Date().toISOString(),
          createdBy: existingVersion?.createdBy ?? 0,
          lastEditedAt: new Date().toISOString(),
          description: existingVersion?.description ?? 'Initial setup',
        }],
        published: { all: effectiveContent?.published?.all ?? 1 },
      };
      editFile({ fileId: realFileId, changes: { content: contextContent, name: 'Knowledge Base' } });
      const result = await publishFile({ fileId: realFileId });
      onComplete(result.id);
    } catch (err) {
      console.error('[StepContext] Save error:', err);
      setError('Failed to save context. Please try again.');
    } finally {
      setSaving(false);
    }
  }, [realFileId, connectionName, effectiveWhitelist, effectiveContent, onComplete]);

  /** Show inline agent activity feed and kick off the agent */
  const reduxState = useAppSelector(state => state);
  const handleAgentDescribe = useCallback(async () => {
    if (!realFileId) {
      setError('Context file is still loading. Please wait a moment.');
      return;
    }
    // Clear any stale error from a prior failed attempt — without this, the
    // user could see an old "[object Object]" or other error text persist
    // even when the current run succeeds.
    setError(null);
    onRequestChat?.(realFileId);

    // Build appState so the agent knows it's on a context file page.
    // Read the LIVE store (not the render-closure `reduxState`): the empty doc
    // entry appended on entering the docs sub-step is dispatched synchronously
    // just before this runs, and EditFile matches against that live content. Using
    // the stale closure would send `docs:[]`, so the agent's `"docs":[]` oldMatch
    // wouldn't match the live file (the production EditFile "not found" failure).
    let appState = null;
    const [augmented] = selectAugmentedFiles(getStore().getState(), [realFileId]);
    if (augmented) {
      appState = { type: 'file' as const, state: compressAugmentedFile(augmented) };
    }

    // Build simplified schema from connections — filter to static schemas if applicable
    const conn = connections[connectionName];
    const allSchemas = conn?.schema?.schemas ?? [];
    const relevantSchemas = staticSchemas?.length
      ? allSchemas.filter(s => staticSchemas.includes(s.schema))
      : allSchemas;
    const simplifiedSchema = relevantSchemas.map(s => ({
      schema: s.schema,
      tables: s.tables.map(t => t.table)
    }));

    // Build agent message — include connection + schema context + questionnaire answers
    const agentMessage = [
      AGENT_DESCRIBE_MESSAGE,
      `Connection: ${connectionName}${staticSchemas?.length ? ` (schemas: ${staticSchemas.join(', ')})` : ''}.`,
      staticSchemas?.length
        ? `Dataset(s) to focus on: ${staticSchemas.join(', ')}.`
        : '',
      questionnaireAnswers?.datasetDescription
        ? `The user describes this dataset as: "${questionnaireAnswers.datasetDescription}"`
        : '',
      questionnaireAnswers?.keyMetrics
        ? `Key metrics and KPIs the user tracks: "${questionnaireAnswers.keyMetrics}"`
        : '',
    ].filter(Boolean).join('\n\n');

    // Wrap /api/chat/init in try/catch + non-2xx handling. On failure, route the
    // error to the active prior conversation's errors[] (so it shows in history)
    // and surface in the wizard UI. If there's no prior conv, logInitFailure no-ops
    // — true cold-start init failures go to Sentry / UI only.
    let newConvId: number;
    try {
      const initRes = await fetch('/api/chat/init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ firstMessage: agentMessage }),
      });
      if (!initRes.ok) {
        let msg = `/api/chat/init returned HTTP ${initRes.status}`;
        // The API error envelope is `{ error: { code, message, type } }` —
        // grab `.message`. Previously we did `String(b.error)`, which on the
        // envelope shape produced literal "[object Object]". Fall back through
        // plain-string error / a coerced string for legacy shapes.
        try {
          const b = await initRes.json();
          if (typeof b?.error === 'string') {
            msg = b.error;
          } else if (typeof b?.error?.message === 'string') {
            msg = b.error.message;
          } else if (typeof b?.message === 'string') {
            msg = b.message;
          }
        } catch { /* non-JSON body */ }
        logInitFailure(msg, initRes.status);
        setError(msg);
        return;
      }
      const initData = await initRes.json();
      newConvId = initData.conversationID;
      if (typeof newConvId !== 'number') {
        const msg = '/api/chat/init returned no conversationID';
        logInitFailure(msg);
        setError(msg);
        return;
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      logInitFailure(msg);
      setError(`Could not start the chat: ${msg}`);
      return;
    }

    // Create a conversation and send the message directly (no sidebar needed)
    dispatch(createConversation({
      conversationID: newConvId,
      agent: 'OnboardingContextAgent',
      agent_args: {
        connection_id: connectionName,
        context_path: contextPath,
        context_version: null,
        schema: simplifiedSchema,
        context: newDocContent || '',
        app_state: appState,
      },
      message: agentMessage,
    }));
    setShowAgentFeed(true);
  }, [realFileId, dispatch, onRequestChat, connectionName, connections, newDocContent, contextPath, staticSchemas, questionnaireAnswers]);

  // Auto-trigger context agent when entering docs sub-step with questionnaire answers
  const hasAutoTriggeredAgent = useRef(false);
  useEffect(() => {
    if (subStep !== 'docs' || !questionnaireAnswers || hasAutoTriggeredAgent.current) return;
    if (!realFileId || contextFile?.loading) return;
    hasAutoTriggeredAgent.current = true;
    handleAgentDescribe();
  }, [subStep, questionnaireAnswers, realFileId, contextFile?.loading, handleAgentDescribe]);

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

  /* ─── Sub-step 1: Select Tables ─── */
  if (subStep === 'tables') {
    return (
      <VStack gap={6} align="stretch" minH="400px">
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
              Select tables
            </Heading>
          )}
          <Text color="fg.muted" fontSize="sm">
            {totalTables > 0
              ? <>We&apos;ve auto-selected {totalTables === 1 ? '' : 'all '}<Text as="span" color="accent.teal" fontWeight="600">{totalTables} {totalTables === 1 ? 'table' : 'tables'}</Text>. Deselect anything you don&apos;t need (you can always edit this later).</>
              : 'No tables found for this connection.'
            }
          </Text>
        </Box>

        {/* Tables */}
        {schemas.length > 0 && (
          <Box
            border="1px solid"
            borderColor="border.default"
            borderRadius="lg"
            p={4}
            maxH="400px"
            overflowY="auto"
          >
            <HStack gap={2} mb={3}>
              <Text fontSize="sm" fontWeight="600">Tables</Text>
              <Text fontSize="xs" fontFamily="mono" color="fg.subtle">
                {whitelistedCount}/{totalTables} selected
              </Text>
            </HStack>
            <SchemaTreeView
              schemas={schemas}
              selectable
              whitelist={effectiveWhitelist}
              onWhitelistChange={handleWhitelistChange}
              showColumns={true}
              connectionName={connectionName}
              defaultExpandedSchemas
            />
          </Box>
        )}

        {schemas.length === 0 && (
          <Box p={4} bg="bg.muted" borderRadius="lg">
            <Text color="fg.muted" fontSize="sm">
              No schema found for this connection. You can still add context in the next step.
            </Text>
          </Box>
        )}

        {/* Spacer pushes button to bottom */}
        <Box flex={1} />

        {/* Actions */}
        <HStack justify="flex-end" gap={3}>
          <Button
            aria-label="Continue to documentation"
            variant="outline"
            size="sm"
            fontFamily="mono"
            onClick={() => setSubStep('docs')}
          >
            Next &rarr;
          </Button>
        </HStack>
      </VStack>
    );
  }

  /* ─── Sub-step 2: Add Data Context (text + agent) ─── */
  return (
    <VStack gap={6} align="stretch">
      <style>{cursorBlinkKeyframes}</style>

      {/* Header */}
      <Box>
        <Heading size="md" fontFamily="mono" fontWeight="500" mb={1}>
          Data Documentation
        </Heading>
        <Text color="fg.muted" fontSize="sm">
          This is where you can describe your dataset, key metrics, and any other info the agent should know when querying this data.
        </Text>
      </Box>

      {/* Existing docs — subtle display */}
      {existingDocs.length > 0 && (
        <Collapsible.Root>
          <Collapsible.Trigger asChild>
            <HStack
              cursor="pointer"
              px={4}
              py={2.5}
              border="1px solid"
              borderColor="border.default"
              borderRadius="lg"
              _hover={{ bg: 'bg.muted' }}
              justify="space-between"
            >
              <HStack gap={2}>
                <Text fontSize="sm" fontWeight="600" color="fg.muted">Existing context</Text>
                <Text fontSize="xs" fontFamily="mono" color="fg.subtle">
                  {existingDocs.length} {existingDocs.length === 1 ? 'doc' : 'docs'}
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
              maxH="200px"
              overflowY="auto"
              bg="bg.muted"
              mt="-1px"
            >
              {existingDocs.map((doc, idx) => (
                <Box key={idx} mb={idx < existingDocs.length - 1 ? 3 : 0}>
                  <Markdown context="mainpage">{doc.content}</Markdown>
                </Box>
              ))}
            </Box>
          </Collapsible.Content>
        </Collapsible.Root>
      )}

      {/* New doc editor — hidden while agent is actively writing */}
      {(!isAgentRunning || newDocContent.trim()) && <Box>
        <Text fontSize="sm" fontWeight="600" mb={2}>
          {showAgentFeed ? 'Auto-generated context' : existingDocs.length > 0 ? 'Add more context' : 'Data context'}
          <Text as="span" fontSize="xs" color="fg.subtle" ml={2}>{showAgentFeed ? '(editable)' : '(optional, markdown)'}</Text>
        </Text>
        <Box
          border="1px solid"
          borderColor="border.default"
          borderRadius="lg"
          overflow="hidden"
        >
          <HStack gap={0} align="stretch" display="flex">
            <Box flex={1} minW={0}>
              <Editor
                height="250px"
                language="markdown"
                value={newDocContent}
                onChange={handleEditorChange}
                theme={colorMode === 'dark' ? 'vs-dark' : 'light'}
                options={{
                  minimap: { enabled: false },
                  wordWrap: 'on',
                  lineNumbers: 'off',
                  fontSize: 13,
                  fontFamily: 'var(--font-jetbrains-mono)',
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
              {newDocContent.trim() ? (
                <Markdown context="mainpage">{newDocContent}</Markdown>
              ) : (
                <Text color="fg.muted" fontSize="sm">Preview will appear here...</Text>
              )}
            </Box>
          </HStack>
        </Box>
      </Box>}

      {/* Error */}
      {error && (
        <Text color="accent.danger" fontSize="sm">{error}</Text>
      )}

      {/* Progress bar + skip escape hatch */}
      <style>{`@keyframes shimmer { 0% { transform: translateX(-100%); } 100% { transform: translateX(100%); } }`}</style>
      {isAgentRunning && (
        <VStack gap={2} align="stretch" pt={2}>
          <Text fontSize="xs" fontFamily="mono" color="accent.teal">
            {getProgressMessage(agentProgress, [
              [0, 'Exploring your tables...'],
              [25, 'Reading column definitions...'],
              [50, 'Writing data documentation...'],
              [80, 'Finishing up...'],
              [100, 'Done!'],
            ])}
          </Text>
          <Progress.Root size="sm" value={agentProgress} flex={1} colorPalette="teal">
            <Progress.Track borderRadius="full" overflow="hidden">
              <Progress.Range
                style={{ transition: 'width 0.4s ease-out' }}
                css={{
                  position: 'relative',
                  '&::after': {
                    content: '""',
                    position: 'absolute',
                    inset: 0,
                    background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.3), transparent)',
                    animation: 'shimmer 1.5s ease-in-out infinite',
                  },
                }}
              />
            </Progress.Track>
          </Progress.Root>
          <HStack justify="flex-end">
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
        </VStack>
      )}

      {/* Save progress bar */}
      {saving && (
        <SaveProgressBar />
      )}

      {/* Actions — hidden while agent is running or saving */}
      {!isAgentRunning && !saving && (
        <HStack justify="space-between" gap={3} pt={2}>
          <Button
            variant="ghost"
            size="sm"
            fontFamily="mono"
            onClick={() => setSubStep('tables')}
          >
            &larr; Back to tables
          </Button>
          <HStack gap={3}>
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
              {...(showAgentFeed
                ? { bg: 'accent.teal', color: 'white', _hover: { opacity: 0.9 } }
                : { variant: 'outline' as const }
              )}
              size="sm"
              fontFamily="mono"
              onClick={handleSave}
              disabled={saving}
            >
              {showAgentFeed ? 'Save & Continue' : 'Skip & Continue'}
            </Button>
          </HStack>
        </HStack>
      )}

      {/* Agent activity feed */}
      {showAgentFeed && (
        <AgentFeedCollapsible connectionName={connectionName} contextPath={contextPath} isRunning={isAgentRunning} />
      )}

      {/* Debug: appState */}
      {showDebug && realFileId && (
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
                    const [aug] = selectAugmentedFiles(reduxState, [realFileId]);
                    return aug ? { type: 'file', state: compressAugmentedFile(aug) } : null;
                  })(),
                  null, 2
                )}
              </Text>
            </Box>
          </Collapsible.Content>
        </Collapsible.Root>
      )}
    </VStack>
  );
}
