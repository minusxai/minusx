'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { Box, VStack, HStack, Text, Heading, Button, Icon, Collapsible } from '@chakra-ui/react';
import { LuSparkles, LuRocket, LuLayoutDashboard, LuChevronDown, LuChevronRight } from 'react-icons/lu';
import { useRouter } from '@/lib/navigation/use-navigation';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import { createConversation, selectActiveConversation, selectConversation } from '@/store/chatSlice';
import { setNavigation, setActiveVirtualId } from '@/store/navigationSlice';
import { createVirtualFile, editFile, publishAll, selectAugmentedFiles, compressAugmentedFile } from '@/lib/api/file-state';
import { getStore } from '@/store/store';
import { useFile } from '@/lib/hooks/file-state-hooks';
import { sparkleKeyframes, pulseKeyframes } from '@/lib/ui/animations';
import { useContext } from '@/lib/hooks/useContext';
import ChatInterface from '@/components/explore/ChatInterface';
import type { CompletedToolCall } from '@/lib/types';

const DASHBOARD_PROMPT = `You are on an empty dashboard page. Add 3-4 interesting questions to this dashboard that showcase different aspects of the data.
Use varied visualization types (line, bar, pie, table).
Cover different analysis angles: trends over time, distributions, breakdowns by category.
Use the EditDashboard tool to add questions directly to this dashboard.`;

interface StepGeneratingProps {
  connectionName: string;
  contextFileId: number;
}

export default function StepGenerating({ connectionName, contextFileId }: StepGeneratingProps) {
  const router = useRouter();
  const dispatch = useAppDispatch();
  const reduxState = useAppSelector(state => state);
  const devMode = useAppSelector(state => state.ui.devMode);

  // Load context (schema + docs) from the saved context file
  const contextInfo = useContext('/org/context');
  const { databases, documentation: contextDocs } = contextInfo;

  const [isGenerating, setIsGenerating] = useState(false);
  const [hasStarted, setHasStarted] = useState(false);
  const [virtualDashboardId, setVirtualDashboardId] = useState<number | null>(null);
  const [showTrace, setShowTrace] = useState(false);

  // Create virtual dashboard file on mount
  const hasCreatedVirtual = useRef(false);
  useEffect(() => {
    if (hasCreatedVirtual.current || virtualDashboardId) return;
    hasCreatedVirtual.current = true;

    createVirtualFile('dashboard').then((vId) => {
      // Set empty dashboard content
      editFile({
        fileId: vId,
        changes: {
          content: {
            description: '',
            assets: [],
            layout: [],
          },
          name: 'Getting Started',
          path: '/org/Getting Started',
        },
      });
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

  const handleGenerate = useCallback(() => {
    if (hasStarted || !virtualDashboardId) return;
    setHasStarted(true);

    // Build appState from the virtual dashboard file
    let appState = null;
    const [augmented] = selectAugmentedFiles(reduxState, [virtualDashboardId]);
    if (augmented) {
      appState = { type: 'file' as const, state: compressAugmentedFile(augmented) };
    }

    // Build simplified schema from context (same as ChatInterface)
    const selectedDb = databases.find(d => d.databaseName === connectionName) || databases[0];
    const simplifiedSchema = selectedDb?.schemas?.map(s => ({
      schema: s.schema,
      tables: s.tables.map(t => t.table)
    })) || [];

    dispatch(createConversation({
      conversationID: -Date.now(),
      agent: 'AnalystAgent',
      agent_args: {
        connection_id: connectionName,
        context_path: '/org/context',
        context_version: null,
        schema: simplifiedSchema,
        context: contextDocs || '',
        app_state: appState,
      },
      message: DASHBOARD_PROMPT,
    }));

    setIsGenerating(true);
    setShowTrace(true);
  }, [dispatch, connectionName, virtualDashboardId, reduxState, hasStarted, databases, contextDocs]);

  // Publish all dirty files (questions + dashboard) and navigate to the dashboard
  const handleGoToDashboard = useCallback(async () => {
    if (!virtualDashboardId) return;
    try {
      await publishAll();
      // Read fresh state AFTER publish — the hook-captured reduxState is stale
      const freshState = getStore().getState();
      const allFiles = Object.values(freshState.files.files);
      const dashboard = allFiles.find(f => f.type === 'dashboard' && f.id > 0 && f.name === 'Getting Started');
      if (dashboard) {
        router.push(`/f/${dashboard.id}`);
      } else {
        router.push('/');
      }
    } catch (err) {
      console.error('[StepGenerating] Publish failed:', err);
      router.push('/');
    }
  }, [virtualDashboardId, router]);

  const isDone = !isGenerating && hasStarted;

  return (
    <VStack gap={6} align="stretch" minH="400px">
      <style>{sparkleKeyframes}</style>
      <style>{pulseKeyframes}</style>

      {/* Header */}
      <VStack gap={3} textAlign="center" py={6}>
        <Box css={{ animation: 'sparkle 2s ease-in-out infinite' }}>
          <Icon as={LuRocket} boxSize={10} color="accent.teal" />
        </Box>
        <Heading size="lg" fontFamily="mono" fontWeight="400">
          {isDone ? 'Your dashboard is ready!' : isGenerating ? 'Building your dashboard...' : 'Build a starter dashboard'}
        </Heading>
        <Text color="fg.muted" fontSize="sm" maxW="450px">
          {isDone
            ? 'MinusX created questions and assembled them into a dashboard for you.'
            : isGenerating
              ? 'MinusX is exploring your data, writing queries, and building visualizations.'
              : 'MinusX will analyze your schema and create a dashboard with interesting queries automatically.'
          }
        </Text>
      </VStack>

      {/* Action buttons */}
      <HStack justify="center" gap={4}>
        {!isGenerating && !isDone && (
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
        {isGenerating && (
          <HStack gap={1}>
            <Box w="5px" h="5px" borderRadius="full" bg="accent.teal" css={{ animation: 'pulse 1.4s ease-in-out infinite' }} />
            <Box w="5px" h="5px" borderRadius="full" bg="accent.teal" css={{ animation: 'pulse 1.4s ease-in-out 0.2s infinite' }} />
            <Box w="5px" h="5px" borderRadius="full" bg="accent.teal" css={{ animation: 'pulse 1.4s ease-in-out 0.4s infinite' }} />
          </HStack>
        )}
      </HStack>

      {/* Debug: appState */}
      {devMode && virtualDashboardId && (
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

      {/* Agent trace — collapsible */}
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
            >
              <Icon as={LuSparkles} boxSize={3.5} color="accent.teal" />
              <Text fontSize="sm" fontFamily="mono" fontWeight="500" color="accent.teal" flex={1}>
                {showTrace ? 'Hide MinusX agent trace' : 'See MinusX agent in action'}
              </Text>
              <Icon
                as={showTrace ? LuChevronDown : LuChevronRight}
                boxSize={4}
                color="fg.subtle"
              />
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
