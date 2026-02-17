'use client';

/**
 * GettingStartedV2 Component
 * Progressive onboarding banner that guides users through setup steps
 * Shows as a banner when folder has files, or as centered empty state when folder is empty
 */

import { useMemo, useState, useEffect } from 'react';
import { Box, HStack, VStack, Text, Button, Icon, Spinner, Progress } from '@chakra-ui/react';
import NextLink from 'next/link';
import {
  LuDatabase,
  LuNotebookText,
  LuScanSearch,
  LuLayoutDashboard,
  LuFolderOpen,
  LuPlus,
  LuSparkles,
  LuRocket,
} from 'react-icons/lu';
import type { IconType } from 'react-icons';
import { useAppSelector, useAppDispatch } from '@/store/hooks';
import { useConnections } from '@/lib/hooks/useConnections';
import { useContexts } from '@/lib/hooks/useContexts';
import { useFilesByCriteria } from '@/lib/hooks/useFilesByCriteria';
import { useConfigs } from '@/lib/hooks/useConfigs';
import { resolveHomeFolderSync, SYSTEM_FOLDERS, resolvePath } from '@/lib/mode/path-resolver';
import { DEFAULT_MODE } from '@/lib/mode/mode-types';
import { switchMode } from '@/lib/mode/mode-utils';
import {
  setSidebarPendingMessage,
  setActiveSidebarSection,
  setRightSidebarCollapsed
} from '@/store/uiSlice';

interface OnboardingEmptyState {
  message: string;
  description: string;
  icon?: IconType;
  useLogo?: boolean;  // Use MinusX logo instead of icon
  cta: { label: string; href?: string; onClick?: () => void };
  secondaryAction?: { label: string; onClick: () => void };  // Optional secondary link
  step: number;  // Current step (1-based)
  totalSteps: number;  // Total onboarding steps
}

interface GettingStartedV2Props {
  /** Render as banner (above files) or empty state (centered) */
  variant: 'banner' | 'empty';
  /** Fallback content when onboarding is complete (only for empty variant) */
  fallback?: React.ReactNode;
}

/**
 * Hook to check onboarding state for progressive empty states
 */
function useOnboardingState() {
  const user = useAppSelector(state => state.auth.user);
  const mode = user?.mode || DEFAULT_MODE;
  const homeFolder = user
    ? resolveHomeFolderSync(mode, user.home_folder || '')
    : '/org';

  const { connections, loading: connLoading } = useConnections({ skip: false });
  const { contexts, loading: ctxLoading } = useContexts({ skip: false });

  // Query for questions globally (partial load for speed)
  const questionsCriteria = useMemo(
    () => ({ type: 'question' as const, paths: [homeFolder], depth: -1 }),
    [homeFolder]
  );
  const { files: questions, loading: qLoading } = useFilesByCriteria({
    criteria: questionsCriteria,
    partial: true,
    skip: false
  });

  // Query for dashboards globally (partial load for speed)
  const dashboardsCriteria = useMemo(
    () => ({ type: 'dashboard' as const, paths: [homeFolder], depth: -1 }),
    [homeFolder]
  );
  const { files: dashboards, loading: dLoading } = useFilesByCriteria({
    criteria: dashboardsCriteria,
    partial: true,
    skip: false
  });

  // Query for conversations (to check if user has chatted)
  const conversationsPath = resolvePath(mode, SYSTEM_FOLDERS.logsConversations);
  const conversationsCriteria = useMemo(
    () => ({ type: 'conversation' as const, paths: [conversationsPath], depth: -1 }),
    [conversationsPath]
  );
  const { files: conversations, loading: convLoading } = useFilesByCriteria({
    criteria: conversationsCriteria,
    partial: true,
    skip: false
  });

  return {
    zeroConversations: conversations.length === 0,
    oneConversation: conversations.length === 1,
    hasConnections: Object.keys(connections).length > 0,
    hasContexts: contexts.length > 0,
    hasQuestions: questions.length > 0,
    hasDashboards: dashboards.length > 0,
    loading: connLoading || ctxLoading || qLoading || dLoading || convLoading
  };
}

/**
 * Get progressive onboarding empty state based on what's missing
 */
const TOTAL_ONBOARDING_STEPS = 6;

