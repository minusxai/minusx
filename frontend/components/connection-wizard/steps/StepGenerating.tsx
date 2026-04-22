'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { Box, VStack, HStack, Text, Heading, Button, Icon, Collapsible, Input, Progress } from '@chakra-ui/react';
import { LuSparkles, LuLayoutDashboard, LuChevronDown, LuChevronRight } from 'react-icons/lu';
import { useRouter } from '@/lib/navigation/use-navigation';
import { preserveModeParam } from '@/lib/mode/mode-utils';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import { createConversation, selectActiveConversation, selectConversation, interruptChat, generateVirtualConversationId } from '@/store/chatSlice';
import { setNavigation, setActiveVirtualId } from '@/store/navigationSlice';
import { removeVirtualFile, isVirtualFileId } from '@/store/filesSlice';
import { createVirtualFile, publishAll } from '@/lib/api/file-state';
import { selectAugmentedFiles } from '@/lib/store/file-selectors';
import { compressAugmentedFile } from '@/lib/api/compress-augmented';
import { getStore } from '@/store/store';
import { useFile } from '@/lib/hooks/file-state-hooks';
import { cursorBlinkKeyframes } from '@/lib/ui/animations';
import { useContext } from '@/lib/hooks/useContext';
import { resolveHomeFolderSync } from '@/lib/mode/path-resolver';
import ChatInterface from '@/components/explore/ChatInterface';
import { useAgentProgress } from '../useAgentProgress';

const TYPEWRITER_SPEED = 35;
const GENERATING_TAU = 40; // ~90% at ~92s — feels like about a minute

const DASHBOARD_PROMPT = `Let's build the dashboard!`;

function SkipLinks({ onSkip, onGoHome }: { onSkip: () => void; onGoHome: () => void }) {
  const linkStyle = {
    fontSize: 'xs',
    color: 'fg.subtle',
    fontFamily: 'mono',
    cursor: 'pointer',
    textDecoration: 'underline',
    _hover: { color: 'fg.muted' },
  } as const;
  return (
    <HStack>
      <Text as="button" {...linkStyle} onClick={onSkip}>Build dashboard manually</Text>
      <Text fontSize="xs" color="fg.subtle" fontFamily="mono">or</Text>
      <Text as="button" {...linkStyle} onClick={onGoHome}>Go home</Text>
    </HStack>
  );
}

interface StepGeneratingProps {
  connectionName: string;
  contextFileId: number;
  greeting?: string;
  onComplete?: () => Promise<void>;
  /** For static connections: only build dashboard for these schemas. */
  staticSchemas?: string[] | null;
}

