'use client';

import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { Box, VStack, HStack, Text } from '@chakra-ui/react';
import { LuSparkles } from 'react-icons/lu';
import type { WhitelistItem, SchemaTreeItem } from '@/components/schema-browser/SchemaTreeView';
import { pulseKeyframes, sparkleKeyframes } from '@/lib/ui/animations';
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
import type { ContextContent, Whitelist, WhitelistNode, DocEntry } from '@/lib/types';
import { useAgentProgress } from '../useAgentProgress';
import type { QuestionnaireAnswers } from '../ConnectionWizardTypes';
import StepContextTablesStep from './StepContextTablesStep';
import StepContextDocsStep from './StepContextDocsStep';

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
      <StepContextTablesStep
        greeting={greeting}
        displayedText={displayedText}
        typingDone={typingDone}
        totalTables={totalTables}
        schemas={schemas}
        whitelistedCount={whitelistedCount}
        effectiveWhitelist={effectiveWhitelist}
        onWhitelistChange={handleWhitelistChange}
        connectionName={connectionName}
        onNext={() => setSubStep('docs')}
      />
    );
  }

  /* ─── Sub-step 2: Add Data Context (text + agent) ─── */
  return (
    <StepContextDocsStep
      isAgentRunning={isAgentRunning}
      docContent={docContent}
      hadExistingDocs={hadExistingDocs}
      showAgentFeed={showAgentFeed}
      allDocs={allDocs}
      onDocsChange={handleDocsChange}
      expandedDocIndices={expandedDocIndices}
      onExpandedChange={setExpandedDocIndices}
      knowledgeCounts={knowledgeCounts}
      error={error}
      agentProgress={agentProgress}
      onSkip={handleSkip}
      saving={saving}
      onBack={() => setSubStep('tables')}
      onAgentDescribe={handleAgentDescribe}
      onSave={handleSave}
      connectionName={connectionName}
      contextPath={contextPath}
      showDebug={showDebug}
      realFileId={realFileId}
      reduxState={reduxState}
    />
  );
}
