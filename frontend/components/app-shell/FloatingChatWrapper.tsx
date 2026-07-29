'use client';

import { useState, useCallback } from 'react';
import { Box } from '@chakra-ui/react';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import { setRightSidebarCollapsed, setSidebarPendingMessage, setChatAgentSelection, setChatGradeSelection, setSidebarPendingSlashCommand, setActiveSidebarSection, addChatAttachment } from '@/store/uiSlice';
import { useContext } from '@/lib/hooks/useContext';
import { useClearChat, useSlashCommands, tryExecuteSlashCommand } from '../explore/slash-commands';
import { selectDatabase } from '@/lib/utils/database-selector';
import ChatInput from '../explore/ChatInput';
import type { Attachment, SlashCommand } from '@/lib/types';
import type { AppState } from '@/lib/appState';
import type { LlmGrade } from '@/lib/llm/llm-config-types';

// Sidebar width constants (must match Sidebar.tsx)
const SIDEBAR_WIDTH_EXPANDED = '260px';
const SIDEBAR_WIDTH_COLLAPSED = '72px';
const RIGHTSIDEBAR_WIDTH_COLLAPSED = '49px';

interface FloatingChatWrapperProps {
  filePath?: string;
  databaseName?: string;
  selectedContextPath?: string | null;
  contextVersion?: number;
  onContextChange?: (path: string | null, version?: number) => void;
  appState?: AppState | null;
}

export default function FloatingChatWrapper({
  filePath,
  databaseName: propDatabaseName,
  selectedContextPath,
  contextVersion,
  onContextChange,
  appState,
}: FloatingChatWrapperProps) {
  const dispatch = useAppDispatch();
  const leftSidebarCollapsed = useAppSelector(state => state.ui.leftSidebarCollapsed);
  const rightSidebarCollapsed = useAppSelector(state => state.ui.rightSidebarCollapsed);
  const rightSidebarWidth = useAppSelector(state => state.ui.rightSidebarWidth);
  const selectedGrade = useAppSelector(state => state.ui.chatGradeSelection);
  const selectedAgent = useAppSelector(state => state.ui.chatAgentSelection);

  // Load context databases using the shared context path from the parent
  const effectiveContextPath = selectedContextPath || filePath || '/';
  const contextInfo = useContext(effectiveContextPath, contextVersion);
  const defaultDatabase = selectDatabase(contextInfo.databases, propDatabaseName);
  const [localDatabase, setLocalDatabase] = useState<string | null>(null);
  const databaseName = localDatabase ?? defaultDatabase;

  // Calculate sidebar widths for positioning
  const leftWidth = leftSidebarCollapsed ? SIDEBAR_WIDTH_COLLAPSED : SIDEBAR_WIDTH_EXPANDED;
  const rightWidth = rightSidebarCollapsed ? RIGHTSIDEBAR_WIDTH_COLLAPSED : `${rightSidebarWidth}px`;

  // Hide floating bar when right sidebar is open (chat visible there)
  const hideFloatingBar = !rightSidebarCollapsed;

  const clearChat = useClearChat();
  const handleFloatingCommandExecute = useCallback((command: SlashCommand) => {
    dispatch(setSidebarPendingSlashCommand(command.name));
    dispatch(setActiveSidebarSection('chat'));
    dispatch(setRightSidebarCollapsed(false));
  }, [dispatch]);

  const { availableCommands } = useSlashCommands({ appState });
  const handleSend = useCallback((message: string, attachments: Attachment[]) => {
    if (!message.trim()) return;
    if (tryExecuteSlashCommand(message.trim(), availableCommands, handleFloatingCommandExecute)) return;
    clearChat();
    // clearChat() clears chatAttachments — re-add the ones being sent so the sidebar
    // hand-off (which reads chatAttachments) carries the user's attachments through.
    attachments.forEach(a => dispatch(addChatAttachment(a)));
    dispatch(setSidebarPendingMessage(message.trim()));
    dispatch(setActiveSidebarSection('chat'));
    dispatch(setRightSidebarCollapsed(false));
  }, [dispatch, clearChat, availableCommands, handleFloatingCommandExecute]);

  const handleDatabaseChange = useCallback((name: string) => {
    setLocalDatabase(name);
  }, []);

  const handleGradeChange = useCallback((grade: LlmGrade | null) => {
    dispatch(setChatGradeSelection(grade));
  }, [dispatch]);

  const handleAgentChange = useCallback((name: string | null) => {
    dispatch(setChatAgentSelection(name));
  }, [dispatch]);

  const noop = useCallback(() => {}, []);

  const content = (
    <Box>
      <ChatInput
        onSend={handleSend}
        onStop={noop}
        isAgentRunning={false}
        disabled={false}
        databaseName={databaseName}
        onDatabaseChange={handleDatabaseChange}
        selectedGrade={selectedGrade}
        onGradeChange={handleGradeChange}
        agentOptions={(contextInfo.agents ?? []).map(agent => ({
          name: agent.name,
          description: agent.description,
        }))}
        selectedAgent={selectedAgent}
        onAgentChange={handleAgentChange}
        container="floating"
        isCompact={true}
        whitelistedSchemas={contextInfo.databases}
        selectedContextPath={effectiveContextPath}
        selectedVersion={contextVersion}
        onContextChange={onContextChange}
        availableSkills={contextInfo.availableSkills}
        availableCommands={availableCommands}
        onCommandExecute={handleFloatingCommandExecute}
      />
    </Box>
  );

  return (
    <Box
      position="fixed"
      bottom={{ base: "80px", md: 3 }}
      left={{ base: 0, md: leftWidth }}
      right={{ base: 0, md: rightWidth }}
      pointerEvents="none"
      zIndex={1000}
      transition="left 0.2s ease, right 0.3s ease, opacity 0.2s ease"
      opacity={hideFloatingBar ? 0 : 1}
      visibility={hideFloatingBar ? "hidden" : "visible"}
    >
      {/* The dimming overlay lives INSIDE ChatInput (floating mode), driven by the
          same collapsed/expanded state as the bar — never tracked separately here.
          Pointer events stay OFF for this full-width row (inherited from the fixed
          wrapper); ChatInput re-enables them on the centered pill only, so clicks
          beside the pill fall through to the page. */}
      <Box
        position="relative"
        zIndex={1000}
      >
        <Box maxW="1280px" mx="auto" px={{ base: 8, md: 12, lg: 16 }}>
          {content}
        </Box>
      </Box>
    </Box>
  );
}
