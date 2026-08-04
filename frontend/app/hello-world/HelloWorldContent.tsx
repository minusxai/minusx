'use client';

import { useEffect, useRef, useCallback, useState, useMemo } from 'react';
import { Box, Button, Heading, Text, Flex, HStack, Icon, VStack } from '@chakra-ui/react';
import { LuPlay, LuDatabase, LuSparkles } from 'react-icons/lu';
import { useAppDispatch } from '@/store/hooks';
import { setLeftSidebarCollapsed } from '@/store/uiSlice';
import { switchMode } from '@/lib/mode/mode-utils';
import { hasUsableLlmProvider } from '@/lib/llm/llm-config-types';
import {
  pulseKeyframes,
  sparkleKeyframes,
  fadeInUpKeyframes,
  rotateBorderKeyframes,
  cursorBlinkKeyframes,
} from '@/lib/ui/animations';
import { useTypewriter } from '@/lib/ui/use-typewriter';
import { type WizardStep } from './onboarding-state';
import StepComplete from './components/StepComplete';
import { useConfigs, updateConfig } from '@/lib/hooks/useConfigs';
import { useFilesByCriteria } from '@/lib/hooks/file-state-hooks';
import { useAppSelector } from '@/store/hooks';
import ConnectionWizard from '@/components/connection-wizard/ConnectionWizard';
import { asWizardStep, type ConnectionWizardStep, type QuestionnaireAnswers } from '@/components/connection-wizard/ConnectionWizardTypes';


