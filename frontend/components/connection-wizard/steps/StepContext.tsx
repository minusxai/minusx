'use client';

import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { Box, VStack, HStack, Text, Heading, Button, Collapsible, Icon, Progress } from '@chakra-ui/react';
import { LuSparkles, LuChevronDown, LuChevronRight } from 'react-icons/lu';
import SchemaTreeView, { type WhitelistItem, type SchemaTreeItem } from '@/components/SchemaTreeView';
import { pulseKeyframes, sparkleKeyframes, cursorBlinkKeyframes } from '@/lib/ui/animations';
import type { ConnectionWithSchema } from '@/store/filesSlice';
import { useFile } from '@/lib/hooks/file-state-hooks';
import { useContext as useContextHook } from '@/lib/hooks/useContext';
import { editFile, publishFile } from '@/lib/file-state/file-state';
import { logInitFailure } from '@/lib/messaging/report-client-error';
import { getStore } from '@/store/store';
import { useAppSelector, useAppDispatch } from '@/store/hooks';
import { createConversation, selectActiveConversation, selectConversation, interruptChat } from '@/store/chatSlice';
import { selectAugmentedFiles } from '@/lib/store/file-selectors';
import { compressAugmentedFile } from '@/lib/chat/compress-augmented';
import { mergeWhitelist } from '@/lib/context/context-utils';
import { resolvePath } from '@/lib/mode/path-resolver';
import ContextDocsEditor from '@/components/context/ContextDocsEditor';
import ChatInterface from '@/components/explore/ChatInterface';
import type { ContextContent, Whitelist, WhitelistNode, DocEntry } from '@/lib/types';
import { useAgentProgress, getProgressMessage } from '../useAgentProgress';
import { useConfigs } from '@/lib/hooks/useConfigs';
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
  const { config } = useConfigs();
  const agentName = config.branding.agentName;
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
            {isOpen ? `Hide ${agentName} agent trace` : `See ${agentName} agent in action`}
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

  // All docs from the latest version
  const allDocs = useMemo(() => {
    if (!effectiveContent?.versions?.length) return [];
    const latestVersion = effectiveContent.versions[effectiveContent.versions.length - 1];
    return latestVersion?.docs ?? [];
  }, [effectiveContent]);

  // Combined doc content for the editor (all docs joined)
  const docContent = useMemo(() => {
    return allDocs.map(d => d.content).filter(c => c.trim()).join('\n\n---\n\n');
  }, [allDocs]);

  // Structured knowledge the agent wrote into the latest version. The docs editor
  // only renders `docs`, so we surface a small summary of the metrics/annotations
  // (editable later in the context's Databases tab) so they aren't invisible.
  const knowledgeCounts = useMemo(() => {
    const latest = effectiveContent?.versions?.[effectiveContent.versions.length - 1];
    const metrics = latest?.metrics?.length ?? 0;
    const annotations = (latest?.annotations ?? []).reduce(
      (n, a) => n + (a.description ? 1 : 0) + (a.columns?.length ?? 0),
      0,
    );
    return { metrics, annotations };
  }, [effectiveContent]);

  // Capture once, on first load, whether the context already had docs BEFORE the
  // agent ran. Lets us label the panel "Current Docs" (these pre-date this session)
  // vs "Auto-generated context" (the agent wrote them fresh) — instead of always
  // calling existing docs "auto-generated".
  const [hadExistingDocs, setHadExistingDocs] = useState(false);
  // How many real docs predated the agent — used to keep those collapsed and
  // expand only the doc(s) the agent adds.
  const baseDocCountRef = useRef<number | null>(null);
  const capturedExistingDocsRef = useRef(false);
  useEffect(() => {
    if (capturedExistingDocsRef.current) return;
    if (!contextFile || contextFile.loading) return;
    capturedExistingDocsRef.current = true;
    setHadExistingDocs(docContent.trim().length > 0);
    baseDocCountRef.current = allDocs.filter(d => d.content.trim()).length;
  }, [contextFile, docContent, allDocs]);

  // Docs start collapsed; once the agent finishes, open only the entries it added
  // (indices at/after the pre-existing count). Controlled so manual toggles persist.
  const [expandedDocIndices, setExpandedDocIndices] = useState<number[]>([]);
  const expandedFiredRef = useRef(false);
  useEffect(() => {
    if (expandedFiredRef.current || !isAgentDone) return;
    const base = baseDocCountRef.current ?? 0;
    const newIndices: number[] = [];
    for (let i = base; i < allDocs.length; i++) newIndices.push(i);
    expandedFiredRef.current = true;
    if (newIndices.length) setExpandedDocIndices(newIndices);
  }, [isAgentDone, allDocs.length]);

  // Persist the full docs array into the latest version. ContextDocsEditor owns
  // the per-entry edit debounce, so this just writes through what it emits.
  const handleDocsChange = useCallback((newDocs: DocEntry[]) => {
    if (!realFileId || !contextFile) return;
    const content = { ...contextFile.content, ...contextFile.persistableChanges } as ContextContent;
    const versions = content?.versions;
    if (!versions?.length) return;
    const updatedVersions = versions.map((v, i) =>
      i !== versions.length - 1 ? v : { ...v, docs: newDocs }
    );
    editFile({ fileId: realFileId, changes: { content: { ...content, versions: updatedVersions } } });
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
      const newConnNode: WhitelistNode = {
        name: connectionName,
        type: 'connection' as const,
        children: schemaChildren.length > 0 ? schemaChildren : undefined,
      };
      // Merge into the existing whitelist instead of overwriting it. Overwriting
      // silently narrowed access and broke dashboards on other connections/schemas
      // for everyone in the workspace. The onboarding agent is already told which
      // dataset is new, so we don't need to restrict the context to just it.
      const existingWhitelist: Whitelist =
        effectiveContent?.versions?.[effectiveContent.versions.length - 1]?.whitelist ?? '*';
      const wl: Whitelist = mergeWhitelist(existingWhitelist, [newConnNode]);
      // Preserve existing docs and include the new doc (last in array) if non-empty
      const allDocs = effectiveContent?.versions?.[effectiveContent.versions.length - 1]?.docs ?? [];
      const docsToSave = allDocs.filter(d => d.content.trim());
      // If no docs at all, include a single empty doc
      if (docsToSave.length === 0) docsToSave.push({ content: '' });
      const existingVersion = effectiveContent?.versions?.[effectiveContent.versions.length - 1];
      const contextContent: ContextContent = {
        versions: [{
          ...existingVersion,
          version: existingVersion?.version ?? 1,
          whitelist: wl,
          docs: docsToSave,
          // metrics/annotations the onboarding agent authored are carried via the
          // spread above — never rebuilt from docs alone (would drop them on save).
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
    let appState = null;
    const [augmented] = selectAugmentedFiles(getStore().getState(), [realFileId]);
    if (augmented) {
      appState = { type: 'file' as const, state: compressAugmentedFile(augmented) };
    }

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

    // v3: create the conversation via /api/conversations (dedicated rows). Wrap in try/catch +
    // non-2xx handling. On failure, route the error to the active prior conversation's errors[]
    // (so it shows in history) and surface in the wizard UI. If there's no prior conv,
    // logInitFailure no-ops — true cold-start init failures go to Sentry / UI only.
    let newConvId: number;
    try {
      const initRes = await fetch('/api/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ firstMessage: agentMessage }),
      });
      if (!initRes.ok) {
        let msg = `/api/conversations returned HTTP ${initRes.status}`;
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
      newConvId = initData.id;
      if (typeof newConvId !== 'number') {
        const msg = '/api/conversations returned no conversation id';
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
      version: 3,
      agent_args: {
        // Pointer-only: the server resolves the schema for this connection_id.
        connection_id: connectionName,
        context_path: contextPath,
        context_version: null,
        context: docContent || '',
        app_state: appState,
      },
      message: agentMessage,
    }));
    setShowAgentFeed(true);
  }, [realFileId, dispatch, onRequestChat, connectionName, docContent, contextPath, staticSchemas, questionnaireAnswers]);

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
              fontSize={{ base: 'xl', md: '2xl' }}
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
          Auto Documentation
        </Heading>
        <Text color="fg.muted" fontSize="sm">
          Documentation is where you describe your dataset, key metrics, and any other info the agent should know when querying this data.
        </Text>
      </Box>

      {/* Docs — hidden while agent is actively writing into an empty context */}
      {(!isAgentRunning || docContent.trim()) && <Box>
        <Text fontSize="sm" fontWeight="600" mb={2}>
          {hadExistingDocs ? 'Current Docs' : showAgentFeed ? 'Auto-generated context' : 'Data context'}
          <Text as="span" fontSize="xs" color="fg.subtle" ml={2}>
            {(hadExistingDocs || showAgentFeed) ? '(editable)' : '(optional, markdown)'}
          </Text>
        </Text>
        <ContextDocsEditor
          docs={allDocs.length ? allDocs : [{ content: '' }]}
          onDocsChange={handleDocsChange}
          editorHeight="250px"
          entryLabel="Doc"
          showAddButton={false}
          showHelperText={false}
          showEmptyWarning={false}
          showDraftToggle={true}
          showAlwaysIncludeToggle={false}
          showChildPaths={false}
          showTitleDescription={true}
          expandedIndices={expandedDocIndices}
          onExpandedChange={setExpandedDocIndices}
        />
      </Box>}

      {/* Structured-knowledge summary — metrics/annotations live in the Databases
          tab, not the docs editor above, so surface them here so they're visible. */}
      {(knowledgeCounts.metrics > 0 || knowledgeCounts.annotations > 0) && (
        <HStack
          gap={2}
          fontSize="xs"
          color="fg.muted"
          bg="bg.muted"
          borderRadius="md"
          px={3}
          py={2}
          flexWrap="wrap"
          aria-label="Added metrics and annotations summary"
        >
          <Icon as={LuSparkles} color="accent.teal" boxSize={3.5} />
          <Text>
            Also added
            {knowledgeCounts.metrics > 0 && <Text as="span" fontWeight="600" color="fg.default"> {knowledgeCounts.metrics} metric{knowledgeCounts.metrics === 1 ? '' : 's'}</Text>}
            {knowledgeCounts.metrics > 0 && knowledgeCounts.annotations > 0 && ' and'}
            {knowledgeCounts.annotations > 0 && <Text as="span" fontWeight="600" color="fg.default"> {knowledgeCounts.annotations} annotation{knowledgeCounts.annotations === 1 ? '' : 's'}</Text>}
            .
          </Text>
        </HStack>
      )}

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
              aria-label="Save context and continue"
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
