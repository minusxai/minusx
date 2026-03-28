'use client';

import { useEffect, useRef, useCallback, useState, useMemo } from 'react';
import { Box, Heading, Text, Flex, HStack, Icon, VStack } from '@chakra-ui/react';
import { LuPlay, LuDatabase, LuSparkles, LuArrowLeft, LuCheck } from 'react-icons/lu';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import { setLeftSidebarCollapsed } from '@/store/uiSlice';
import { setNavigation, setActiveVirtualId } from '@/store/navigationSlice';
import { switchMode } from '@/lib/mode/mode-utils';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  pulseKeyframes,
  sparkleKeyframes,
  fadeInUpKeyframes,
  rotateBorderKeyframes,
  cursorBlinkKeyframes,
} from '@/lib/ui/animations';
import {
  type WizardStep,
  type OnboardingState,
  readStateFromURL,
  buildSearchParams,
  detectStepFromSystemState,
  STEP_LABELS,
} from './onboarding-state';
import { useConnections } from '@/lib/hooks/useConnections';
import { useContexts } from '@/lib/hooks/useContexts';
import { useFile, useFilesByCriteria } from '@/lib/hooks/file-state-hooks';
import { resolveHomeFolderSync } from '@/lib/mode/path-resolver';
import { selectAugmentedFiles, compressAugmentedFile } from '@/lib/api/file-state';
import RightSidebar from '@/components/RightSidebar';
import type { AppState } from '@/lib/appState';
import StepConnection from './components/StepConnection';
import StepContext from './components/StepContext';
import StepGenerating from './components/StepGenerating';

const TYPEWRITER_SPEED = 35; // ms per character