export default function StepGenerating({ connectionName, contextFileId, greeting, onComplete, staticSchemas }: StepGeneratingProps) {
  const router = useRouter();
  const dispatch = useAppDispatch();
  const reduxState = useAppSelector(state => state);
  const showDebug = useAppSelector(state => state.ui.devMode);
  const user = useAppSelector(state => state.auth.user);
  const modeRoot = resolveHomeFolderSync(user?.mode ?? 'org', user?.home_folder ?? '');

  // Load context (schema + docs) from the saved context file
  const contextInfo = useContext(`${modeRoot}/context`);
  const { databases, documentation: contextDocs } = contextInfo;

  const [isGenerating, setIsGenerating] = useState(false);
  const [hasStarted, setHasStarted] = useState(false);
  const [virtualDashboardId, setVirtualDashboardId] = useState<number | null>(null);
  const [showTrace, setShowTrace] = useState(false);
  const [userPreference, setUserPreference] = useState('');

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

  // Create virtual dashboard file on mount
  const hasCreatedVirtual = useRef(false);
  useEffect(() => {
    if (hasCreatedVirtual.current || virtualDashboardId) return;
    hasCreatedVirtual.current = true;

    createVirtualFile('dashboard').then((vId) => {
      setVirtualDashboardId(vId);

      // Set navigation so selectAppState resolves to this virtual dashboard
      dispatch(setNavigation({ pathname: '/new/dashboard', searchParams: { virtualId: String(vId) } }));
      dispatch(setActiveVirtualId(vId));
    }).catch((err) => {
      console.error('[StepGenerating] Virtual dashboard creation failed:', err);
      hasCreatedVirtual.current = false;
    });
  }, [virtualDashboardId, dispatch]);

  // Load the virtual file from Redux
  const { fileState: dashboardFile } = useFile(virtualDashboardId ?? undefined) ?? {};

  // Watch active conversation for completion
  const activeConvId = useAppSelector(selectActiveConversation);
  const conversation = useAppSelector(state =>
    activeConvId ? selectConversation(state, activeConvId) : undefined
  );

  // Detect when the agent finishes
  useEffect(() => {
    if (!isGenerating || !conversation) return;
    if (conversation.executionState !== 'FINISHED') return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsGenerating(false);
  }, [isGenerating, conversation]);

  const isDone = !isGenerating && hasStarted;

  // Progress bar + auto-collapse trace
  const agentProgress = useAgentProgress(isGenerating, isDone, GENERATING_TAU);
  const wasGeneratingRef = useRef(false);
  useEffect(() => {
    if (wasGeneratingRef.current && !isGenerating && hasStarted) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setShowTrace(false);
    }
    wasGeneratingRef.current = isGenerating;
  }, [isGenerating, hasStarted]);

  const handleGenerate = useCallback(() => {
    if (hasStarted || !virtualDashboardId) return;
    setHasStarted(true);

    // Build appState from the virtual dashboard file
    let appState = null;
    const [augmented] = selectAugmentedFiles(reduxState, [virtualDashboardId]);
    if (augmented) {
      appState = { type: 'file' as const, state: compressAugmentedFile(augmented) };
    }

    // Build simplified schema — filter to relevant schemas for static connections
    const selectedDb = databases.find(d => d.databaseName === connectionName) || databases[0];
    const allSchemas = selectedDb?.schemas ?? [];
    const relevantSchemas = staticSchemas?.length
      ? allSchemas.filter(s => staticSchemas.includes(s.schema))
      : allSchemas;
    const simplifiedSchema = relevantSchemas.map(s => ({
      schema: s.schema,
      tables: s.tables.map(t => t.table)
    }));

    dispatch(createConversation({
      conversationID: generateVirtualConversationId(),
      agent: 'OnboardingDashboardAgent',
      agent_args: {
        connection_id: connectionName,
        context_path: `${modeRoot}/context`,
        context_version: null,
        schema: simplifiedSchema,
        context: contextDocs || '',
        app_state: appState,
      },
      message: [
        DASHBOARD_PROMPT,
        `Connection: ${connectionName}${staticSchemas?.length ? ` (schemas: ${staticSchemas.join(', ')})` : ''}.`,
        `Give the dashboard a descriptive name and place it in the ${modeRoot}/ folder.`,
        staticSchemas?.length ? `Focus only on the dataset(s): ${staticSchemas.join(', ')}. Do not query other schemas in the connection.` : '',
        userPreference.trim() ? `User preference: ${userPreference.trim()}` : '',
      ].filter(Boolean).join('\n\n'),
    }));

    setIsGenerating(true);
    setShowTrace(true);
  }, [dispatch, connectionName, virtualDashboardId, reduxState, hasStarted, databases, contextDocs]);

  // Publish all dirty files, mark wizard complete, and navigate to the dashboard
  const handleGoToDashboard = useCallback(async () => {
    if (!virtualDashboardId) return;
    try {
      await publishAll();
      if (onComplete) await onComplete();
      const freshState = getStore().getState();
      const allFiles = Object.values(freshState.files.files);
      const dashboard = allFiles
        .filter(f => f.type === 'dashboard' && f.id > 0 && f.path.startsWith(modeRoot))
        .sort((a, b) => b.id - a.id)[0];
      if (dashboard) {
        router.push(preserveModeParam(`/f/${dashboard.id}`));
      } else {
        router.push(preserveModeParam('/'));
      }
    } catch (err) {
      console.error('[StepGenerating] Publish failed:', err);
      router.push(preserveModeParam('/'));
    }
  }, [virtualDashboardId, router, onComplete]);

  /** Discard all virtual (unsaved) files created during this step */
  const discardVirtualFiles = useCallback(() => {
    const allFiles = getStore().getState().files.files;
    for (const idStr of Object.keys(allFiles)) {
      const id = Number(idStr);
      if (isVirtualFileId(id)) {
        dispatch(removeVirtualFile(id));
      }
    }
  }, [dispatch]);

  /** Skip: interrupt agent, mark wizard complete, go to /new/dashboard */
  const handleSkip = useCallback(async () => {
    if (activeConvId) {
      dispatch(interruptChat({ conversationID: activeConvId }));
    }
    discardVirtualFiles();
    if (onComplete) await onComplete();
    router.push(preserveModeParam('/new/dashboard'));
  }, [activeConvId, dispatch, router, onComplete, discardVirtualFiles]);

  /** Skip everything and go home */
  const handleGoHome = useCallback(async () => {
    if (activeConvId) {
      dispatch(interruptChat({ conversationID: activeConvId }));
    }
    discardVirtualFiles();
    if (onComplete) await onComplete();
    router.push(preserveModeParam('/p/org'));
  }, [activeConvId, dispatch, router, onComplete, discardVirtualFiles]);

  return (
    <VStack gap={6} align="stretch" minH="400px">
      {greeting && <style>{cursorBlinkKeyframes}</style>}
      <style>{`@keyframes shimmer { 0% { transform: translateX(-100%); } 100% { transform: translateX(100%); } }`}</style>

      {/* Header */}
      <VStack gap={3} align="start" py={6}>
        {greeting ? (
          <Heading
            fontSize="2xl"
            fontFamily="mono"
            fontWeight="400"
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
          <Heading size="lg" fontFamily="mono" fontWeight="400">
            {isDone ? 'Your dashboard is ready!' : isGenerating ? 'Building your dashboard...' : 'Build a starter dashboard'}
          </Heading>
        )}
        <Text color="fg.muted" fontSize="sm">
          {isDone
            ? 'MinusX created questions and assembled them into a dashboard for you.'
            : isGenerating
              ? 'MinusX is exploring your data, writing queries, and building visualizations.'
              : 'MinusX will analyze your schema and create a dashboard with interesting queries automatically.'
          }
        </Text>
      </VStack>

      {/* User preference input — only before generation starts */}
      {!hasStarted && (
        <Box>
          <Text fontSize="sm" fontWeight="500" mb={2}>
            Anything specific you want the agent to focus on? <Text as="span" color="fg.subtle">(optional)</Text>
          </Text>
          <Input
            value={userPreference}
            onChange={(e) => setUserPreference(e.target.value)}
            placeholder="e.g., focus on revenue over time and order distribution across X categories"
            fontFamily="mono"
            fontSize="sm"
          />
        </Box>
      )}

      {/* Action buttons + progress */}
      <VStack gap={2} align="stretch">
        <HStack justify="center" gap={4}>
          {!isGenerating && !isDone && (
            <VStack gap={2}>
              <Button
                bg="accent.teal"
                color="white"
                _hover={{ opacity: 0.9 }}
                size="sm"
                fontFamily="mono"
                onClick={handleGenerate}
                disabled={!virtualDashboardId}
              >
                <LuSparkles size={14} />
                Auto-generate dashboard
              </Button>
              <SkipLinks onSkip={handleSkip} onGoHome={handleGoHome} />
            </VStack>
          )}
          {isDone && (
            <Button
              bg="accent.teal"
              color="white"
              _hover={{ opacity: 0.9 }}
              size="sm"
              fontFamily="mono"
              onClick={handleGoToDashboard}
            >
              <LuLayoutDashboard size={14} />
              Go to dashboard
            </Button>
          )}
        </HStack>

        {/* Progress bar while generating */}
        {isGenerating && (
          <VStack gap={2} align="stretch">
            <Progress.Root size="sm" value={agentProgress} colorPalette="teal">
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
              <SkipLinks onSkip={handleSkip} onGoHome={handleGoHome} />
            </HStack>
          </VStack>
        )}
      </VStack>

      {/* Debug: appState */}
      {showDebug && virtualDashboardId && (
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
                    const [aug] = selectAugmentedFiles(reduxState, [virtualDashboardId]);
                    return aug ? { type: 'file', state: compressAugmentedFile(aug) } : null;
                  })(),
                  null, 2
                )}
              </Text>
            </Box>
          </Collapsible.Content>
        </Collapsible.Root>
      )}

      {/* Agent trace — collapsible, auto-opens on generate, auto-closes on done */}
      {(isGenerating || isDone) && (
        <Collapsible.Root open={showTrace} onOpenChange={(e) => setShowTrace(e.open)}>
          <Collapsible.Trigger asChild>
            <HStack
              cursor="pointer"
              px={3}
              py={2}
              bg="bg.muted"
              borderRadius="lg"
              _hover={{ bg: 'bg.emphasis' }}
              gap={2}
              justify="space-between"
            >
              <HStack>
                <Icon as={LuSparkles} boxSize={3.5} color="accent.teal" />
                <Text fontSize="sm" fontFamily="mono" fontWeight="500" color="accent.teal">
                  {showTrace ? 'Hide MinusX agent trace' : 'See MinusX agent in action'}
                </Text>
              </HStack>
              <HStack>
                {isGenerating && (
                  <Text fontSize="xs" fontFamily="mono" color="fg.subtle">
                    Exploring data & building visualizations (~1 min)
                  </Text>
                )}
                {isDone && (
                  <Text fontSize="xs" fontFamily="mono" color="accent.teal">
                    Done!
                  </Text>
                )}
                <Icon
                  as={showTrace ? LuChevronDown : LuChevronRight}
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
              h="400px"
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
      )}
    </VStack>
  );
}
