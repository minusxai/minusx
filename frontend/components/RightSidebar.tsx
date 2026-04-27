'use client';

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Box, VStack, HStack, Text, Icon } from '@chakra-ui/react';
import { LuChevronRight, LuChevronLeft, LuGripVertical, LuChevronDown, LuMessageSquare, LuLayers } from 'react-icons/lu';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import { setRightSidebarCollapsed, setRightSidebarWidth, setActiveSidebarSection, selectRightSidebarUIState } from '@/store/uiSlice';
import { IS_DEV } from '@/lib/constants';
import { createSelector } from '@reduxjs/toolkit';
import type { RootState } from '@/store/store';
import QuestionSchemaSection from './QuestionSchemaSection';
import { FileType, DatabaseWithSchema } from '@/lib/types';
import SchemaTreeView from './SchemaTreeView';
import Markdown from './Markdown';
import ChatInterface from './explore/ChatInterface';
import DevToolsPanel from './DevToolsPanel';

import { resolveHomeFolderSync, isUnderSystemFolder } from '@/lib/mode/path-resolver';
import type { Mode } from '@/lib/mode/mode-types';
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
  showChat?: boolean;

  fileId?: number;
  fileType?: FileType;
  contextVersion?: number;  // Selected context version (admin testing)
  selectedContextPath?: string | null;  // Selected context path for dropdown
  onContextChange?: (path: string | null, version?: number) => void;  // Context change callback
}

// Per-instance memoized selector factory
const makeSelectContextFileCount = () =>
  createSelector(
    [
      (state: RootState) => state.files.files,
      (_: RootState, homeFolder: string, _mode: Mode) => homeFolder,
      (_: RootState, _homeFolder: string, mode: Mode) => mode,
    ],
    (files, homeFolder, mode) =>
      homeFolder
        ? Object.values(files).filter(
            file => file.type === 'context' && file.path.startsWith(homeFolder) && file.id > 0
              && !isUnderSystemFolder(file.path, mode)
          ).length
        : 0
  );

// ============================================================================
// Shared props for section content rendering
// ============================================================================

interface SectionContentSharedProps {
  contextsLoading: boolean;
  databases: ReturnType<typeof useContext>['databases'];
  documentation: string | undefined;
  onContextChange?: (path: string | null, version?: number) => void;
  selectedContextPath?: string | null;
  contextVersion?: number;
  conversationID: number | undefined;
  filePath: string;
  appState: ReturnType<typeof useAppState>['appState'];
  currentUser: ReturnType<typeof useAppSelector<RootState['auth']['user']>>;
}

// ============================================================================
// Section Content Renderer
// ============================================================================

function SectionContent({
  section,
  contextsLoading,
  databases,
  documentation,
  onContextChange,
  selectedContextPath,
  contextVersion,
  conversationID,
  filePath,
  appState,
  currentUser,
}: SectionContentSharedProps & { section: SidebarSectionMetadata }) {
  switch (section.id) {
    case 'databases':
      return (
        <VStack gap={0} bg="bg.canvas" align="stretch">
          {contextsLoading ? (
            <Box p={8} textAlign="center">
              <Text fontSize="sm" color="fg.muted">Loading databases...</Text>
            </Box>
          ) : databases && databases.length > 0 ? (
            databases.map((db: DatabaseWithSchema) => (
              <Box key={db.databaseName}>
                <Box px={4} py={2} bg="bg.muted" borderBottom="1px solid" borderColor="border.default">
                  <Text fontSize="xs" fontWeight="700" color="fg.default" fontFamily="mono">
                    {db.databaseName}
                  </Text>
                </Box>
                <Box p={2}>
                  <SchemaTreeView
                    schemas={db.schemas}
                    selectable={false}
                    showColumns={true}
                    showStats={false}
                    onTablePreview={undefined}
                  />
                </Box>
              </Box>
            ))
          ) : (
            <Box p={8} textAlign="center">
              <Text fontSize="sm" color="fg.muted">No databases available</Text>
            </Box>
          )}
        </VStack>
      );
    case 'documentation':
      return (
        <Box p={4}>
          {contextsLoading ? (
            <Text fontSize="sm" color="fg.muted" fontFamily="mono">Loading documentation...</Text>
          ) : documentation ? (
            <Markdown context="sidebar">{documentation}</Markdown>
          ) : (
            <Text fontSize="sm" color="fg.muted" fontFamily="mono">No documentation available</Text>
          )}
        </Box>
      );
    case 'context':
      return onContextChange ? (
        <Box p={4}>
          <ContextSelector
            selectedContextPath={selectedContextPath || null}
            selectedVersion={contextVersion}
            onSelectContext={onContextChange}
          />
        </Box>
      ) : null;
    case 'chat':
      return (
        <Box height="100%" overflow="hidden">
          <ChatInterface
            conversationId={conversationID}
            contextPath={filePath}
            contextVersion={contextVersion}
            databaseName={null}
            appState={appState}
            container="sidebar"
          />
        </Box>
      );

    case 'dev':
      return <DevToolsPanel appState={appState} />;
    case 'question-references':
      return (
        <Box p={0} maxH="calc(100vh - 200px)" overflowY="auto">
          <QuestionSchemaSection />
        </Box>
      );
    default:
      return null;
  }
}

