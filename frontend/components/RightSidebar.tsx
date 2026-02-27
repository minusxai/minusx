'use client';

import { useState, useEffect, useRef, ReactNode } from 'react';
import { Box, VStack, HStack, Text, Icon, IconButton } from '@chakra-ui/react';
import { LuChevronRight, LuChevronLeft, LuGripVertical, LuChevronDown, LuRefreshCw } from 'react-icons/lu';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import { setRightSidebarCollapsed, setRightSidebarWidth, setActiveSidebarSection, selectRightSidebarUIState, selectDashboardEditMode } from '@/store/uiSlice';
import { setFiles, selectMergedContent, addQuestionToDashboard } from '@/store/filesSlice';
import { QuestionBrowserPanel } from './QuestionBrowserPanel';
import QuestionSchemaSection from './QuestionSchemaSection';
import { DocumentContent, FileType } from '@/lib/types';
import SchemaTreeView from './SchemaTreeView';
import Markdown from './Markdown';
import ChatInterface from './explore/ChatInterface';
import AccessTokenManager from './AccessTokenManager';
import DevToolsPanel from './DevToolsPanel';
import { resolvePath } from '@/lib/mode/path-resolver';
import { Tooltip } from './ui/tooltip';
import { useContext } from '@/lib/hooks/useContext';
import { useAppState } from '@/lib/hooks/file-state-hooks';
import { ContextSelector } from './explore/ContextSelector';
import { selectActiveConversation, selectConversation } from '@/store/chatSlice';
import { getSidebarSection, SidebarSectionMetadata } from '@/lib/ui/sidebar-sections';

// ============================================================================
// RightSidebar Props Interface
// ============================================================================

export interface RightSidebarProps {
  title?: string;
  filePath?: string;  // File path for context filtering
  history?: ReactNode;
  showChat?: boolean;
  fileId?: number;
  fileType?: FileType;
  contextVersion?: number;  // Selected context version (admin testing)
  selectedContextPath?: string | null;  // Selected context path for dropdown
  onContextChange?: (path: string | null, version?: number) => void;  // Context change callback
}

// ============================================================================
// Right Sidebar Component
// ============================================================================

