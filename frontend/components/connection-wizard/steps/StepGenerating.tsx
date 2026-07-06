'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { Box, VStack, HStack, Text, Heading, Button, Icon, Collapsible, Input, Progress } from '@chakra-ui/react';
import { LuSparkles, LuLayoutDashboard, LuChevronDown, LuChevronRight } from 'react-icons/lu';
import { useRouter } from '@/lib/navigation/use-navigation';
import { preserveModeParam } from '@/lib/mode/mode-utils';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import { createConversation, selectActiveConversation, selectConversation, interruptChat } from '@/store/chatSlice';
import { setNavigation } from '@/store/navigationSlice';
import { createDraftFile, publishAll, deleteFile } from '@/lib/file-state/file-state';
import { selectAugmentedFiles } from '@/lib/store/file-selectors';
import { compressAugmentedFile } from '@/lib/chat/compress-augmented';
import { getStore } from '@/store/store';
import { useFile } from '@/lib/hooks/file-state-hooks';
import { cursorBlinkKeyframes } from '@/lib/ui/animations';
import { useContext } from '@/lib/hooks/useContext';
import { resolveHomeFolderSync } from '@/lib/mode/path-resolver';
import ChatInterface from '@/components/explore/ChatInterface';
import { useAgentProgress, getProgressMessage } from '../useAgentProgress';
import { useConfigs } from '@/lib/hooks/useConfigs';
import type { QuestionnaireAnswers } from '../ConnectionWizardTypes';

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
  /** Advance to the NEXT wizard step (e.g. Slack). */
  onComplete?: () => Promise<void>;
  /** Mark onboarding fully complete (skip remaining steps) — used by "Go to dashboard". */
  onFinish?: () => Promise<void> | void;
  /** Whether a Slack step follows — controls the secondary "Connect Slack" action. */
  showSlackStep?: boolean;
  /** For static connections: only build dashboard for these schemas. */
  staticSchemas?: string[] | null;
  /** Pre-filled dashboard preference from questionnaire — auto-starts generation if set. */
  initialPreference?: string;
  /** Full questionnaire answers for richer agent context. */
  questionnaireAnswers?: QuestionnaireAnswers | null;
}