function getOnboardingEmptyState(
  zeroConversations: boolean,
  oneConversation: boolean,
  hasConnections: boolean,
  hasContexts: boolean,
  hasQuestions: boolean,
  hasDashboards: boolean,
  agentName: string,
  onAskAI: () => void
): OnboardingEmptyState | null {
  if (zeroConversations) {
    return {
      message: `Welcome to ${agentName}!`,
      description: `Let's find out what ${agentName} can do`,
      useLogo: true,
      cta: { label: 'What all can you do?', onClick: onAskAI },
      step: 1,
      totalSteps: TOTAL_ONBOARDING_STEPS
    };
  }
  if (!hasConnections) {
    return {
      message: 'Your data is waiting!',
      description: 'Connect a database and let\'s explore together',
      icon: LuDatabase,
      cta: { label: 'Add Connection', href: '/new/connection' },
      secondaryAction: { label: 'or try demo mode', onClick: () => switchMode('tutorial') },
      step: 2,
      totalSteps: TOTAL_ONBOARDING_STEPS
    };
  }
  if (!hasQuestions) {
    return {
      message: 'Time for Questions!',
      description: 'Your data has stories to tell',
      icon: LuScanSearch,
      cta: { label: 'New Question', href: '/new/question' },
      step: 3,
      totalSteps: TOTAL_ONBOARDING_STEPS
    };
  }
  if (!hasContexts) {
    return {
      message: `Teach ${agentName} about your data`,
      description: 'Select relevant tables; add business specific context',
      icon: LuNotebookText,
      cta: { label: 'Add Knowledge Base', href: '/new/context' },
      step: 4,
      totalSteps: TOTAL_ONBOARDING_STEPS
    };
  }
  if (!hasDashboards) {
    return {
      message: 'Let\'s set up a dashboard?',
      description: 'Bring your questions together in one view',
      icon: LuLayoutDashboard,
      cta: { label: 'New Dashboard', href: '/new/dashboard' },
      step: 5,
      totalSteps: TOTAL_ONBOARDING_STEPS
    };
  }
  if (oneConversation) {
    return {
      message: 'Deep Exploration Awaits!',
      description: 'Free form space to explore your data and ideate with the agent',
        icon: LuRocket,
        cta: { label: 'Start Exploring', href: '/explore' },
        step: 6,
        totalSteps: TOTAL_ONBOARDING_STEPS
    };
  }
  return null; // All onboarding complete
}

