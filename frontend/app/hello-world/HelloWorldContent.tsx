'use client';

import { useEffect, useRef, useCallback, useState, useMemo } from 'react';
import { Box, Button, Heading, Text, Flex, HStack, Icon, VStack } from '@chakra-ui/react';
import { LuPlay, LuDatabase, LuSparkles, LuCheck } from 'react-icons/lu';
import { useAppDispatch } from '@/store/hooks';
import { useRouter } from '@/lib/navigation/use-navigation';
import { setLeftSidebarCollapsed } from '@/store/uiSlice';
import { setNavigation, setActiveVirtualId } from '@/store/navigationSlice';
import { switchMode, preserveModeParam } from '@/lib/mode/mode-utils';
import {
  pulseKeyframes,
  sparkleKeyframes,
  fadeInUpKeyframes,
  rotateBorderKeyframes,
  cursorBlinkKeyframes,
} from '@/lib/ui/animations';
import {
  type WizardStep,
  STEP_LABELS,
} from './onboarding-state';
import StepConnection from './components/StepConnection';
import StepContext from './components/StepContext';
import StepGenerating from './components/StepGenerating';
import StepComplete from './components/StepComplete';
import { useConfigs, updateConfig } from '@/lib/hooks/useConfigs';
import { useFilesByCriteria } from '@/lib/hooks/file-state-hooks';
import { useAppSelector } from '@/store/hooks';

const TYPEWRITER_SPEED = 35; // ms per character

