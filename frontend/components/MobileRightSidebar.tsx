'use client';

import { useState, useRef, useEffect } from 'react';
import { Box, VStack, HStack, Text, Icon, Dialog } from '@chakra-ui/react';
import { LuX, LuMove } from 'react-icons/lu';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import { setActiveSidebarSection, selectDashboardEditMode } from '@/store/uiSlice';
import { selectMergedContent, addQuestionToDashboard } from '@/store/filesSlice';
import { QuestionBrowserPanel } from './QuestionBrowserPanel';
import { DocumentContent } from '@/lib/types';
import { AppState } from '@/lib/appState';
import SchemaTreeView from './SchemaTreeView';
import Markdown from './Markdown';
import ChatInterface from './explore/ChatInterface';
import AppStateViewer from './AppStateViewer';
import { ReactNode } from 'react';
import { useContext } from '@/lib/hooks/useContext';
import { useAppState } from '@/lib/hooks/file-state-hooks';
import { ContextSelector } from './explore/ContextSelector';
import { selectActiveConversation } from '@/store/chatSlice';
import { getSidebarSection, SidebarSectionMetadata } from '@/lib/ui/sidebar-sections';

export interface MobileRightSidebarProps {
  title?: string;
  filePath?: string;
  history?: ReactNode;
  showChat?: boolean;
  contextVersion?: number;  // Selected context version (admin testing)
  selectedContextPath?: string | null;  // Selected context path for dropdown
  onContextChange?: (path: string | null, version?: number) => void;
}