export default function GettingStartedV2({ variant, fallback }: GettingStartedV2Props) {
  const dispatch = useAppDispatch();
  const { config } = useConfigs();
  const agentName = config.branding.agentName;

  // Track if user clicked "Ask AI" locally (will be correct on next refresh)
  const [hasAskedAI, setHasAskedAI] = useState(false);

  // Track if component has mounted (prevents flash during hydration)
  const [hasMounted, setHasMounted] = useState(false);

  const onboardingState = useOnboardingState();
  const {
    zeroConversations,
    oneConversation,
    hasConnections,
    hasContexts,
    hasQuestions,
    hasDashboards,
    loading
  } = onboardingState;

  // Only show component after mount + data has loaded
  useEffect(() => {
    if (!loading) {
      // Small delay to ensure data has stabilized after hydration
      const timer = setTimeout(() => setHasMounted(true), 500);
      return () => clearTimeout(timer);
    }
  }, [loading]);

  // Handle "Ask AI" action - opens side chat with message
  const handleAskAI = () => {
    setHasAskedAI(true);  // Mark as done locally
    dispatch(setSidebarPendingMessage('What all can you do?'));
    dispatch(setActiveSidebarSection('chat'));
    dispatch(setRightSidebarCollapsed(false));
  };

  // Don't show anything until mounted and data loaded (prevents flash)
  if (!hasMounted) {
    if (variant === 'empty') {
      return (
        <Box display="flex" alignItems="center" justifyContent="center" minH="60vh">
          <Spinner size="lg" colorScheme="blue" />
        </Box>
      );
    }
    return null; // Don't show banner until mounted
  }

  const progressiveState = getOnboardingEmptyState(
    zeroConversations,
    oneConversation,
    hasConnections,
    hasContexts,
    hasQuestions,
    hasDashboards,
    agentName,
    handleAskAI
  );

  // All onboarding complete - render fallback if provided
  if (!progressiveState) {
    return fallback ? <>{fallback}</> : null;
  }

  // Banner variant - horizontal layout above files
  if (variant === 'banner') {
    return (
      <Box
        display="flex"
        alignItems="center"
        justifyContent="space-between"
        bg="bg.subtle"
        border="1px solid"
        borderColor="border.muted"
        borderRadius="lg"
        px={5}
        py={4}
        mb={6}
      >
        <HStack gap={4}>
          {progressiveState.useLogo ? (
            <Box
                aria-label="Company logo"
                role="img"
                width={16}
                height={16}
                flexShrink={0}
              />
          ) : (
            <Box as={progressiveState.icon} fontSize="2xl" color="fg.muted" />
          )}
          <Box>
            <Text fontSize="md" fontWeight="600" color="fg.default" fontFamily="mono">
              {progressiveState.message}
            </Text>
            <Text fontSize="sm" color="fg.muted">
              {progressiveState.description}
            </Text>
          </Box>
        </HStack>
        <VStack gap={2} alignItems="flex-end">
          <HStack gap={3}>
            {progressiveState.cta.href ? (
              <Button
                asChild
                bg="accent.teal"
                color="white"
                size="sm"
                fontWeight="600"
                _hover={{ opacity: 0.9 }}
                gap={2}
              >
                <NextLink href={progressiveState.cta.href}>
                  <Icon as={LuPlus} />
                  {progressiveState.cta.label}
                </NextLink>
              </Button>
            ) : (
              <Button
                bg="accent.teal"
                color="white"
                size="sm"
                fontWeight="600"
                _hover={{ opacity: 0.9 }}
                gap={2}
                onClick={progressiveState.cta.onClick}
              >
                <Icon as={LuSparkles} />
                {progressiveState.cta.label}
              </Button>
            )}
            {progressiveState.secondaryAction && (
              <Text
                fontSize="sm"
                cursor="pointer"
                textDecoration="underline"
                color="accent.teal"
                onClick={progressiveState.secondaryAction.onClick}
              >
                {progressiveState.secondaryAction.label}
              </Text>
            )}
          </HStack>
          {/* Progress indicator */}
          <HStack gap={2} w="100%" justifyContent="flex-end">
            <Progress.Root
              value={progressiveState.step}
              max={progressiveState.totalSteps}
              size="xs"
              colorPalette="teal"
              w="80px"
            >
              <Progress.Track bg="bg.muted">
                <Progress.Range />
              </Progress.Track>
            </Progress.Root>
            <Text fontSize="2xs" color="fg.muted" fontFamily="mono">
            step  {progressiveState.step}/{progressiveState.totalSteps}
            </Text>
          </HStack>
        </VStack>
      </Box>
    );
  }

  // Empty variant - centered layout for empty folders
  return (
    <Box
      display="flex"
      flexDirection="column"
      alignItems="center"
      justifyContent="center"
      minH="60vh"
      px={8}
    >
      {progressiveState.useLogo ? (
        <Box mb={4} opacity={0.8}>
          <Box
            aria-label="Company logo"
            role="img"
            width={16}
            height={16}
            flexShrink={0}
          />
        </Box>
      ) : (
        <Box
          as={progressiveState.icon}
          fontSize="5xl"
          color="fg.muted"
          opacity={0.3}
          mb={3}
        />
      )}
      <Text fontSize="md" color="fg.muted" fontWeight="500" fontFamily="mono" mb={4}>
        {progressiveState.message}
      </Text>
      <HStack gap={3}>
        {progressiveState.cta.href ? (
          <Button
            asChild
            bg="accent.teal"
            color="white"
            size="sm"
            fontWeight="600"
            _hover={{ opacity: 0.9 }}
            gap={2}
          >
            <NextLink href={progressiveState.cta.href}>
              <Icon as={LuPlus} />
              {progressiveState.cta.label}
            </NextLink>
          </Button>
        ) : (
          <Button
            bg="accent.teal"
            color="white"
            size="sm"
            fontWeight="600"
            _hover={{ opacity: 0.9 }}
            gap={2}
            onClick={progressiveState.cta.onClick}
          >
            <Icon as={LuSparkles} />
            {progressiveState.cta.label}
          </Button>
        )}
        {progressiveState.secondaryAction && (
          <Text
            fontSize="sm"
            cursor="pointer"
            color="accent.teal"
            textDecoration="underline"
            _hover={{ opacity: 0.8 }}
            onClick={progressiveState.secondaryAction.onClick}
          >
            {progressiveState.secondaryAction.label}
          </Text>
        )}
      </HStack>
      {/* Progress bar */}
      <VStack gap={1} mt={6} w="120px">
        <Progress.Root
          value={progressiveState.step}
          max={progressiveState.totalSteps}
          size="xs"
          colorPalette="teal"
          w="100%"
        >
          <Progress.Track bg="bg.muted">
            <Progress.Range />
          </Progress.Track>
        </Progress.Root>
        <Text fontSize="2xs" color="fg.subtle" fontFamily="mono">
          {progressiveState.step} of {progressiveState.totalSteps}
        </Text>
      </VStack>
    </Box>
  );
}

/**
 * Default empty state when all onboarding is complete
 * Used by FolderView for empty subfolders
 */
export function DefaultEmptyState({ currentPath }: { currentPath: string }) {
  // Import CreateMenu dynamically to avoid circular deps
  const CreateMenu = require('./CreateMenu').default;

  return (
    <Box
      display="flex"
      flexDirection="column"
      alignItems="center"
      justifyContent="center"
      minH="60vh"
      px={8}
    >
      <Box
        as={LuFolderOpen}
        fontSize="6xl"
        color="fg.muted"
        opacity={0.4}
        mb={4}
      />
      <Text fontSize="lg" color="fg.muted" fontWeight="500" fontFamily="mono">
        Nothing here yet
      </Text>
      <Text fontSize="sm" color="fg.muted" opacity={0.7} mt={2} mb={6}>
        Create something awesome
      </Text>
      <CreateMenu currentPath={currentPath} variant="button" />
    </Box>
  );
}
