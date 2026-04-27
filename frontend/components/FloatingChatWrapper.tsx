'use client';

import { useState, useCallback } from 'react';
import { Box, Portal } from '@chakra-ui/react';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import { setRightSidebarCollapsed, setSidebarPendingMessage, setActiveSidebarSection } from '@/store/uiSlice';
import { useContext } from '@/lib/hooks/useContext';
import { selectDatabase } from '@/lib/utils/database-selector';
import ChatInput from './explore/ChatInput';
import { Attachment } from '@/lib/types';

// Sidebar width constants (must match Sidebar.tsx)
const SIDEBAR_WIDTH_EXPANDED = '260px';
const SIDEBAR_WIDTH_COLLAPSED = '72px';
const RIGHTSIDEBAR_WIDTH_COLLAPSED = '49px';

interface FloatingChatWrapperProps {
  filePath?: string;
  databaseName?: string;
  inBottomBar?: boolean;
}

export default function FloatingChatWrapper({
  filePath,
  databaseName: propDatabaseName,
  inBottomBar = false,
}: FloatingChatWrapperProps) {
  const [isFocused, setIsFocused] = useState(false);
  const dispatch = useAppDispatch();
  const leftSidebarCollapsed = useAppSelector(state => state.ui.leftSidebarCollapsed);
  const rightSidebarCollapsed = useAppSelector(state => state.ui.rightSidebarCollapsed);
  const rightSidebarWidth = useAppSelector(state => state.ui.rightSidebarWidth);

  // Load context databases
  const contextInfo = useContext(filePath || '/');
  const defaultDatabase = selectDatabase(contextInfo.databases, propDatabaseName);
  const [localDatabase, setLocalDatabase] = useState<string | null>(null);
  const databaseName = localDatabase ?? defaultDatabase;

  // Calculate sidebar widths for positioning
  const leftWidth = leftSidebarCollapsed ? SIDEBAR_WIDTH_COLLAPSED : SIDEBAR_WIDTH_EXPANDED;
  const rightWidth = rightSidebarCollapsed ? RIGHTSIDEBAR_WIDTH_COLLAPSED : `${rightSidebarWidth}px`;

  // Hide floating bar when right sidebar is open (chat visible there)
  const hideFloatingBar = !inBottomBar && !rightSidebarCollapsed;

  const handleSend = useCallback((message: string, _attachments: Attachment[]) => {
    if (!message.trim()) return;
    dispatch(setSidebarPendingMessage(message.trim()));
    dispatch(setActiveSidebarSection('chat'));
    dispatch(setRightSidebarCollapsed(false));
  }, [dispatch]);

  const handleDatabaseChange = useCallback((name: string) => {
    setLocalDatabase(name);
  }, []);

  const noop = useCallback(() => {}, []);

  // Track focus from ChatInput via a wrapper that listens for focusin/focusout
  const handleFocusIn = useCallback(() => setIsFocused(true), []);
  const handleFocusOut = useCallback((e: React.FocusEvent) => {
    // Only blur if focus left the wrapper entirely
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsFocused(false);
    }
  }, []);

  const content = (
    <Box
      onFocus={handleFocusIn}
      onBlur={handleFocusOut}
    >
      <ChatInput
        onSend={handleSend}
        onStop={noop}
        isAgentRunning={false}
        disabled={false}
        databaseName={databaseName}
        onDatabaseChange={handleDatabaseChange}
        container="floating"
        isCompact={true}
        whitelistedSchemas={contextInfo.databases}
      />
    </Box>
  );

  if (inBottomBar) {
    return content;
  }

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
      {/* Dimming overlay when focused */}
      {isFocused && (
        <Portal>
          <Box
            position="fixed"
            top={0}
            left={0}
            width="100vw"
            height="100vh"
            bg="fg.subtle/20"
            zIndex={999}
          />
        </Portal>
      )}
      <Box
        pointerEvents="auto"
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