export function HelloWorldContent() {
  const dispatch = useAppDispatch();
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
  /**
   * A step this component FORCES the wizard onto, overriding both its mounted state and the
   * persisted one. ConnectionWizard seeds its step with `useState(initialStep)`, so a changed prop
   * is ignored once mounted; and `persistStep` is async, so a remount keyed off config would race
   * the write and re-read the step we are trying to leave. Only the completion guard uses this —
   * without it, a refused completion left the user on the screen they had just tried to leave with
   * the button apparently doing nothing.
   */
  const [forcedStep, setForcedStep] = useState<ConnectionWizardStep | null>(null);

  // Only the welcome screen types; the wizard steps run their own headings.
  const { displayed: displayedText, done: typingDone } = useTypewriter(
    step === 'welcome' ? fullGreeting : undefined
  );
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

  // The action cards fade in a beat after the greeting lands — including when the user cuts the
  // typing short, which is the whole point of being able to.
  useEffect(() => {
    if (step !== 'welcome' || !typingDone) return;
    const t = setTimeout(() => setCardsVisible(true), 300);
    return () => clearTimeout(t);
  }, [step, typingDone]);

  // Persist wizard step to config so it survives page refresh
  const persistStep = useCallback(async (
    nextStep: ConnectionWizardStep,
    extras?: { connectionId?: number; connectionName?: string; contextFileId?: number; questionnaireAnswers?: QuestionnaireAnswers }
  ) => {
    try {
      await updateConfig({
        setupWizard: { status: 'pending', step: nextStep, ...extras },
      });
    } catch (err) {
      console.error('[HelloWorldContent] Failed to persist wizard step:', err);
    }
  }, []);

  // Mark wizard complete in config.
  //
  // The no-usable-provider guard lives HERE, not in a caller. Only a workspace that can
  // actually run the agent counts as SET UP, and completion is also what stops the wizard
  // being offered — so completing without a provider leaves a "You're all set!" screen over
  // a workspace with no route back to the step that fixes it.
  //
  // It sat in `handleSkipToHome` alone while this function was handed to ConnectionWizard as
  // `onComplete`, which the wizard calls from the step-indicator Skip, StepSlack, StepContext
  // and StepGenerating. Every one of those walked past the guard. A guard in one caller is a
  // guard the next caller forgets; in the completion path itself the bypass is unrepresentable.
  const handleComplete = useCallback(async () => {
    if (!hasUsableLlmProvider(config.llm)) {
      setForcedStep('models');
      setStep('models');
      persistStep('models');
      return;
    }
    try {
      await updateConfig({ setupWizard: { status: 'complete' } });
    } catch (err) {
      console.error('[HelloWorldContent] Failed to mark onboarding complete:', err);
    }
  }, [config.llm, persistStep]);

  // Show the AI-model step until a provider can actually AUTHENTICATE. Testing for a provider
  // ENTRY instead is what let a credential-less row hide this step: `Add provider` writes a
  // `minusx` row, an install with no gateway secret never receives a key for it, and the one
  // step that could fix that stopped being offered. Captured once at mount so the step doesn't
  // vanish from the indicator mid-wizard after the user saves a provider inside it.
  const [includeModelsStep] = useState(() => !hasUsableLlmProvider(config.llm));

  const handleStartConnection = useCallback(() => {
    setForcedStep(null);
    const first = includeModelsStep ? 'models' : 'connection';
    setStep(first);
    persistStep(first);
  }, [persistStep, includeModelsStep]);

  // "Skip Setup" is now just completion — the provider guard it used to carry moved into
  // `handleComplete`, where every other exit from the wizard passes through it too.
  const handleSkipToHome = useCallback(async () => {
    try {
      await handleComplete();
    } catch (err) {
      console.error('[HelloWorldContent] Skip setup failed to mark complete:', err);
    }
  }, [handleComplete]);

  // Skip Step 1 by reusing the first existing connection
  const handleSkipConnection = useCallback(() => {
    const first = connectionFiles[0];
    if (!first) return;
    setStep('connection'); // triggers wizard render, which will immediately skip via initialStep
    persistStep('context', { connectionId: first.id as number, connectionName: first.name });
  }, [connectionFiles, persistStep]);

  const isWizard = step !== 'welcome' || isComplete;
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
      <Box ref={orb1Ref} className="hw-orb hw-orb-1" position="absolute" w={{ base: '200px', md: '400px' }} h={{ base: '200px', md: '400px' }} borderRadius="full" bg="accent.teal" opacity={0.12} filter="blur(80px)" zIndex={0} pointerEvents="none" />
      <Box ref={orb2Ref} className="hw-orb hw-orb-2" position="absolute" w={{ base: '160px', md: '300px' }} h={{ base: '160px', md: '300px' }} borderRadius="full" bg="accent.teal" opacity={0.14} filter="blur(60px)" zIndex={0} pointerEvents="none" />
      <Box ref={orb3Ref} className="hw-orb hw-orb-3" position="absolute" w={{ base: '140px', md: '250px' }} h={{ base: '140px', md: '250px' }} borderRadius="full" bg="accent.teal" opacity={0.18} filter="blur(70px)" zIndex={0} pointerEvents="none" />

      {/* Skip Setup Button */}
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
          aria-label="Skip setup"
          onClick={handleSkipToHome}
        >
          Skip Setup &rarr;
        </Button>
      )}

      {/* WELCOME PHASE */}
      {step === 'welcome' && !isComplete && (
        <VStack position="relative" zIndex={1} textAlign="center" maxW="700px" w="100%" gap={0}>
          <VStack gap={4} h="240px" justify="center">
            <Box css={{ animation: 'sparkle 2s ease-in-out infinite' }}>
              <Icon as={LuSparkles} boxSize={8} color="accent.teal" />
            </Box>
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
            {!typingDone && (
              <HStack gap={1}>
                <Box w="5px" h="5px" borderRadius="full" bg="accent.teal" css={{ animation: 'pulse 1.4s ease-in-out infinite' }} />
                <Box w="5px" h="5px" borderRadius="full" bg="accent.teal" css={{ animation: 'pulse 1.4s ease-in-out 0.2s infinite' }} />
                <Box w="5px" h="5px" borderRadius="full" bg="accent.teal" css={{ animation: 'pulse 1.4s ease-in-out 0.4s infinite' }} />
              </HStack>
            )}
          </VStack>

          <Box minH="200px">
            {cardsVisible && (
              <Flex
                direction={{ base: 'column', md: 'row' }}
                gap={6}
                justifyContent="center"
              >
                <Box
                  className="hw-border-card"
                  position="relative"
                  borderRadius="xl"
                  cursor="pointer"
                  transition="transform 0.2s ease-out"
                  aria-label="Connect your data"
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
                    minW={{ base: 'auto', md: '280px' }}
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
                      Wire up your data and dive straight in
                    </Text>
                  </Box>
                </Box>

                <Box
                  className="hw-border-card"
                  position="relative"
                  borderRadius="xl"
                  cursor="pointer"
                  transition="transform 0.2s ease-out"
                  aria-label="Try demo"
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
                    minW={{ base: 'auto', md: '280px' }}
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
                      Explore all features with included sample data
                    </Text>
                  </Box>
                </Box>
              </Flex>
            )}
          </Box>
        </VStack>
      )}

      {/* COMPLETE PHASE */}
      {isComplete && (
        <Box position="relative" zIndex={1} w="100%" maxW="1060px" mx="auto">
          <Box
            bg="bg.surface"
            border="1px solid"
            borderColor="border.default"
            borderRadius="xl"
            p={{ base: 4, md: 10 }}
            css={{ animation: 'fadeInUp 0.4s ease-out forwards' }}
          >
            <StepComplete />
          </Box>
        </Box>
      )}

      {/* WIZARD PHASE */}
      {isWizard && !isComplete && (
        <Box position="relative" zIndex={1} w="100%" maxW="1060px" mx="auto">
          <ConnectionWizard
            // Keyed so a step this component FORCES actually takes effect. ConnectionWizard seeds
            // its own step with `useState(initialStep)`, so once mounted a changed prop is ignored
            // — the completion guard could write `step: 'models'` and leave the user staring at the
            // screen they just tried to leave, with the button apparently doing nothing. `step`
            // only changes on the three jumps this component owns (start, skip-connection, guard),
            // never on ordinary wizard progression, so this remounts exactly when it should.
            key={forcedStep ?? 'wizard'}
            initialStep={forcedStep ?? asWizardStep(savedWizard?.step) ?? (includeModelsStep ? 'models' : 'connection')}
            initialConnectionId={savedWizard?.connectionId}
            initialConnectionName={savedWizard?.connectionName}
            initialContextFileId={savedWizard?.contextFileId}
            initialQuestionnaireAnswers={savedWizard?.questionnaireAnswers}
            onStepChange={persistStep}
            onComplete={handleComplete}
            showGreetings
            showSkipConnection
            showSlackStep
            showModelsStep={includeModelsStep}
            // Unnumbered on purpose. The step indicator numbers the steps, and it numbers them
            // DYNAMICALLY — the AI-model step is only present when no provider can authenticate, so
            // any number written into a heading here is wrong in one of the two configurations. It
            // was wrong in both: every heading ran one behind the bar above it.
            greetings={{
              models: 'Connect an AI model.',
              connection: "Let's connect your data.",
              questionnaire: "Tell us about your data.",
              context: "Let's create a Knowledge Base.",
              generating: "Let's build your first dashboard.",
              slack: "Connect Slack.",
            }}
          />
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