// ============================================================================
// Accordion Section Header
// ============================================================================

function SectionHeader({
  section,
  isExpanded,
  onToggle,
}: {
  section: SidebarSectionMetadata;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  return (
    <HStack
      px={4}
      py={3}
      bg="bg.canvas"
      borderLeft="3px solid"
      borderColor={section.color}
      cursor="pointer"
      onClick={onToggle}
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
  );
}

// ============================================================================
// Tabs Layout - Chat tab and Context tab
// ============================================================================

function TabsLayout({
  chatSections,
  refSections,
  activeSidebarSection,
  onSetActiveSection,
  toggleSection,
  sectionContentProps,
  onCollapse,
}: {
  chatSections: SidebarSectionMetadata[];
  refSections: SidebarSectionMetadata[];
  activeSidebarSection: string | null;
  onSetActiveSection: (id: string) => void;
  toggleSection: (id: string) => void;
  sectionContentProps: SectionContentSharedProps;
  onCollapse: () => void;
}) {
  const refSectionIds = useMemo(() => new Set(refSections.map(s => s.id as string)), [refSections]);
  const chatSection = chatSections.find(s => s.id === 'chat');

  // Derive active tab from which section is active in Redux
  // activeSidebarSection === null means "no accordion open" — stay on whichever tab was last shown
  // We use a ref to remember the last derived tab so collapsing an accordion doesn't switch tabs
  const derivedTab = activeSidebarSection
    ? (refSectionIds.has(activeSidebarSection) ? 'context' : 'chat')
    : null;
  const hasChat = chatSections.length > 0;
  const [lastTab, setLastTab] = useState<'chat' | 'context'>(hasChat ? 'chat' : 'context');
  const activeTab = !hasChat ? 'context' : (derivedTab ?? lastTab);

  return (
    <VStack gap={0} height="100%" overflow="hidden">
      {/* Tab bar */}
      <HStack w="100%" flexShrink={0} bg="bg.muted" px={3} py={2} gap={2} borderBottom="1px solid" borderColor="border.default">
        <Box
          flexShrink={0}
          cursor="pointer"
          onClick={onCollapse}
          color="fg.muted"
          _hover={{ color: 'fg.default' }}
          transition="color 0.2s"
          display="flex"
          alignItems="center"
        >
          <Icon as={LuChevronRight} boxSize={3.5} />
        </Box>
        {hasChat && (
          <HStack
            gap={1.5}
            justify="center"
            py={1}
            px={2.5}
            cursor="pointer"
            onClick={() => { setLastTab('chat'); onSetActiveSection('chat'); }}
            bg={activeTab === 'chat' ? 'bg.surface' : 'transparent'}
            borderRadius="md"
            border="1px solid"
            borderColor={activeTab === 'chat' ? 'border.default' : 'transparent'}
            transition="all 0.2s"
            _hover={{ bg: activeTab === 'chat' ? 'bg.surface' : 'bg.elevated' }}
          >
            <Icon as={LuMessageSquare} boxSize={3} color={activeTab === 'chat' ? 'accent.primary' : 'fg.muted'} />
            <Text
              fontSize="xs"
              fontWeight="600"
              fontFamily="mono"
              color={activeTab === 'chat' ? 'accent.primary' : 'fg.muted'}
            >
              Chat
            </Text>
          </HStack>
        )}
        <HStack
          gap={1.5}
          justify="center"
          py={1}
          px={2.5}
          cursor="pointer"
          onClick={() => { setLastTab('context'); const first = refSections[0]; if (first) onSetActiveSection(first.id); }}
          bg={activeTab === 'context' ? 'bg.surface' : 'transparent'}
          borderRadius="md"
          border="1px solid"
          borderColor={activeTab === 'context' ? 'border.default' : 'transparent'}
          transition="all 0.2s"
          _hover={{ bg: activeTab === 'context' ? 'bg.surface' : 'bg.elevated' }}
        >
          <Icon as={LuLayers} boxSize={3} color={activeTab === 'context' ? 'accent.secondary' : 'fg.muted'} />
          <Text
            fontSize="xs"
            fontWeight="600"
            fontFamily="mono"
            color={activeTab === 'context' ? 'accent.secondary' : 'fg.muted'}
          >
            Context
          </Text>
          {refSections.length > 0 && (
            <Box
              bg={activeTab === 'context' ? 'accent.secondary/20' : 'bg.elevated'}
              borderRadius="full"
              px={1.5}
              py={0}
            >
              <Text fontSize="2xs" fontWeight="700" color={activeTab === 'context' ? 'accent.secondary' : 'fg.muted'}>
                {refSections.length}
              </Text>
            </Box>
          )}
        </HStack>
      </HStack>

      {/* Tab content */}
      {activeTab === 'chat' ? (
        <Box flex="1" overflow="hidden" w="100%" minH={0}>
          {chatSection ? (
            <SectionContent section={chatSection} {...sectionContentProps} />
          ) : (
            <Box p={8} textAlign="center">
              <Text fontSize="sm" color="fg.muted">Chat not available</Text>
            </Box>
          )}
        </Box>
      ) : (
        <VStack gap={0} align="stretch" flex="1" overflowY="auto" w="100%" minH={0}>
          {refSections.map((section) => {
            const isExpanded = activeSidebarSection === section.id;
            return (
              <Box key={section.id} borderBottom="1px solid" borderColor="border.default">
                <SectionHeader section={section} isExpanded={isExpanded} onToggle={() => toggleSection(section.id)} />
                {isExpanded && (
                  <Box maxH={section.maxHeight || "none"} overflowY={section.maxHeight ? "auto" : "visible"}>
                    <SectionContent section={section} {...sectionContentProps} />
                  </Box>
                )}
              </Box>
            );
          })}
        </VStack>
      )}
    </VStack>
  );
}

// ============================================================================
// Right Sidebar Component
// ============================================================================

export default function RightSidebar({
  title = "Misc Info",
  filePath = '/',
  showChat = false,

  fileId,
  fileType,
  contextVersion,
  selectedContextPath,
  onContextChange,
}: RightSidebarProps) {
  const dispatch = useAppDispatch();
  const { isCollapsed, width, devMode, colorMode, activeSidebarSection } = useAppSelector(selectRightSidebarUIState);

  const { appState, loading: appStateLoading } = useAppState();
  const currentUser = useAppSelector(state => state.auth.user);

  const contextPath = selectedContextPath || filePath;
  // Folder pages and the explore sidebar (no fileType) apply childPaths scoping.
  // File pages (question, dashboard, etc.) are leaf nodes and see all context tables.
  const isFolderScope = !fileType || fileType === 'folder';
  const contextInfo = useContext(contextPath, contextVersion, isFolderScope);
  const databases = contextInfo.databases?.filter(db => db.schemas.length > 0);
  const documentation = contextInfo.documentation;
  const contextsLoading = contextInfo.contextLoading;

  const [isDragging, setIsDragging] = useState(false);
  const sidebarRef = useRef<HTMLDivElement>(null);

  const conversationID = useAppSelector(selectActiveConversation);
  const activeConversation = useAppSelector(state =>
    conversationID ? selectConversation(state, conversationID) : undefined
  );

  const isChatRunning = activeConversation && (
    activeConversation.executionState === 'WAITING' ||
    activeConversation.executionState === 'STREAMING' ||
    activeConversation.executionState === 'EXECUTING'
  );

  useEffect(() => {
    if (showChat && isChatRunning) {
      dispatch(setRightSidebarCollapsed(false));
      dispatch(setActiveSidebarSection('chat'));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isChatRunning, dispatch]);

  const handleToggle = () => {
    dispatch(setRightSidebarCollapsed(!isCollapsed));
  };

  const toggleSection = useCallback((sectionId: string) => {
    if (activeSidebarSection === sectionId) {
      dispatch(setActiveSidebarSection(null));
    } else {
      dispatch(setActiveSidebarSection(sectionId));
    }
  }, [activeSidebarSection, dispatch]);

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (sidebarRef.current) {
        const rect = sidebarRef.current.getBoundingClientRect();
        const newWidth = rect.right - e.clientX;
        const clampedWidth = Math.min(Math.max(newWidth, 350), 600);
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

  const homeFolder = currentUser ? resolveHomeFolderSync(currentUser.mode, currentUser.home_folder || '') : '';
  const selectContextFileCount = useMemo(() => makeSelectContextFileCount(), []);
  const mode: Mode = currentUser?.mode || 'org';
  const contextFileCount = useAppSelector(state => selectContextFileCount(state, homeFolder, mode));
  if (showChat) {
    sections.push(getSidebarSection('chat'));
  }

  if (onContextChange && contextFileCount > 1) {
    sections.push(getSidebarSection('context'));
  }

  sections.push(getSidebarSection('databases'));
  sections.push(getSidebarSection('documentation'));

  if (fileType === 'question') {
    sections.push(getSidebarSection('question-references'));
  }


  if (IS_DEV || devMode) {
    sections.push(getSidebarSection('dev'));
  }

  if (sections.length === 0) {
    return null;
  }

  // Split sections into chat vs reference
  const chatSectionIds = new Set(['chat']);
  const chatSections = sections.filter(s => chatSectionIds.has(s.id));
  const refSections = sections.filter(s => !chatSectionIds.has(s.id));

  const sectionContentProps: SectionContentSharedProps = {
    contextsLoading,
    databases,
    documentation,
    onContextChange,
    selectedContextPath,
    contextVersion,
    conversationID,
    filePath,
    appState,
    currentUser,
  };

  return (
    <>
      <HStack
        height="100vh"
        position="sticky"
        top={0}
        borderY="0px"
        borderColor="border.default"
        alignItems="center"
        gap={0}
        flexShrink={0}
        display={{ base: 'none', md: 'flex' }}
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
        {/* Icon Bar (when sidebar is closed) */}
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

          {/* Only show tab-level icons when collapsed: Chat + Context */}
          {showChat && (
            <Box
              p={3}
              bg="bg.surface"
              borderStyle="solid"
              borderLeftWidth="4px"
              borderColor="accent.primary"
              cursor="pointer"
              onClick={() => {
                dispatch(setActiveSidebarSection('chat'));
                dispatch(setRightSidebarCollapsed(false));
              }}
              _hover={{ bg: 'bg.muted' }}
              transition="all 0.2s"
            >
              <Tooltip content="Chat">
                <Icon as={LuMessageSquare} boxSize={5} color="accent.primary" />
              </Tooltip>
            </Box>
          )}
          {refSections.length > 0 && (
            <Box
              p={3}
              bg="bg.surface"
              borderStyle="solid"
              borderLeftWidth="4px"
              borderColor="accent.secondary"
              cursor="pointer"
              onClick={() => {
                const first = refSections[0];
                if (first) dispatch(setActiveSidebarSection(first.id));
                dispatch(setRightSidebarCollapsed(false));
              }}
              _hover={{ bg: 'bg.muted' }}
              transition="all 0.2s"
            >
              <Tooltip content="Context">
                <Icon as={LuLayers} boxSize={5} color="accent.secondary" />
              </Tooltip>
            </Box>
          )}
        </VStack>

        {/* Main content */}
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
            <Box flex="1" overflow="hidden" w="100%" minH={0}>
              <TabsLayout
                chatSections={chatSections}
                refSections={refSections}
                activeSidebarSection={activeSidebarSection}
                onSetActiveSection={(id) => dispatch(setActiveSidebarSection(id))}
                toggleSection={toggleSection}
                sectionContentProps={sectionContentProps}
                onCollapse={handleToggle}
              />
            </Box>
          </VStack>
      </Box>
    </HStack>
    </>
  );
}