export default function RightSidebar({
  title = "Misc Info",
  filePath = '/',
  history,
  showChat = false,
  fileId,
  fileType,
  contextVersion,
  selectedContextPath,
  onContextChange
}: RightSidebarProps) {
  const dispatch = useAppDispatch();
  const { isCollapsed, width, devMode, colorMode, activeSidebarSection } = useAppSelector(selectRightSidebarUIState);

  // Get current page app state
  const { appState, loading: appStateLoading } = useAppState();

  // Read from Redux (loaded by layout.tsx)
  const currentUser = useAppSelector(state => state.auth.user);

  // Get context info using selected context path (from dropdown) or fallback to file path
  const contextPath = selectedContextPath || filePath;
  const contextInfo = useContext(contextPath, contextVersion);
  const databases = contextInfo.databases;
  const documentation = contextInfo.documentation;
  const contextsLoading = contextInfo.contextLoading;

  const [isDragging, setIsDragging] = useState(false);
  const [isHoveringButton, setIsHoveringButton] = useState(false);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Get active conversation ID from Redux (persists across all pages)
  const conversationID = useAppSelector(selectActiveConversation);

  // Get the active conversation to check execution state
  const activeConversation = useAppSelector(state =>
    conversationID ? selectConversation(state, conversationID) : undefined
  );

  // Check if chat is currently running
  const isChatRunning = activeConversation && (
    activeConversation.executionState === 'WAITING' ||
    activeConversation.executionState === 'STREAMING' ||
    activeConversation.executionState === 'EXECUTING'
  );

  // Dashboard edit mode detection
  const isDashboard = appState?.type === 'file' && appState.state.fileState.type === 'dashboard';
  const dashboardEditMode = useAppSelector(state =>
    appState?.type === 'file' && isDashboard ? selectDashboardEditMode(state, appState.state.fileState.id) : false
  );

  // Auto-open sidebar sections based on state changes
  // Priority: chat running > user's explicit selection > default dashboard edit behavior
  useEffect(() => {
    if (showChat && isChatRunning) {
      // When chat starts running, always switch to chat section
      dispatch(setRightSidebarCollapsed(false));
      dispatch(setActiveSidebarSection('chat'));
    } else if (isDashboard && dashboardEditMode && !activeSidebarSection) {
      // Only auto-open questions section if no section is currently active
      // This prevents overriding user's explicit choice (e.g., staying in chat)
      dispatch(setRightSidebarCollapsed(false));
      dispatch(setActiveSidebarSection('questions'));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isChatRunning, dashboardEditMode, dispatch]);

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

  // Refresh handler - fetch fresh connections
  // Note: Contexts are now loaded as files and will refresh via useFile cache invalidation
  const handleRefresh = async () => {
    if (!currentUser) return;

    setIsRefreshing(true);
    try {
      // Fetch connections as files with force_refresh to bust schema cache
      const databaseFolder = resolvePath(currentUser.mode, '/database');
      const url = `/api/files?paths=${encodeURIComponent(databaseFolder)}&type=connection&depth=1&load=true&force_refresh=true`;
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error('Failed to refresh connections');
      }

      const json = await response.json();
      const connectionFiles = json.data;

      // Update Redux with files (connection-loader already added schemas)
      dispatch(setFiles({ files: connectionFiles }));
    } catch (error) {
      console.error('[RightSidebar] Refresh failed:', error);
    } finally {
      setIsRefreshing(false);
    }
  };

  // Note: pendingMessage pattern removed - chatSlice uses direct sendMessage dispatch

  const handleToggle = () => {
    dispatch(setRightSidebarCollapsed(!isCollapsed));
  };

  const toggleSection = (sectionId: string) => {
    // Toggle: if already active, collapse (set to null), otherwise expand
    if (activeSidebarSection === sectionId) {
      dispatch(setActiveSidebarSection(null));
    } else {
      dispatch(setActiveSidebarSection(sectionId));
    }
  };

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (sidebarRef.current) {
        const rect = sidebarRef.current.getBoundingClientRect();
        const newWidth = rect.right - e.clientX;
        // Min width: 280px, Max width: 400px
        const clampedWidth = Math.min(Math.max(newWidth, 280), 600);
        dispatch(setRightSidebarWidth(clampedWidth));
      }
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, dispatch]);

  // Determine which sections to show
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

  // Always show schema section (empty state handled in rendering)
  sections.push(getSidebarSection('databases'));

  // Show referenced questions section for question pages
  if (fileType === 'question') {
    sections.push(getSidebarSection('question-references'));
  }

  // Always show documentation section (empty state handled in rendering)
  sections.push(getSidebarSection('documentation'));

  if (history !== undefined) {
    sections.push(getSidebarSection('history'));
  }

  // Share section - only visible for admins with valid fileId and shareable file types
  //ToDo: Vivek: can enable later