export default function MobileRightSidebar({
  title = "Misc Info",
  filePath = '/',
  history,
  showChat = false,
  contextVersion,
  selectedContextPath,
  onContextChange
}: MobileRightSidebarProps) {
  const dispatch = useAppDispatch();
  const devMode = useAppSelector((state) => state.ui.devMode);
  const activeSection = useAppSelector((state) => state.ui.activeSidebarSection);

  // Get current page app state
  const { appState, loading: appStateLoading } = useAppState();

  // Read from Redux (loaded by layout.tsx)
  const currentUser = useAppSelector(state => state.auth.user);

  // Get context info using path (use selected version if provided by admin)
  const contextInfo = useContext(filePath, contextVersion);
  const databases = contextInfo.databases;
  const documentation = contextInfo.documentation;
  const contextsLoading = contextInfo.contextLoading;

  // Get active conversation ID (persists across all pages)
  const conversationID = useAppSelector(selectActiveConversation);
  const [iconBarPosition, setIconBarPosition] = useState(80); // percentage from top (default: bottom 20%)
  const [isDragging, setIsDragging] = useState(false);
  const dragStartY = useRef<number>(0);
  const dragStartPosition = useRef<number>(80);

  // Dashboard edit mode detection
  const isDashboard = appState?.type === 'file' && appState.state.fileState.type === 'dashboard';
  const dashboardEditMode = useAppSelector(state =>
    appState?.type === 'file' && isDashboard ? selectDashboardEditMode(state, appState.state.fileState.id) : false
  );

  // Get dashboard content for question IDs (needed for excludedIds)
  const dashboardContent = useAppSelector(state =>
    appState?.type === 'file' && isDashboard ? selectMergedContent(state, appState.state.fileState.id) as DocumentContent | undefined : undefined
  );

  // Extract folder path from file path (for QuestionBrowserPanel)
  const dashboardFolderPath = filePath ? filePath.substring(0, filePath.lastIndexOf('/')) || '/' : '/';

  // Get excluded question IDs from dashboard assets
  const excludedQuestionIds = dashboardContent?.assets
    ?.filter(a => a.type === 'question' && 'id' in a)
    ?.map(a => (a as { type: 'question'; id: number }).id) || [];

  // Handler for adding questions to dashboard
  const handleAddQuestionToDashboard = (questionId: number) => {
    if (appState?.type === 'file' && isDashboard) {
      dispatch(addQuestionToDashboard({ dashboardId: appState.state.fileState.id, questionId }));
    }
  };


  // Min/max limits for icon bar position
  const MIN_POSITION = 15; // 15% from top
  const MAX_POSITION = 75; // 85% from top

  // Build sections array
  const sections: SidebarSectionMetadata[] = [];

  // Questions section - only visible for dashboards in edit mode (shown first)
  if (isDashboard && dashboardEditMode && appState?.type === 'file') {
    sections.push(getSidebarSection('questions'));
  }

  // Context Selector section - only visible when onContextChange is provided
  if (onContextChange) {
    sections.push(getSidebarSection('context'));
  }

  if (showChat) {
    sections.push(getSidebarSection('chat'));
  }

  // Show databases section during loading or when data is available
  if (databases || contextsLoading) {
    sections.push(getSidebarSection('databases'));
  }

  // Show documentation section during loading or when data is available
  if (documentation !== undefined || contextsLoading) {
    sections.push(getSidebarSection('documentation'));
  }

  if (history !== undefined) {
    sections.push(getSidebarSection('history'));
  }

  if (devMode) {
    sections.push(getSidebarSection('dev'));
  }

  // Don't render if no sections
  if (sections.length === 0) {
    return null;
  }

  const activeS = sections.find(s => s.id === activeSection);

  // Drag handlers for icon bar
  const handleDragStart = (e: React.MouseEvent | React.TouchEvent) => {
    e.stopPropagation();
    setIsDragging(true);
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    dragStartY.current = clientY;
    dragStartPosition.current = iconBarPosition;
  };

  const handleDragMove = (clientY: number) => {
    if (!isDragging) return;

    const viewportHeight = window.innerHeight;
    const newPositionPercent = (clientY / viewportHeight) * 100;
    const clampedPosition = Math.max(MIN_POSITION, Math.min(MAX_POSITION, newPositionPercent));
    setIconBarPosition(clampedPosition);
  };

  const handleDragEnd = () => {
    setIsDragging(false);
  };

  // Mouse and touch event handlers
  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => handleDragMove(e.clientY);
    const handleTouchMove = (e: TouchEvent) => {
      e.preventDefault();
      handleDragMove(e.touches[0].clientY);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('touchmove', handleTouchMove, { passive: false });
    document.addEventListener('mouseup', handleDragEnd);
    document.addEventListener('touchend', handleDragEnd);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('touchmove', handleTouchMove);
      document.removeEventListener('mouseup', handleDragEnd);
      document.removeEventListener('touchend', handleDragEnd);
    };
  }, [isDragging]);

  return (
    <>
      {/* Icon Bar - Fixed on right edge */}
      <Box
        position="fixed"
        right={0}
        top={`${iconBarPosition}%`}
        transform="translateY(-50%)"
        zIndex={99}
        display={{ base: 'block', md: 'none' }}
      >
        <VStack gap={0} bg="bg.surface" borderRadius="md" shadow="lg" overflow="hidden">
          {/* Drag Handle */}
          <Box
            p={3}
            cursor={isDragging ? 'grabbing' : 'grab'}
            onMouseDown={handleDragStart}
            onTouchStart={handleDragStart}
            bg="bg.muted"
            borderLeftWidth="4px"
            borderLeftColor="accent.muted"
            _hover={{ bg: 'bg.emphasized' }}
            userSelect="none"
            transition="all 0.2s"
          >
            <Icon
              as={LuMove}
              boxSize={5}
              color={isDragging ? 'accent.muted' : 'fg.muted'}
              transition="color 0.2s"
            />
          </Box>

          {sections.map((section) => (
            <Box
              key={section.id}
              p={3}
              borderLeftWidth="4px"
              borderLeftColor={section.color}
              cursor="pointer"
              onClick={() => dispatch(setActiveSidebarSection(section.id))}
              _hover={{ bg: 'bg.muted' }}
              _active={{ bg: 'bg.emphasized' }}
              transition="all 0.2s"
              bg={activeSection === section.id ? 'bg.muted' : 'bg.surface'}
            >
              <Icon as={section.icon} boxSize={5} color={section.color} />
            </Box>
          ))}
        </VStack>
      </Box>

      {/* Bottom Sheet Dialog */}
      <Box display={{ base: 'block', md: 'none' }}>
        <Dialog.Root
          open={activeSection !== null}
          onOpenChange={(e) => !e.open && dispatch(setActiveSidebarSection(null))}
          placement="bottom"
        >
          <Dialog.Backdrop />
          <Dialog.Positioner>
          <Dialog.Content
            maxH="75vh"
            borderTopRadius="xl"
            borderBottomRadius="0"
          >
            {/* Header */}
            <HStack
              px={4}
              py={3}
              borderBottom="1px solid"
              borderColor="border.default"
              bg="bg.muted"
              justify="space-between"
            >
              <HStack gap={2}>
                {activeS && (
                  <>
                    <Icon as={activeS.icon} boxSize={5} color={activeS.color} />
                    <Text fontSize="sm" fontWeight="700" fontFamily="mono" color={activeS.color}>
                      {activeS.title}
                    </Text>
                  </>
                )}
              </HStack>
              <Icon
                as={LuX}
                boxSize={5}
                color="fg.muted"
                cursor="pointer"
                onClick={() => dispatch(setActiveSidebarSection(null))}
                _hover={{ color: 'fg.default' }}
              />
            </HStack>

            {/* Content - Scrollable */}
            <Box flex="1" overflowY="auto" bg="bg.canvas">
              {activeSection === 'databases' && (
                <VStack gap={0} align="stretch">
                  {contextsLoading ? (
                    <Box p={8} textAlign="center">
                      <Text fontSize="sm" color="fg.muted">Loading databases...</Text>
                    </Box>
                  ) : databases && databases.length > 0 ? (
                    databases.map((db) => (
                      <Box key={db.databaseName}>
                        <Box
                          px={4}
                          py={2}
                          bg="bg.muted"
                          borderBottom="1px solid"
                          borderColor="border.default"
                        >
                          <Text fontSize="xs" fontWeight="700" color="fg.default" fontFamily="mono">
                            {db.databaseName}
                          </Text>
                        </Box>
                        <SchemaTreeView
                          schemas={db.schemas}
                          selectable={false}
                          showColumns={true}
                          showStats={false}
                        />
                      </Box>
                    ))
                  ) : (
                    <Box p={8} textAlign="center">
                      <Text fontSize="sm" color="fg.muted">No databases available</Text>
                    </Box>
                  )}
                </VStack>
              )}

              {activeSection === 'documentation' && (
                <Box p={4}>
                  {contextsLoading ? (
                    <Text fontSize="sm" color="fg.muted" fontFamily="mono">
                      Loading documentation...
                    </Text>
                  ) : documentation ? (
                    <Markdown context="sidebar">{documentation}</Markdown>
                  ) : (
                    <Text fontSize="sm" color="fg.muted" fontFamily="mono">
                      No documentation available
                    </Text>
                  )}
                </Box>
              )}

              {activeSection === 'history' && (
                <Box p={4}>
                  {history || (
                    <Text fontSize="sm" color="fg.muted" fontFamily="mono">
                      No history yet
                    </Text>
                  )}
                </Box>
              )}

              {activeSection === 'context' && onContextChange && (
                <Box p={4}>
                  <ContextSelector
                    selectedContextPath={selectedContextPath || null}
                    selectedVersion={contextVersion}
                    onSelectContext={onContextChange}
                  />
                </Box>
              )}

              {activeSection === 'chat' && (
                <Box height="calc(75vh - 60px)" overflow="hidden">
                  <ChatInterface
                    conversationId={conversationID}
                    contextPath={filePath}
                    contextVersion={contextVersion}
                    databaseName={null}  // Auto-select from context
                    appState={appState || null}
                    container="sidebar"
                  />
                </Box>
              )}

              {activeSection === 'dev' && (
                <Box p={4}>
                  <VStack align="stretch" gap={3}>
                    <Text fontSize="sm" fontFamily="mono" color="accent.teal" fontWeight="600">
                      Development Mode Active
                    </Text>
                    <AppStateViewer appState={appState} maxHeight="400px" />
                  </VStack>
                </Box>
              )}

              {activeSection === 'questions' && appState?.type === 'file' && (
                <Box p={0} maxH="calc(75vh - 60px)" overflowY="auto">
                  <QuestionBrowserPanel
                    folderPath={dashboardFolderPath}
                    onAddQuestion={handleAddQuestionToDashboard}
                    excludedIds={excludedQuestionIds}
                  />
                </Box>
              )}
            </Box>
          </Dialog.Content>
        </Dialog.Positioner>
      </Dialog.Root>
      </Box>
    </>
  );
}
