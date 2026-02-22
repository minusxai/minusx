'use client';

import { useState, useRef, useEffect } from 'react';
import { Box, IconButton, Icon, HStack } from '@chakra-ui/react';
import { LuSendHorizontal } from 'react-icons/lu';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import { setRightSidebarCollapsed, setSidebarPendingMessage, setActiveSidebarSection } from '@/store/uiSlice';
import { LexicalMentionEditor, LexicalMentionEditorRef } from '@/components/chat/LexicalMentionEditor';
import { useContext } from '@/lib/hooks/useContext';
import { selectDatabase } from '@/lib/utils/database-selector';

// Sidebar width constants (must match Sidebar.tsx)
const SIDEBAR_WIDTH_EXPANDED = '260px';
const SIDEBAR_WIDTH_COLLAPSED = '72px';
const RIGHTSIDEBAR_WIDTH_COLLAPSED = '49px';
import { useConfigs } from '@/lib/hooks/useConfigs';

interface SearchBarProps {
    inBottomBar?: boolean;
    disabled?: boolean;
    filePath?: string;  // Context path for loading databases
    databaseName?: string;  // Current database (from question/dashboard appState)
}

export default function SearchBar({
    inBottomBar = false,
    disabled = false,
    filePath,
    databaseName: propDatabaseName,
}: SearchBarProps) {
  const [input, setInput] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  const editorRef = useRef<LexicalMentionEditorRef>(null);
  const dispatch = useAppDispatch();
  const leftSidebarCollapsed = useAppSelector(state => state.ui.leftSidebarCollapsed);
  const rightSidebarCollapsed = useAppSelector(state => state.ui.rightSidebarCollapsed);
  const rightSidebarWidth = useAppSelector(state => state.ui.rightSidebarWidth);

  // Load context databases when filePath is provided
  const contextInfo = useContext(filePath || '/');
  // Use prop databaseName if provided, otherwise fall back to selected database from context
  const databaseName = selectDatabase(contextInfo.databases, propDatabaseName);

  // Calculate sidebar widths for positioning offset
  const leftWidth = leftSidebarCollapsed ? SIDEBAR_WIDTH_COLLAPSED : SIDEBAR_WIDTH_EXPANDED;
  const rightWidth = rightSidebarCollapsed ? RIGHTSIDEBAR_WIDTH_COLLAPSED : `${rightSidebarWidth}px`;

  // Get company-specific config from Redux
  const { config } = useConfigs();
  const agentName = config.branding.agentName;

  // Detect platform for keyboard shortcut display
  const isMac = typeof window !== 'undefined' && navigator.platform.toUpperCase().indexOf('MAC') >= 0;
  const shortcutKey = isMac ? '⌘+k' : 'Ctrl+k';

  // Global keyboard shortcut: Cmd+K (Mac) or Ctrl+K (other platforms)
  useEffect(() => {
    const handleKeyDown = (e: globalThis.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        editorRef.current?.focus();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleSend = () => {
    if (input.trim() && !disabled) {
      // Set pending message in Redux
      dispatch(setSidebarPendingMessage(input.trim()));

      // Set active section to 'chat' (will close all others and open only chat)
      dispatch(setActiveSidebarSection('chat'));

      // Open the sidebar
      dispatch(setRightSidebarCollapsed(false));

      setInput('');
    }
  };

  return (
    <Box
          position={inBottomBar ? "relative" : "fixed"}
          bottom={inBottomBar ? "auto" : { base: "80px", md: 3 }}
          left={inBottomBar ? "auto" : { base: 0, md: leftWidth }}
          right={inBottomBar ? "auto" : { base: 0, md: rightWidth }}
          pointerEvents="none"
          zIndex={1000}
          transition="left 0.2s ease, right 0.3s ease"
        >
        <Box
        pointerEvents="auto"
        transition="margin-right 0.2s ease"
        >
            <Box maxW={inBottomBar ? "100%" : "1280px"} mx="auto" px={{ base: 8, md: 12, lg: 16 }}>
                <Box
                aria-label="search-bar"
                mx="auto"
                width={isFocused ? { base: '90%', md: '600px', lg: '700px' } : { base: '85%', md: '350px', lg: '350px' }}
                transition="width 0.25s ease-in-out"
                >
                <HStack
                    position="relative"
                    border="1px solid"
                    borderColor="fg.default/30"
                    borderRadius="3xl"
                    bg="bg.subtle"
                    pr={3}
                    _focusWithin={{
                    borderColor: 'accent.teal',
                    boxShadow: (inBottomBar ? 'none' : '0 0 0 1px var(--chakra-colors-accent-teal)')
                    }}
                    transition="all 0.2s"
                    backdropFilter={inBottomBar ? 'none' : 'blur(12px)'}
                    boxShadow={inBottomBar ? 'none' : 'lg'}
                >
                    <LexicalMentionEditor
                      ref={editorRef}
                      placeholder={`Ask ${agentName} anything (${shortcutKey})`}
                      disabled={disabled}
                      singleLine={true}
                      onSubmit={handleSend}
                      onChange={setInput}
                      onFocus={() => setIsFocused(true)}
                      onBlur={() => setIsFocused(false)}
                      databaseName={databaseName}
                      whitelistedSchemas={contextInfo.databases}
                    />

                    {/* Send Button */}
                    <IconButton
                    aria-label="Send message"
                    onClick={handleSend}
                    disabled={disabled || !input.trim()}
                    bg="accent.teal"
                    color="white"
                    _hover={{ bg: 'accent.teal', opacity: 0.9 }}
                    _disabled={{ opacity: 0.4, cursor: 'not-allowed' }}
                    size="xs"
                    borderRadius="md"
                    >
                    <Icon as={LuSendHorizontal} boxSize={3.5} />
                    </IconButton>
                </HStack>
                </Box>
            </Box>
        </Box>
    </Box>
  );
}
