'use client';

import { useCallback, useState } from 'react';
import { Box, Portal } from '@chakra-ui/react';
import { useAppDispatch } from '@/store/hooks';
import { setSidebarPendingMessage, addChatAttachment } from '@/store/uiSlice';
import { useContext } from '@/lib/hooks/useContext';
import { useSlashCommands, tryExecuteSlashCommand } from '@/components/explore/slash-commands';
import { selectDatabase } from '@/lib/utils/database-selector';
import ChatInput from '@/components/explore/ChatInput';
import type { Attachment } from '@/lib/types';
import type { AppState } from '@/lib/appState';

interface ShareFloatingChatProps {
  /** Context (folder) path the guest session is scoped to. */
  contextPath: string;
  /** Story app-state so the chat knows what "this report" refers to. */
  appState?: AppState | null;
  /** Width of the collapsed chat rail on the right — the bar stops short of it. */
  railWidth: string;
  /** Open the (collapsed) chat panel so the sidebar input can pick up the message. */
  onOpenChat: () => void;
}

/**
 * The floating "ask anything" bar from the main app, adapted for the shared
 * story page. Mirrors FloatingChatWrapper's handoff — it writes the message to
 * `ui.sidebarPendingMessage`, which the sidebar's ChatInput auto-sends once the
 * panel is open — but positions itself against the share layout (no left
 * sidebar; fixed right panel) and opens the panel via the page's local state
 * rather than the Redux right-sidebar.
 *
 * Only mounted once the guest can chat (post lead-gate); the caller gates it.
 */
export default function ShareFloatingChat({ contextPath, appState, railWidth, onOpenChat }: ShareFloatingChatProps) {
  const dispatch = useAppDispatch();
  const [isFocused, setIsFocused] = useState(false);

  const contextInfo = useContext(contextPath);
  const defaultDatabase = selectDatabase(contextInfo.databases, undefined);
  const [localDatabase, setLocalDatabase] = useState<string | null>(null);
  const databaseName = localDatabase ?? defaultDatabase;

  const { availableCommands, handleCommandExecute } = useSlashCommands({ appState });

  const handleSend = useCallback((message: string, attachments: Attachment[]) => {
    if (!message.trim()) return;
    if (tryExecuteSlashCommand(message.trim(), availableCommands, handleCommandExecute)) return;
    // Hand off to the sidebar chat: re-add attachments (the sidebar input reads
    // chatAttachments), stash the message, and open the panel so it's consumed.
    attachments.forEach(a => dispatch(addChatAttachment(a)));
    dispatch(setSidebarPendingMessage(message.trim()));
    onOpenChat();
  }, [dispatch, availableCommands, handleCommandExecute, onOpenChat]);

  const handleDatabaseChange = useCallback((name: string) => setLocalDatabase(name), []);
  const noop = useCallback(() => {}, []);

  const handleFocusIn = useCallback(() => setIsFocused(true), []);
  const handleFocusOut = useCallback((e: React.FocusEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsFocused(false);
  }, []);

  return (
    <Box
      position="fixed"
      bottom={3}
      left={0}
      right={railWidth}
      pointerEvents="none"
      zIndex={1000}
      display={{ base: 'none', md: 'block' }}
    >
      {isFocused && (
        <Portal>
          <Box position="fixed" top={0} left={0} width="100vw" height="100vh" bg="fg.subtle/20" zIndex={999} />
        </Portal>
      )}
      <Box pointerEvents="auto" position="relative" zIndex={1000}>
        <Box maxW="1280px" mx="auto" px={{ base: 8, md: 12, lg: 16 }}>
          <Box onFocus={handleFocusIn} onBlur={handleFocusOut}>
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
              selectedContextPath={contextPath}
              availableSkills={contextInfo.availableSkills}
              availableCommands={availableCommands}
              onCommandExecute={handleCommandExecute}
            />
          </Box>
        </Box>
      </Box>
    </Box>
  );
}