//   const shareableTypes: Array<string> = ['question', 'dashboard', 'folder'];
//   if (
//     currentUser &&
//     currentUser.role === 'admin' &&
//     fileId &&
//     typeof fileId === 'number' &&
//     pageDetails.pageType &&
//     shareableTypes.includes(pageDetails.pageType)
//   ) {
//     sections.push(getSidebarSection('share'));
//   }

  // Dev section - only visible when devMode is enabled
  if (devMode) {
    sections.push(getSidebarSection('dev'));
  }

  // Don't render if no sections
  if (sections.length === 0) {
    return null;
  }

  return (
    <>
      {/* Sidebar container */}
      <HStack
        height="100vh"
        position="sticky"
        top={0}
        borderY="0px"
        borderColor="border.default"
        alignItems="center"
        gap={0}
        flexShrink={0}
        display={{ base: 'none', md: 'flex' }} // Hide on mobile, show on desktop
      >
      {!isCollapsed && (
        <Box
          position="relative"
          width="4px"
          height="100%"
          cursor="col-resize"
          onMouseDown={() => setIsDragging(true)}
          bg={isDragging ? "accent.teal/30" : "transparent"}
          _hover={{ bg: "accent.teal/20" }}
          transition="background 0.2s"
          display="flex"
          alignItems="center"
          justifyContent="center"
        >
          <Icon
            as={LuGripVertical}
            boxSize={3}
            color={isDragging ? "accent.teal" : "fg.muted"}
            opacity={isDragging ? 1 : 0.5}
            _hover={{ opacity: 1 }}
          />
        </Box>
      )}

      <Box
        ref={sidebarRef}
        width={!isCollapsed ? `${width}px` : "52px"}
        height="100%"
        transition={isDragging ? "none" : "width 0.3s cubic-bezier(0.4, 0, 0.2, 1)"}
        overflow="hidden"
        display="flex"
        flexDirection="column"
        borderLeft="1px solid"
        borderColor="border.default"
        position="relative"
      >
        {/* Icon Bar (when sidebar is closed) - always rendered */}
        <VStack
          gap={0}
          p={0}
          flexShrink={0}
          position="absolute"
          top={0}
          left={0}
          width="52px"
          height="100%"
          opacity={isCollapsed ? 1 : 0}
          pointerEvents={isCollapsed ? "auto" : "none"}
          transition="opacity 0.3s cubic-bezier(0.4, 0, 0.2, 1)"
          bg="bg.surface"
          zIndex={1}
          alignItems="stretch"
        >
          {/* Expand button at the top */}
          <Box
            p={3}
            bg="bg.muted"
            borderBottom="1px solid"
            borderColor="border.default"
            cursor="pointer"
            onClick={handleToggle}
            _hover={{ bg: 'bg.elevated' }}
            transition="all 0.2s"
          >
            <Tooltip content="Expand sidebar">
              <Icon as={LuChevronLeft} boxSize={5} color="fg.muted" />
            </Tooltip>
          </Box>

          {/* Section icons */}
          {sections.map((section) => (
            <Box
              key={section.id}
              p={3}
              bg="bg.surface"
              borderStyle={"solid"}
              borderLeftWidth="4px"
              borderColor={section.color}
              cursor="pointer"
              onClick={() => {
                // Open sidebar and expand only this section
                dispatch(setActiveSidebarSection(section.id));
                dispatch(setRightSidebarCollapsed(false));
              }}
              _hover={{ bg: 'bg.muted' }}
              transition="all 0.2s"
            >
              <Icon as={section.icon} boxSize={5} color={section.color} />
            </Box>
          ))}
        </VStack>

        {/* Main content - always rendered */}
        <VStack
          gap={0}
          height="100%"
          width="100%"
          bg="bg.surface"
          overflow="hidden"
          opacity={!isCollapsed ? 1 : 0}
          pointerEvents={!isCollapsed ? "auto" : "none"}
          transition="opacity 0.3s cubic-bezier(0.4, 0, 0.2, 1)"
        >
            <HStack
              px={4}
              py={3}
              borderBottom="1px solid"
              borderColor="border.default"
              bg="bg.muted"
              flexShrink={0}
              w="100%"
              justify="space-between"
            >
              <HStack gap={2}>
                <IconButton
                  aria-label="Close sidebar"
                  size="xs"
                  variant="ghost"
                  onClick={handleToggle}
                  color="fg.muted"
                  _hover={{ color: 'fg.default' }}
                  bg="bg.elevated"
                >
                  <Icon as={LuChevronRight} boxSize={4} />
                </IconButton>
                <Text
                  fontSize="xs"
                  fontWeight="700"
                  color="fg.subtle"
                  textTransform="uppercase"
                  letterSpacing="0.05em"
                  fontFamily="mono"
                >
                  {title}
                </Text>
              </HStack>

              {/* <Tooltip content="Refresh connections and context">
                <IconButton
                  aria-label="Refresh connections and context"
                  size="xs"
                  variant="ghost"
                  onClick={handleRefresh}
                  loading={isRefreshing}
                  color="fg.muted"
                  _hover={{ color: 'fg.default' }}
                  bg="bg.elevated"
                >
                  <Icon as={LuRefreshCw} boxSize={4} />
                </IconButton>
              </Tooltip> */}
            </HStack>

            {/* Sidebar Content - Scrollable */}
            <VStack gap={0} align="stretch" flex="1" overflowY="auto" alignItems="stretch" w="100%">
              {sections.map((section) => {
                const isExpanded = activeSidebarSection === section.id;
                return (
                  <Box key={section.id} borderBottom="1px solid" borderColor="border.default">
                    <HStack
                      px={4}
                      py={3}
                      bg="bg.canvas"
                      borderLeft="3px solid"
                      borderColor={section.color}
                      cursor="pointer"
                      onClick={() => toggleSection(section.id)}
                      _hover={{ bg: 'bg.muted' }}
                      transition="background 0.2s"
                      gap={2}
                      justifyContent="space-between"
                    >
                      <HStack gap={2}>
                        <Icon as={section.icon} boxSize={4} color={section.color} />
                        <Text fontSize="sm" fontWeight="600" fontFamily="mono" color={section.color}>
                          {section.title}
                        </Text>
                      </HStack>
                      <Icon
                        as={LuChevronDown}
                        boxSize={4}
                        color={section.color}
                        transform={isExpanded ? 'rotate(0deg)' : 'rotate(-90deg)'}
                        transition="transform 0.2s"
                      />
                    </HStack>
                    {isExpanded && (
                      <Box
                        maxH={section.maxHeight || "none"}
                        overflowY={section.maxHeight ? "auto" : "visible"}
                      >
                        {section.id === 'databases' && (
                          <VStack gap={0} bg="bg.canvas" pb={2} align="stretch">
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
                                    <Text
                                      fontSize="xs"
                                      fontWeight="700"
                                      color="fg.default"
                                      fontFamily="mono"
                                    >
                                      {db.databaseName}
                                    </Text>
                                  </Box>
                                  <SchemaTreeView
                                    schemas={db.schemas}
                                    selectable={false}
                                    showColumns={true}
                                    showStats={false}
                                  //   onTablePreview={pageType === 'question' ? handleTablePreview : undefined}
                                    onTablePreview={undefined}
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
                        {section.id === 'documentation' && (
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
                        {section.id === 'history' && (
                          <Box p={0}>
                            {history || (
                              <Text fontSize="sm" color="fg.muted" fontFamily="mono">
                                No history yet
                              </Text>
                            )}
                          </Box>
                        )}
                        {section.id === 'context' && onContextChange && (
                          <Box p={4}>
                            <ContextSelector
                              selectedContextPath={selectedContextPath || null}
                              selectedVersion={contextVersion}
                              onSelectContext={onContextChange}
                            />
                          </Box>
                        )}
                        {section.id === 'chat' && (
                          <Box height="calc(100vh - 200px)" overflow="hidden">
                            <ChatInterface
                              conversationId={conversationID}
                              contextPath={filePath}
                              contextVersion={contextVersion}
                              databaseName={null}  // Auto-select from context
                              appState={appState}
                              container="sidebar"
                            />
                          </Box>
                        )}
                        {section.id === 'share' && appState?.type === 'file' && currentUser && (
                          <Box p={4}>
                            <AccessTokenManager fileId={appState.state.fileState.id} currentUser={currentUser} />
                          </Box>
                        )}
                        {section.id === 'dev' && (
                          <DevToolsPanel appState={appState} />
                        )}
                        {section.id === 'question-references' && (
                          <Box p={0} maxH="calc(100vh - 200px)" overflowY="auto">
                            <QuestionSchemaSection />
                          </Box>
                        )}
                        {section.id === 'questions' && appState?.type === 'file' && (
                          <Box p={0} maxH="calc(100vh - 200px)" overflowY="auto">
                            <QuestionBrowserPanel
                              folderPath={dashboardFolderPath}
                              onAddQuestion={handleAddQuestionToDashboard}
                              excludedIds={excludedQuestionIds}
                            />
                          </Box>
                        )}
                      </Box>
                    )}
                  </Box>
                );
              })}
            </VStack>
          </VStack>
      </Box>
    </HStack>
    </>
  );
}
