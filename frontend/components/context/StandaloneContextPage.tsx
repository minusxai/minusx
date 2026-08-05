'use client';

import { Box, Center, Heading, Spinner, Text, VStack } from '@chakra-ui/react';
import ContextContainerV2 from '@/components/containers/ContextContainerV2';
import { useContexts } from '@/lib/hooks/useContexts';
import { resolveHomeFolderSync } from '@/lib/mode/path-resolver';
import { useAppSelector } from '@/store/hooks';
import { selectContextFromPath } from '@/store/filesSlice';
import { selectEnableCustomAgents } from '@/store/uiSlice';

export type StandaloneContextSurface = 'agents' | 'skills';

interface StandaloneContextPageProps {
  surface: StandaloneContextSurface;
  requestedContextId?: string;
}

function SurfaceMessage({ title, message }: { title: string; message: string }) {
  return (
    <Center minH="60vh" px={6}>
      <VStack gap={2} textAlign="center" maxW="460px">
        <Heading as="h1" fontSize="2xl">{title}</Heading>
        <Text color="fg.muted">{message}</Text>
      </VStack>
    </Center>
  );
}

/**
 * Resolves the same nearest loaded context used by chat, then delegates to the
 * existing context editor in single-surface mode. The optional context id keeps
 * the sidebar selection stable when navigating away from a nested folder.
 */
export default function StandaloneContextPage({
  surface,
  requestedContextId,
}: StandaloneContextPageProps) {
  const user = useAppSelector(state => state.auth.user);
  const enableCustomAgents = useAppSelector(selectEnableCustomAgents);
  const { contexts, homeContext, loading, error } = useContexts();
  const homePath = user
    ? resolveHomeFolderSync(user.mode, user.home_folder || '')
    : '/org';
  const nearestContext = useAppSelector(state => selectContextFromPath(state, homePath));

  const parsedContextId = Number(requestedContextId);
  const hasRequestedContext = Number.isInteger(parsedContextId) && parsedContextId > 0;
  const requestedContext = hasRequestedContext
    ? contexts.find(context => context.id === parsedContextId)
    : undefined;
  const resolvedContext = hasRequestedContext
    ? requestedContext
    : nearestContext || homeContext || contexts[0];
  const title = surface === 'agents' ? 'Agents' : 'Skills';

  if (surface === 'agents' && !enableCustomAgents) {
    return (
      <SurfaceMessage
        title="Agents"
        message="Custom agents are not enabled for this workspace."
      />
    );
  }

  if (loading && !resolvedContext) {
    return (
      <Center minH="60vh" aria-label={`Loading ${title}`}>
        <Spinner color="accent.teal" />
      </Center>
    );
  }

  if (!resolvedContext) {
    return (
      <SurfaceMessage
        title={title}
        message={error ? 'The workspace context could not be loaded.' : 'No context is available for this workspace.'}
      />
    );
  }

  return (
    <Box
      as="main"
      w="100%"
      maxW="1200px"
      mx="auto"
      px={{ base: 4, md: 8, lg: 12 }}
      pt={{ base: 5, md: 8 }}
    >
      <ContextContainerV2 fileId={resolvedContext.id} standaloneTab={surface} />
    </Box>
  );
}
