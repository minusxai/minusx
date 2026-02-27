'use client';

import { useState, useEffect, useMemo } from 'react';
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

  // Context selection state (using path instead of ID)
  const [selectedContextPath, setSelectedContextPath] = useState<string | null>(null);
  const [selectedVersion, setSelectedVersion] = useState<number | undefined>(undefined);

  // Find home context (any context file that is direct child of homeFolder)
  const filesState = useAppSelector(state => state.files.files);
  const homeFolder = user ? resolveHomeFolderSync(user.mode, user.home_folder || '') : '/org';

  const homeContext = Object.values(filesState).find(file => {
    if (file.type !== 'context') return false;
    const relativePath = file.path.substring(homeFolder.length);
    if (!relativePath.startsWith('/')) return false;
    const remainingSegments = relativePath.split('/').filter(Boolean);
    return remainingSegments.length === 1; // Direct child
  });
  const homeContextPath = homeContext?.path;

  // Initialize selectedContextPath with homeContextPath only on first load
  useEffect(() => {
    if (!selectedContextPath && homeContextPath) {
      const content = homeContext?.content as ContextContent | undefined;
      if (content?.published?.all) {
        setSelectedContextPath(homeContextPath);
        setSelectedVersion(content.published.all);
      }
    }
  }, [homeContextPath, selectedContextPath, homeContext]);

  // Get context info using path (always uses useContext hook now)
  const contextPath = selectedContextPath || homeContextPath || homeFolder;
  const contextInfo = useContext(contextPath, selectedVersion);

  // Track mobile state (default to false for SSR, update on client)
  const [isMobile, setIsMobile] = useState(false);

  const handleConversationSelect = (id?: number) => {
    // Navigate to conversation or new conversation page
    if (id) {
      router.push(`/explore/${id}`);
    } else {
      router.push('/explore');
    }
  };

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
              key={conversationId || 'new'}
              conversationId={conversationId}
              contextPath={contextPath}
              contextVersion={selectedVersion}
              databaseName={null}  // Auto-select first database
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
