'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useRouter } from '@/lib/navigation/use-navigation';
import { Box, HStack, VStack, Flex } from '@chakra-ui/react';
import ChatInterface from './ChatInterface';
import { ConversationList } from './ConversationList';
import RightSidebar from '@/components/RightSidebar';
import MobileRightSidebar from '@/components/MobileRightSidebar';
import Breadcrumb from '@/components/Breadcrumb';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import { setLeftSidebarCollapsed, setRightSidebarCollapsed } from '@/store/uiSlice';
import { useContext } from '@/lib/hooks/useContext';
import { resolveHomeFolderSync } from '@/lib/mode/path-resolver';
import { ContextContent } from '@/lib/types';
// ============================================================================
// Main Explore Interface Component
// ============================================================================

interface ExploreInterfaceProps {
  conversationId?: number;  // Optional file ID: if provided, continue existing conversation
  filePath?: string;  // Path for context filtering (default: '/org')
}

export default function ExploreInterface({ conversationId, filePath = '/org' }: ExploreInterfaceProps) {
  const dispatch = useAppDispatch();
  const router = useRouter();
  const user = useAppSelector(state => state.auth.user);

  // Read context stored in Redux conversation (available synchronously on navigation)
  const storedContextPath = useAppSelector(state =>
    conversationId
      ? (state.chat.conversations[conversationId]?.agent_args?.context_path ?? null)
      : null
  );
  const storedContextVersion = useAppSelector(state =>
    conversationId
      ? (state.chat.conversations[conversationId]?.agent_args?.context_version ?? undefined)
      : undefined
  );

  // Context selection state — prefer stored context from conversation over default null
  const [selectedContextPath, setSelectedContextPath] = useState<string | null>(storedContextPath);
  const [selectedVersion, setSelectedVersion] = useState<number | undefined>(storedContextVersion);

  // Find home context (any context file that is direct child of homeFolder)
  const homeFolder = user ? resolveHomeFolderSync(user.mode, user.home_folder || '') : '/org';

  const homeContext = useAppSelector(state => {
    const files = state.files.files;
    for (const file of Object.values(files)) {
      if (file.type !== 'context') continue;
      const relativePath = file.path.substring(homeFolder.length);
      if (!relativePath.startsWith('/')) continue;
      const remainingSegments = relativePath.split('/').filter(Boolean);
      if (remainingSegments.length === 1) return file;
    }
    return null;
  });
  const homeContextPath = homeContext?.path;

  // When navigating to a different conversation, sync selectedContextPath/Version to that
  // conversation's stored context (same pattern as DB's storedConnectionId sync in ChatInterface).
  useEffect(() => {
    if (storedContextPath) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelectedContextPath(storedContextPath);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelectedVersion(storedContextVersion);
    }
  }, [storedContextPath, storedContextVersion]);

  // Initialize selectedContextPath with homeContextPath only on first load — intentional setState in effect
  useEffect(() => {
    if (!selectedContextPath && homeContextPath) {
      const content = homeContext?.content as ContextContent | undefined;
      if (content?.published?.all) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setSelectedContextPath(homeContextPath);
        setSelectedVersion(content.published.all);
      }
    }
  }, [homeContextPath, selectedContextPath, homeContext]);

  // When the selected context's full content loads (partial → full), pin selectedVersion to its
  // published version. Without this, the user's path-only selection (selectedVersion = undefined)
  // stays after the context fully loads with multi-version options, causing a display mismatch in
  // ContextSelector (currentValue doesn't match any versioned option → GenericSelector falls back
  // to options[0], making it look like the selection was reset).
  const selectedContextFile = useAppSelector(state => {
    if (!selectedContextPath) return null;
    for (const file of Object.values(state.files.files)) {
      if (file?.type === 'context' && file.path === selectedContextPath) return file;
    }
    return null;
  });
  useEffect(() => {
    if (!selectedContextPath || selectedVersion !== undefined) return;
    const content = selectedContextFile?.content as ContextContent | undefined;
    const published = content?.published?.all;
    if (published !== undefined) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelectedVersion(published);
    }
  }, [selectedContextPath, selectedVersion, selectedContextFile]);

  // Get context info using path (always uses useContext hook now)
  const contextPath = selectedContextPath || homeContextPath || homeFolder;
  const contextInfo = useContext(contextPath, selectedVersion);

  // Track mobile state (default to false for SSR, update on client)
  const [isMobile, setIsMobile] = useState(false);

  const handleConversationSelect = useCallback((id?: number) => {
    if (id) {
      router.push(`/explore/${id}`);
    } else {
      router.push('/explore');
    }
  }, [router]);

  // Open right sidebar when explore page loads
  useEffect(() => {
    // dispatch(setRightSidebarCollapsed(true));
    // dispatch(setLeftSidebarCollapsed(true));  // Keep left sidebar open for conversation list

    // Detect mobile on client-side only
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768); // md breakpoint
    };
    checkMobile();

    // Listen for resize
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, [dispatch]);

  const conversationHistory = (
    <ConversationList
      onSelectConversation={handleConversationSelect}
      currentConversationId={conversationId}
    />
  );

  // Build breadcrumb items for explore page
  const breadcrumbItems = useMemo(() => [
    { label: 'Home', href: '/' },
    { label: 'Explore' }
  ], []);

  return (
    <HStack gap={0}
    height="100%"
    align="stretch" overflow="hidden">
      <Box flex="1"
      height="100%"
      display="flex" flexDirection="column" overflow="hidden">
        <VStack gap={0} align="stretch" height="100%">
          {/* Breadcrumb */}
          <Box px={{ base: 4, md: 8, lg: 12 }} pt={{ base: 3, md: 4, lg: 5 }}>
            <Flex justify="space-between" align="center" gap={4}>
              <Box flex="1" minW={0}>
                <Breadcrumb items={breadcrumbItems} />
              </Box>
            </Flex>
          </Box>
          {/* Chat Interface */}
          <Box flex="1" overflow="hidden">
            <ChatInterface
              conversationId={conversationId}
              contextPath={contextPath}
              contextVersion={selectedVersion}
              appState={undefined}
              container="page"
              onContextChange={(path, version) => {
                setSelectedContextPath(path);
                setSelectedVersion(version);
              }}
            />
          </Box>
        </VStack>
      </Box>
      {isMobile === false && (
        <RightSidebar
            title="Exploration Context"
            filePath={contextPath}
            contextVersion={selectedVersion}
            selectedContextPath={selectedContextPath}
            onContextChange={(path, version) => {
              setSelectedContextPath(path);
              setSelectedVersion(version);
            }}
            showChat={false}
            history={conversationHistory}
        />
      )}
      {isMobile === true && (
        <MobileRightSidebar
            title="Exploration Context"
            filePath={contextPath}
            contextVersion={selectedVersion}
            selectedContextPath={selectedContextPath}
            onContextChange={(path, version) => {
              setSelectedContextPath(path);
              setSelectedVersion(version);
            }}
            showChat={false}
            history={conversationHistory}
        />
      )}
    </HStack>
  );
}