export function HelloWorldContent() {
  const dispatch = useAppDispatch();
  const router = useRouter();
  const searchParams = useSearchParams();
  const user = useAppSelector(state => state.auth.user);
  const { connections, loading: connectionsLoading } = useConnections({ skip: false });
  const { contexts, loading: contextsLoading } = useContexts({ skip: false });
  const homeFolder = user ? resolveHomeFolderSync(user.mode, user.home_folder || '') : '/org';
  const questionsCriteria = useMemo(
    () => ({ type: 'question' as const, paths: [homeFolder], depth: -1 }),
    [homeFolder]
  );
  const { files: questions, loading: questionsLoading } = useFilesByCriteria({
    criteria: questionsCriteria,
    partial: true,
    skip: false,
  });
  const orb1Ref = useRef<HTMLDivElement>(null);
  const orb2Ref = useRef<HTMLDivElement>(null);
  const orb3Ref = useRef<HTMLDivElement>(null);

  // Build greeting with user name
  const userName = user?.name?.split(' ')[0] || '';
  const greetingLine1 = userName ? `Hi ${userName}!` : 'Hi!';
  const greetingLine2 = "I'm MinusX. Let's get you set up.";
  const fullGreeting = `${greetingLine1}\n${greetingLine2}`;

  // Adapt Redux connections to the { id, name }[] shape used by onboarding-state
  const connectionList = useMemo(() =>
    Object.entries(connections).map(([name]) => ({ id: 0, name })),
    [connections]
  );

  // Only run onboarding detection in org mode
  const effectiveMode = user?.mode || 'org';
  const isOrgMode = effectiveMode === 'org';

  // Determine initial state:
  // - If URL has a step param, validate it against system state (auto-advance if past that step)
  // - If no step param (/hello-world bare), show welcome — don't auto-advance
  // - Only auto-advance in org mode (tutorial mode has its own connections/contexts)
  const initialState = useMemo(() => {
    const urlState = readStateFromURL(searchParams);
    const hasStepParam = !!searchParams.get('step');
    if (!hasStepParam || !isOrgMode) return urlState;
    if (connectionsLoading || contextsLoading || questionsLoading) return urlState;
    const systemState = detectStepFromSystemState(connectionList, contexts, questions);
    // Use whichever is further along (don't go backwards)
    const stepOrder: WizardStep[] = ['welcome', 'connection', 'context', 'generating'];
    const urlIdx = stepOrder.indexOf(urlState.step);
    const sysIdx = stepOrder.indexOf(systemState.step);
    return sysIdx > urlIdx ? systemState : urlState;
  }, [searchParams, connectionList, contexts, questions, connectionsLoading, contextsLoading, questionsLoading, isOrgMode]);

  const [step, setStep] = useState<WizardStep>(initialState.step);
  const [connectionId, setConnectionId] = useState<number | null>(initialState.connectionId);
  const [connectionName, setConnectionName] = useState<string | null>(initialState.connectionName);
  const [contextFileId, setContextFileId] = useState<number | null>(initialState.contextFileId);

  // Push state to URL when it changes
  const pushState = useCallback((newState: OnboardingState) => {
    const params = buildSearchParams(newState);
    const url = params ? `/hello-world?${params}` : '/hello-world';
    router.replace(url);
  }, [router]);

  // Sync state from initialState on first load only.
  // Once the user interacts (clicks connect/back/etc), don't override their navigation.
  const hasUserNavigated = useRef(false);
  const hasSyncedOnce = useRef(false);
  useEffect(() => {
    if (hasUserNavigated.current || hasSyncedOnce.current) return;
    // Only sync if initialState is different from the default welcome state
    if (initialState.step !== 'welcome') {
      hasSyncedOnce.current = true;
      setStep(initialState.step);
      setConnectionId(initialState.connectionId);
      setConnectionName(initialState.connectionName);
      setContextFileId(initialState.contextFileId);
    }
  }, [initialState]);

  // Typewriter state
  const [displayedText, setDisplayedText] = useState('');
  const [typingDone, setTypingDone] = useState(false);
  const [cardsVisible, setCardsVisible] = useState(false);

  // Orb movement
  const moveOrb = useCallback((orb: HTMLDivElement | null, rangeX: number, rangeY: number) => {
    if (!orb) return;
    const x = Math.random() * rangeX * 2 - rangeX;
    const y = Math.random() * rangeY * 2 - rangeY;
    orb.style.transform = `translate(${x}px, ${y}px)`;
  }, []);

  // Collapse sidebar on mount
  useEffect(() => {
    dispatch(setLeftSidebarCollapsed(true));
  }, [dispatch]);

  // Orb intervals
  useEffect(() => {
    const moveOrbs = () => {
      moveOrb(orb1Ref.current, 400, 200);
      moveOrb(orb2Ref.current, 300, 250);
      moveOrb(orb3Ref.current, 350, 200);
    };
    moveOrbs();
    const i1 = setInterval(() => moveOrb(orb1Ref.current, 400, 200), 3000 + Math.random() * 2000);
    const i2 = setInterval(() => moveOrb(orb2Ref.current, 300, 250), 4000 + Math.random() * 2000);
    const i3 = setInterval(() => moveOrb(orb3Ref.current, 350, 200), 3500 + Math.random() * 2000);
    return () => { clearInterval(i1); clearInterval(i2); clearInterval(i3); };
  }, [moveOrb]);

  // Typewriter effect (#1, #2)
  useEffect(() => {
    if (step !== 'welcome') return;
    let i = 0;
    const interval = setInterval(() => {
      i++;
      setDisplayedText(fullGreeting.slice(0, i));
      if (i >= fullGreeting.length) {
        clearInterval(interval);
        setTypingDone(true);
        setTimeout(() => setCardsVisible(true), 300);
      }
    }, TYPEWRITER_SPEED);
    return () => clearInterval(interval);
  }, [step, fullGreeting]);

  // Wizard handlers - push state to URL on each transition (#8)
  const handleConnectionComplete = useCallback((id: number, name: string) => {
    hasUserNavigated.current = true;
    setConnectionId(id);
    setConnectionName(name);
    setStep('context');
    pushState({ step: 'context', connectionId: id, connectionName: name, contextFileId: null });
  }, [pushState]);

  const handleContextComplete = useCallback((fileId: number) => {
    hasUserNavigated.current = true;
    setContextFileId(fileId);
    setStep('generating');
    pushState({ step: 'generating', connectionId, connectionName, contextFileId: fileId });
  }, [pushState, connectionId, connectionName]);

  const handleBack = useCallback(() => {
    hasUserNavigated.current = true;
    if (step === 'connection') {
      setStep('welcome');
      pushState({ step: 'welcome', connectionId: null, connectionName: null, contextFileId: null });
    } else if (step === 'context') {
      setStep('connection');
      pushState({ step: 'connection', connectionId, connectionName, contextFileId: null });
    } else if (step === 'generating') {
      setStep('context');
      pushState({ step: 'context', connectionId, connectionName, contextFileId });
    }
  }, [step, pushState, connectionId, connectionName, contextFileId]);

  const handleStartConnection = useCallback(() => {
    hasUserNavigated.current = true;
    setStep('connection');
    pushState({ step: 'connection', connectionId: null, connectionName: null, contextFileId: null });
  }, [pushState]);

  const handleRequestChat = useCallback((fileId: number) => {
    setContextFileId(fileId);
    // Set navigation to fake a "new context" page so selectAppState resolves to this virtual file.
    // EditFile checks selectAppState → navigation.pathname to verify you're on the right page.
    // Use /new/context with virtualId param so computePathState resolves the virtual file.
    dispatch(setNavigation({ pathname: '/new/context', searchParams: { virtualId: String(fileId) } }));
    dispatch(setActiveVirtualId(fileId));
  }, [dispatch]);

  const isWizard = step !== 'welcome';

  // Load context file into Redux so the agent can see/edit it
  const { fileState: contextFile } = useFile(contextFileId ?? undefined) ?? {};

  // Build appState for RightSidebar using the same pipeline as real file pages
  // (selectAugmentedFiles resolves references, compressAugmentedFile strips fullSchema columns, etc.)
  const reduxState = useAppSelector(state => state);
  const contextAppState: AppState | null = useMemo(() => {
    if (!contextFileId || !contextFile || contextFile.loading) return null;
    const [augmented] = selectAugmentedFiles(reduxState, [contextFileId]);
    if (!augmented) return null;
    return { type: 'file', state: compressAugmentedFile(augmented) };
  }, [contextFileId, contextFile, reduxState]);

  // Split displayed text into lines for rendering (#2)
  const displayedLines = displayedText.split('\n');

  return (
    <Box display="flex" h="100vh" bg="bg.canvas" overflow="hidden">
    {/* Main content area */}
    <Box
      flex="1"
      minW="0"
      minH="100vh"
      display="flex"
      flexDirection="column"
      alignItems="center"
      justifyContent={isWizard ? 'flex-start' : 'center'}
      position="relative"
      overflow={isWizard ? 'auto' : 'hidden'}
      px={4}
      pt={isWizard ? 10 : 0}
    >
      {/* Shared keyframes */}
      <style>{pulseKeyframes}</style>
      <style>{sparkleKeyframes}</style>
      <style>{fadeInUpKeyframes}</style>
      <style>{rotateBorderKeyframes}</style>
      <style>{cursorBlinkKeyframes}</style>

      {/* Background aurora gradients — only on welcome screen */}
      {!isWizard && (
        <Box
          position="absolute"
          inset={0}
          zIndex={0}
          pointerEvents="none"
          css={{
            background: `
              radial-gradient(ellipse 80% 50% at 50% -20%, rgba(22, 160, 133, 0.30), transparent),
              radial-gradient(ellipse 60% 40% at 100% 100%, rgba(22, 160, 133, 0.15), transparent),
              radial-gradient(ellipse 50% 40% at 0% 80%, rgba(22, 160, 133, 0.10), transparent)
            `,
          }}
        />
      )}

      {/* Floating orbs */}
      <Box ref={orb1Ref} className="hw-orb hw-orb-1" position="absolute" w="400px" h="400px" borderRadius="full" bg="accent.teal" opacity={0.12} filter="blur(80px)" zIndex={0} pointerEvents="none" />
      <Box ref={orb2Ref} className="hw-orb hw-orb-2" position="absolute" w="300px" h="300px" borderRadius="full" bg="accent.teal" opacity={0.14} filter="blur(60px)" zIndex={0} pointerEvents="none" />
      <Box ref={orb3Ref} className="hw-orb hw-orb-3" position="absolute" w="250px" h="250px" borderRadius="full" bg="accent.teal" opacity={0.18} filter="blur(70px)" zIndex={0} pointerEvents="none" />

      {/* ─── WELCOME PHASE ─── */}
      {step === 'welcome' && (
        <VStack position="relative" zIndex={1} textAlign="center" maxW="700px" w="100%" gap={0}>
          {/* Agent greeting — fixed height so cards don't shift it (#3) */}
          <VStack gap={4} h="240px" justify="center">
            {/* Sparkle icon */}
            <Box css={{ animation: 'sparkle 2s ease-in-out infinite' }}>
              <Icon as={LuSparkles} boxSize={8} color="accent.teal" />
            </Box>

            {/* Typewriter text — each line separate (#2) */}
            <VStack gap={0}>
              {displayedLines.map((line, idx) => (
                <Heading
                  key={idx}
                  fontSize={{ base: '2xl', md: '4xl' }}
                  fontFamily="mono"
                  fontWeight="400"
                  letterSpacing="-0.02em"
                  lineHeight="1.4"
                >
                  {line}
                  {idx === displayedLines.length - 1 && !typingDone && (
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
              ))}
            </VStack>

            {/* Pulse dots */}
            {!typingDone && (
              <HStack gap={1}>
                <Box w="5px" h="5px" borderRadius="full" bg="accent.teal" css={{ animation: 'pulse 1.4s ease-in-out infinite' }} />
                <Box w="5px" h="5px" borderRadius="full" bg="accent.teal" css={{ animation: 'pulse 1.4s ease-in-out 0.2s infinite' }} />
                <Box w="5px" h="5px" borderRadius="full" bg="accent.teal" css={{ animation: 'pulse 1.4s ease-in-out 0.4s infinite' }} />
              </HStack>
            )}
          </VStack>

          {/* Choice cards — Connect left, Demo right (#4) */}
          <Box minH="200px">
            {cardsVisible && (
              <Flex
                direction={{ base: 'column', md: 'row' }}
                gap={6}
                justifyContent="center"
              >
                {/* Connect Your Data — LEFT (#4) */}
                <Box
                  className="hw-border-card"
                  position="relative"
                  borderRadius="xl"
                  cursor="pointer"
                  transition="transform 0.2s ease-out"
                  onClick={handleStartConnection}
                  _hover={{ transform: 'translateY(-4px)' }}
                  css={{ animation: 'fadeInUp 0.5s ease-out forwards', opacity: 0 }}
                >
                  <Box
                    border="1.5px solid"
                    borderColor="border.default"
                    className="hw-border-card-inner"
                    bg="bg.surface"
                    borderRadius="xl"
                    px={10}
                    py={8}
                    w={{ base: 'full', md: '300px' }}
                    minW="280px"
                    textAlign="center"
                    position="relative"
                    zIndex={1}
                  >
                    <Box display="flex" justifyContent="center" mb={4} color="accent.teal">
                      <LuDatabase size={40} />
                    </Box>
                    <Heading size="lg" fontFamily="mono" fontWeight="500" mb={2}>
                      Connect Your Data
                    </Heading>
                    <Text color="fg.muted" fontSize="sm">
                      Wire up your database and dive in
                    </Text>
                  </Box>
                </Box>

                {/* Try Demo — RIGHT (#4) */}
                <Box
                  className="hw-border-card"
                  position="relative"
                  borderRadius="xl"
                  cursor="pointer"
                  transition="transform 0.2s ease-out"
                  onClick={() => switchMode('tutorial')}
                  _hover={{ transform: 'translateY(-4px)' }}
                  css={{ animation: 'fadeInUp 0.5s ease-out 0.1s forwards', opacity: 0 }}
                >
                  <Box
                    border="1.5px solid"
                    borderColor="border.default"
                    className="hw-border-card-inner"
                    bg="bg.surface"
                    borderRadius="xl"
                    px={10}
                    py={8}
                    w={{ base: 'full', md: '300px' }}
                    minW="280px"
                    textAlign="center"
                    position="relative"
                    zIndex={1}
                  >
                    <Box display="flex" justifyContent="center" mb={4} color="accent.teal">
                      <LuPlay size={40} />
                    </Box>
                    <Heading size="lg" fontFamily="mono" fontWeight="500" mb={2}>
                      Try Demo
                    </Heading>
                    <Text color="fg.muted" fontSize="sm">
                      Explore with sample data — no setup needed
                    </Text>
                  </Box>
                </Box>
              </Flex>
            )}
          </Box>
        </VStack>
      )}

      {/* ─── WIZARD PHASE ─── */}
      {isWizard && (
        <Box position="relative" zIndex={1} w="100%" maxW="1060px" mx="auto">
          {/* Top bar */}
          <Flex
            align="center"
            justify="center"
            mb={6}
            bg="bg.surface"
            border="1px solid"
            borderColor="border.default"
            borderRadius="lg"
            px={5}
            py={3}
            css={{ animation: 'fadeInUp 0.3s ease-out forwards' }}
          >
            {/* Step indicator */}
            <HStack gap={3}>
              {(['connection', 'context', 'generating'] as const).map((s) => {
                const info = STEP_LABELS[s];
                const isActive = s === step;
                const isPast = info.number < STEP_LABELS[step as Exclude<WizardStep, 'welcome'>]?.number;
                return (
                  <HStack key={s} gap={1.5}>
                    <Box
                      w="22px"
                      h="22px"
                      borderRadius="full"
                      display="flex"
                      alignItems="center"
                      justifyContent="center"
                      fontSize="xs"
                      fontFamily="mono"
                      fontWeight="600"
                      border="1.5px solid"
                      borderColor={isActive ? 'accent.teal' : isPast ? 'accent.teal' : 'border.default'}
                      bg={isPast ? 'accent.teal' : 'transparent'}
                      color={isPast ? 'white' : isActive ? 'accent.teal' : 'fg.subtle'}
                      transition="all 0.3s"
                    >
                      {isPast ? <LuCheck size={12} /> : info.number}
                    </Box>
                    <Text
                      fontSize="xs"
                      fontFamily="mono"
                      color={'accent.teal'}
                      fontWeight={isActive ? 800 : 300}
                      display={{ base: 'none', md: 'block' }}
                      transition="color 0.3s"
                    >
                      {info.label}
                    </Text>
                    {s !== 'generating' && (
                      <Box
                        w="24px"
                        h="1px"
                        bg={isPast ? 'accent.teal' : 'border.default'}
                        display={{ base: 'none', md: 'block' }}
                        transition="background 0.3s"
                      />
                    )}
                  </HStack>
                );
              })}
            </HStack>
          </Flex>

          {/* Step content area */}
          <Box
            bg="bg.surface"
            border="1px solid"
            borderColor="border.default"
            borderRadius="xl"
            p={{ base: 6, md: 10 }}
            minH="500px"
            css={{ animation: 'fadeInUp 0.4s ease-out forwards' }}
          >
            {step === 'connection' && (
              <StepConnection onComplete={handleConnectionComplete} />
            )}
            {step === 'context' && connectionName && (
              <StepContext
                connectionName={connectionName}
                connectionId={connectionId!}
                onComplete={handleContextComplete}
                onRequestChat={handleRequestChat}
                onContextCreated={handleRequestChat}
              />
            )}
            {step === 'generating' && connectionName && (
              <StepGenerating
                connectionName={connectionName}
                contextFileId={contextFileId!}
              />
            )}
          </Box>
        </Box>
      )}

      {/* Scoped styles */}
      <style>{`
        .hw-orb {
          transition: transform 4s cubic-bezier(0.25, 0.1, 0.25, 1);
        }
        .hw-orb-1 { top: 10%; left: 15%; }
        .hw-orb-2 { bottom: 20%; right: 10%; }
        .hw-orb-3 { top: 60%; left: 60%; }

        .hw-border-card {
          padding: 2px;
          background: var(--chakra-colors-border-default);
        }
        .hw-border-card::before {
          content: '';
          position: absolute;
          inset: 0;
          border-radius: inherit;
          padding: 2px;
          background: conic-gradient(
            from var(--border-angle),
            rgba(22, 160, 133, 0) 0%,
            rgba(22, 160, 133, 1) 10%,
            rgba(22, 160, 133, 0) 20%
          );
          -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
          mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
          -webkit-mask-composite: xor;
          mask-composite: exclude;
          opacity: 0;
          transition: opacity 0.3s ease;
        }
        .hw-border-card:hover::before {
          opacity: 1;
          animation: rotateBorder 2s linear infinite;
        }
      `}</style>
    </Box>

    {/* RightSidebar — page-level sibling, same as FileLayout */}
    {isWizard && (
      <RightSidebar
        filePath="/org/context"
        fileType="context"
        fileId={contextFileId ?? undefined}
        showChat
        title="Knowledge Base"
        sectionIds={['chat']}
        appStateOverride={contextAppState}
      />
    )}
    </Box>
  );
}