export function HelloWorldContent() {
  const dispatch = useAppDispatch();
  const router = useRouter();
  const user = useAppSelector(state => state.auth.user);

  const { config } = useConfigs();
  const connectionCriteria = useMemo(() => ({ type: 'connection' as const }), []);
  const { files: connectionFiles } = useFilesByCriteria({ criteria: connectionCriteria, partial: true });
  const hasConnections = connectionFiles.some(f => (f.id as number) > 0);

  const agentName = config.branding.agentName;
  const userName = user?.name?.split(' ')[0] || '';
  const greetingLine1 = userName ? `Hi ${userName}!` : 'Hi!';
  const greetingLine2 = `I'm ${agentName}. Let's get you set up.`;
  const fullGreeting = `${greetingLine1}\n${greetingLine2}`;

  const orb1Ref = useRef<HTMLDivElement>(null);
  const orb2Ref = useRef<HTMLDivElement>(null);
  const orb3Ref = useRef<HTMLDivElement>(null);

  // Wizard step — initialized from config (persisted across refreshes), then managed locally
  const savedWizard = config.setupWizard;
  const isComplete = savedWizard?.status === 'complete';
  const [step, setStep] = useState<WizardStep>(() => savedWizard?.step ?? 'welcome');
  const [connectionId, setConnectionId] = useState<number | null>(() => savedWizard?.connectionId ?? null);
  const [connectionName, setConnectionName] = useState<string | null>(() => savedWizard?.connectionName ?? null);
  const [contextFileId, setContextFileId] = useState<number | null>(() => savedWizard?.contextFileId ?? null);

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

  // Typewriter effect
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

  // Persist wizard step to config so it survives page refresh
  const persistStep = useCallback(async (
    nextStep: WizardStep,
    extras?: { connectionId?: number; connectionName?: string; contextFileId?: number }
  ) => {
    try {
      await updateConfig({
        setupWizard: { status: 'pending', step: nextStep, ...extras },
      });
    } catch (err) {
      console.error('[HelloWorldContent] Failed to persist wizard step:', err);
    }
  }, []);

  // Mark wizard complete in config — called by StepGenerating before navigating away
  const handleComplete = useCallback(async () => {
    try {
      await updateConfig({ setupWizard: { status: 'complete' } });
    } catch (err) {
      console.error('[HelloWorldContent] Failed to mark onboarding complete:', err);
      // Don't block navigation
    }
  }, []);

  // Wizard transition handlers
  const handleConnectionComplete = useCallback((id: number, name: string) => {
    setConnectionId(id);
    setConnectionName(name);
    setStep('context');
    persistStep('context', { connectionId: id, connectionName: name });
  }, [persistStep]);

  const handleContextComplete = useCallback((fileId: number) => {
    setContextFileId(fileId);
    setStep('generating');
    persistStep('generating', { connectionId: connectionId ?? undefined, connectionName: connectionName ?? undefined, contextFileId: fileId });
  }, [persistStep, connectionId, connectionName]);

  const handleStartConnection = useCallback(() => {
    setStep('connection');
    persistStep('connection');
  }, [persistStep]);

  const handleSkipToHome = useCallback(async () => {
    await handleComplete();
    router.replace(preserveModeParam('/'));
  }, [handleComplete, router]);

  // Skip Step 1 by reusing the first existing connection → advance to Step 2
  const handleSkipConnection = useCallback(() => {
    const first = connectionFiles[0];
    if (!first) return;
    handleConnectionComplete(first.id as number, first.name);
  }, [connectionFiles, handleConnectionComplete]);


  const handleRequestChat = useCallback((fileId: number) => {
    setContextFileId(fileId);
    dispatch(setNavigation({ pathname: '/new/context', searchParams: { virtualId: String(fileId) } }));
    dispatch(setActiveVirtualId(fileId));
  }, [dispatch]);

  const isWizard = step !== 'welcome' || isComplete;

  // Split displayed text into lines for rendering
  const displayedLines = displayedText.split('\n');

  return (
    <Box
      minH="100vh"
      display="flex"
      flexDirection="column"
      alignItems="center"
      justifyContent={isWizard ? 'flex-start' : 'center'}
      bg="bg.canvas"
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

      {/* ─── Skip Setup Button (visible on all non-complete phases) ─── */}
      {!isComplete && (
        <Button
          position="absolute"
          top={4}
          right={6}
          zIndex={2}
          size="sm"
          variant="solid"
          bg="accent.teal"
          color="white"
          fontFamily="mono"
          _hover={{ opacity: 0.9 }}
          onClick={handleSkipToHome}
        >
          Skip Setup →
        </Button>
      )}

      {/* ─── WELCOME PHASE ─── */}
      {step === 'welcome' && !isComplete && (
        <VStack position="relative" zIndex={1} textAlign="center" maxW="700px" w="100%" gap={0}>
          {/* Agent greeting — fixed height so cards don't shift it */}
          <VStack gap={4} h="240px" justify="center">
            {/* Sparkle icon */}
            <Box css={{ animation: 'sparkle 2s ease-in-out infinite' }}>
              <Icon as={LuSparkles} boxSize={8} color="accent.teal" />
            </Box>

            {/* Typewriter text — each line separate */}
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

          {/* Choice cards — Connect left, Demo right */}
          <Box minH="200px">
            {cardsVisible && hasConnections && (
              <Text
                fontSize="sm"
                color="fg.muted"
                fontFamily="mono"
                mb={4}
                cursor="pointer"
                textDecoration="underline"
                _hover={{ color: 'fg.default' }}
                onClick={handleSkipConnection}
                css={{ animation: 'fadeInUp 0.5s ease-out forwards', opacity: 0 }}
              >
                I've already connected my data →
              </Text>
            )}
            {cardsVisible && (
              <Flex
                direction={{ base: 'column', md: 'row' }}
                gap={6}
                justifyContent="center"
              >
                {/* Connect Your Data — LEFT */}
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

                {/* Try Demo — RIGHT */}
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

      {/* ─── COMPLETE PHASE ─── */}
      {isComplete && (
        <Box position="relative" zIndex={1} w="100%" maxW="1060px" mx="auto">
          <Box
            bg="bg.surface"
            border="1px solid"
            borderColor="border.default"
            borderRadius="xl"
            p={{ base: 6, md: 10 }}
            css={{ animation: 'fadeInUp 0.4s ease-out forwards' }}
          >
            <StepComplete />
          </Box>
        </Box>
      )}

      {/* ─── WIZARD PHASE ─── */}
      {isWizard && !isComplete && (
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
              <>
                <StepConnection onComplete={handleConnectionComplete} greeting={`Step 1: Let's connect your data.`} />
                {hasConnections && (
                  <Text
                    mt={4}
                    fontSize="sm"
                    color="fg.muted"
                    fontFamily="mono"
                    cursor="pointer"
                    textDecoration="underline"
                    _hover={{ color: 'fg.default' }}
                    onClick={handleSkipConnection}
                  >
                    I've already connected my data →
                  </Text>
                )}
              </>
            )}
            {step === 'context' && connectionName && (
              <StepContext
                connectionName={connectionName}
                connectionId={connectionId!}
                onComplete={handleContextComplete}
                onRequestChat={handleRequestChat}
                onContextCreated={handleRequestChat}
                greeting="Step 2: Let's add some context."
              />
            )}
            {step === 'generating' && connectionName && (
              <StepGenerating
                connectionName={connectionName}
                contextFileId={contextFileId!}
                greeting="Step 3: Let's build your first dashboard."
                onComplete={handleComplete}
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
  );
}