export default function StepGenerating({ connectionName, contextFileId, greeting, onComplete, onFinish, showSlackStep, staticSchemas, initialPreference, questionnaireAnswers }: StepGeneratingProps) {
  const router = useRouter();
  const dispatch = useAppDispatch();
  const { config } = useConfigs();
  const agentName = config.branding.agentName;
  const reduxState = useAppSelector(state => state);
  const showDebug = useAppSelector(state => state.ui.devMode);
  const user = useAppSelector(state => state.auth.user);
  const modeRoot = resolveHomeFolderSync(user?.mode ?? 'org', user?.home_folder ?? '');

  // Load the schema from the saved context file (docs are resolved server-side
  // from the context_file_id pointer when the dashboard agent runs).
  const { databases } = useContext(`${modeRoot}/context`);

  const [isGenerating, setIsGenerating] = useState(false);
  const [hasStarted, setHasStarted] = useState(false);
  const [virtualDashboardId, setVirtualDashboardId] = useState<number | null>(null);
  const [showTrace, setShowTrace] = useState(false);
  // Track our own conversation ID to avoid picking up the stale context agent conversation
  const [ownConvId, setOwnConvId] = useState<number | null>(null);
  const [userPreference, setUserPreference] = useState(initialPreference ?? '');

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

  // Create draft dashboard file on mount
  const hasCreatedDraft = useRef(false);
  useEffect(() => {
    if (hasCreatedDraft.current || virtualDashboardId) return;
    hasCreatedDraft.current = true;

    // Seed a default title so an onboarding dashboard is NEVER blank, even if the agent forgets to
    // rename it. The agent is instructed (and now able, via EditFile `name`) to give it a more
    // descriptive title.
    createDraftFile('dashboard', { name: 'Getting Started Dashboard' }).then((draftId: number) => {
      setVirtualDashboardId(draftId);

      // Set navigation so selectAppState resolves to this draft dashboard
      dispatch(setNavigation({ pathname: `/f/${draftId}`, searchParams: {} }));
    }).catch((err: unknown) => {
      console.error('[StepGenerating] Draft dashboard creation failed:', err);
      hasCreatedDraft.current = false;
    });
  }, [virtualDashboardId, dispatch]);

  // Load the virtual file from Redux
  const { fileState: dashboardFile } = useFile(virtualDashboardId ?? undefined) ?? {};

  // Watch our own conversation for completion (not the global active one,
  // which may still point to the finished context agent conversation)
  const activeConvId = useAppSelector(selectActiveConversation);
  const conversation = useAppSelector(state =>
    ownConvId ? selectConversation(state, ownConvId) : undefined
  );

  // Detect when the agent finishes
  useEffect(() => {
    if (!isGenerating || !conversation) return;
    if (conversation.executionState !== 'FINISHED') return;
     
    setIsGenerating(false);
  }, [isGenerating, conversation]);

  const isDone = !isGenerating && hasStarted;

  // Progress bar + auto-collapse trace
  const agentProgress = useAgentProgress(isGenerating, isDone, GENERATING_TAU);
  const wasGeneratingRef = useRef(false);
  useEffect(() => {
    if (wasGeneratingRef.current && !isGenerating && hasStarted) {
       
      setShowTrace(false);
    }
    wasGeneratingRef.current = isGenerating;
  }, [isGenerating, hasStarted]);

  const handleGenerate = useCallback(async () => {
    if (hasStarted || !virtualDashboardId) return;
    setHasStarted(true);
    setIsGenerating(true);
    setShowTrace(true);

    // Build appState from the virtual dashboard file
    let appState = null;
    const [augmented] = selectAugmentedFiles(reduxState, [virtualDashboardId]);
    if (augmented) {
      appState = { type: 'file' as const, state: compressAugmentedFile(augmented) };
    }

    const message = [
      DASHBOARD_PROMPT,
      `Connection: ${connectionName}${staticSchemas?.length ? ` (schemas: ${staticSchemas.join(', ')})` : ''}.`,
      `Dashboard to be saved in ${modeRoot}/ folder.`,
      staticSchemas?.length ? `Dataset(s) to focus on : ${staticSchemas.join(', ')}.` : '',
      questionnaireAnswers?.datasetDescription ? `About the data: ${questionnaireAnswers.datasetDescription}` : '',
      questionnaireAnswers?.keyMetrics ? `Key metrics to focus on: ${questionnaireAnswers.keyMetrics}` : '',
      userPreference.trim() ? `What the user wants to see in the dashboard: ${userPreference.trim()}` : '',
    ].filter(Boolean).join('\n\n');

    // v3: conversations are dedicated rows — create via /api/conversations and tag version:3
    // so the chat listener drives this turn through the v3 turns + stream engine.
    const initRes = await fetch('/api/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ firstMessage: message }),
    });
    const { id: newConvId } = await initRes.json();
    setOwnConvId(newConvId);

    dispatch(createConversation({
      conversationID: newConvId,
      agent: 'OnboardingDashboardAgent',
      version: 3,
      agent_args: {
        connection_id: connectionName,
        // Pointer-only: the server resolves the context docs/schema for this file.
        context_file_id: contextFileId,
        context_version: null,
        app_state: appState,
      },
      message,
    }));
  }, [dispatch, connectionName, contextFileId, virtualDashboardId, reduxState, hasStarted, userPreference, staticSchemas, modeRoot]);

  // Auto-start generation if initialPreference was provided (from questionnaire)
  // Wait for databases to load so the agent has schema context
  const hasAutoTriggered = useRef(false);
  useEffect(() => {
    if (hasAutoTriggered.current || !initialPreference?.trim() || !virtualDashboardId || hasStarted) return;
    if (databases.length === 0) return; // schema not loaded yet
    hasAutoTriggered.current = true;
    handleGenerate();
  }, [initialPreference, virtualDashboardId, hasStarted, handleGenerate, databases.length]);

  // Publish all dirty files, mark onboarding complete, and navigate (this tab) to the dashboard.
  // Marking complete is required — app/layout.tsx redirects users with incomplete onboarding back to
  // /hello-world, so we must finish the wizard before leaving for /f/<id>. (Previously this opened a
  // new tab AND advanced to the Slack step, so the button didn't do what its label said.)
  const handleGoToDashboard = useCallback(async () => {
    if (!virtualDashboardId) return;
    try {
      await publishAll();
      if (onFinish) await onFinish();
      router.push(preserveModeParam(`/f/${virtualDashboardId}`));
    } catch (err) {
      console.error('[StepGenerating] Publish failed:', err);
    }
  }, [virtualDashboardId, onFinish, router]);

  /** Discard draft files created during this step — note: orphan cleanup is a future task */
  const discardDraftFiles = useCallback(() => {
    const allFiles = getStore().getState().files.files;
    for (const idStr of Object.keys(allFiles)) {
      const file = allFiles[Number(idStr)];
      if (file?.draft === true) {
        deleteFile({ fileId: file.id }).catch(() => {});
      }
    }
  }, []);

  /** Skip: interrupt agent, mark wizard complete, go home */
  const handleSkip = useCallback(async () => {
    const convToInterrupt = ownConvId ?? activeConvId;
    if (convToInterrupt) {
      dispatch(interruptChat({ conversationID: convToInterrupt }));
    }
    discardDraftFiles();
    if (onComplete) await onComplete();
    router.push(preserveModeParam('/p/org'));
  }, [ownConvId, activeConvId, dispatch, router, onComplete, discardDraftFiles]);

  /** Skip everything and go home */
  const handleGoHome = useCallback(async () => {
    const convToInterrupt = ownConvId ?? activeConvId;
    if (convToInterrupt) {
      dispatch(interruptChat({ conversationID: convToInterrupt }));
    }
    discardDraftFiles();
    if (onComplete) await onComplete();
    router.push(preserveModeParam('/p/org'));
  }, [ownConvId, activeConvId, dispatch, router, onComplete, discardDraftFiles]);

  return (
    <VStack gap={6} align="stretch" minH="400px">
      {greeting && <style>{cursorBlinkKeyframes}</style>}
      <style>{`@keyframes shimmer { 0% { transform: translateX(-100%); } 100% { transform: translateX(100%); } }`}</style>

      {/* Header */}
      <VStack gap={3} align="start" py={6}>
        {greeting ? (
          <Heading
            fontSize={{ base: 'xl', md: '2xl' }}
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
            ? 'Done! Go check out your awesome new dashboard.'
            : isGenerating
              ? `${agentName} is writing queries, building visualizations and assembling a fantastic dashboard for you.`
              : `${agentName} will analyze your schema and create a dashboard with interesting queries automatically.`
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
            <HStack gap={3} flexWrap="wrap" justify="center">
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
              {showSlackStep && (
                <Button
                  variant="ghost"
                  size="sm"
                  fontFamily="mono"
                  color="fg.muted"
                  onClick={() => onComplete?.()}
                >
                  Connect Slack &rarr;
                </Button>
              )}
            </HStack>
          )}
        </HStack>

        {/* Progress bar while generating */}
        {isGenerating && (
          <VStack gap={2} align="stretch">
            <Text fontSize="xs" fontFamily="mono" color="accent.teal">
              {getProgressMessage(agentProgress, [
                [0, 'Analyzing your schema...'],
                [15, 'Writing SQL queries...'],
                [40, 'Building visualizations...'],
                [65, 'Assembling dashboard layout...'],
                [85, 'Final touches...'],
                [100, 'Done!'],
              ])}
            </Text>
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
                  {showTrace ? `Hide ${agentName} agent trace` : `See ${agentName} agent in action`}
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
