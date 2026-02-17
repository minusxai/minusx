'use client';

import { useState, KeyboardEvent, useEffect } from 'react';
import { Box, HStack, VStack, Textarea, IconButton, Icon, Grid, GridItem, Text } from '@chakra-ui/react';
import { LuSendHorizontal, LuPaperclip, LuSettings2, LuSquare } from 'react-icons/lu';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import { selectCompanyName } from '@/store/authSlice';
import { setSidebarPendingMessage, setSidebarDraft, selectSidebarDraft, setAskForConfirmation } from '@/store/uiSlice';
import { Checkbox } from '@/components/ui/checkbox';
import DatabaseSelector from '@/components/DatabaseSelector';
import { ContextSelector } from './ContextSelector';
import { useConfigs } from '@/lib/hooks/useConfigs';
import { LexicalMentionEditor } from '@/components/chat/LexicalMentionEditor';

interface ChatInputProps {
  onSend: (message: string) => void;
  onStop: () => void;
  isAgentRunning: boolean;
  disabled?: boolean;
  databaseName: string;
  onDatabaseChange: (name: string) => void;
  container?: 'page' | 'sidebar';
  isCompact: boolean;
  connectionsLoading?: boolean;
  contextsLoading?: boolean;
  selectedContextPath?: string | null;
  selectedVersion?: number;
  onContextChange?: (contextPath: string | null, version?: number) => void;
}

export default function ChatInput({
  onSend,
  onStop,
  isAgentRunning,
  disabled = false,
  databaseName,
  onDatabaseChange,
  container = 'page',
  isCompact,
  connectionsLoading = false,
  contextsLoading = false,
  selectedContextPath,
  selectedVersion,
  onContextChange,
}: ChatInputProps) {
  const dispatch = useAppDispatch();
  const companyName = useAppSelector(selectCompanyName);
  const { config } = useConfigs();
  const agentName = config.branding.agentName;
  const pendingMessage = useAppSelector((state) => state.ui.sidebarPendingMessage);
  const askForConfirmation = useAppSelector((state) => state.ui.askForConfirmation);

  // Use Redux for draft text (persists across unmount)
  const [input, setInput] = useState('');
  // Handle pending message from SearchBar
  useEffect(() => {
    if (pendingMessage && container === 'sidebar') {
      // Use setTimeout to ensure component is fully mounted and ready
      setTimeout(() => {
        onSend(pendingMessage);
        dispatch(setSidebarPendingMessage(null)); // Clear after using
      }, 0);
    }
  }, [pendingMessage, container, dispatch, onSend]);

  const handleSend = () => {
    if (input.trim() && !disabled && !isAgentRunning && !connectionsLoading && !contextsLoading) {
      onSend(input.trim());
      setInput('');
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const colSpan = isCompact ? 12 : { base: 12, md: 8, lg: 6 };
  const colStart = isCompact ? 1 : { base: 1, md: 3, lg: 4 };

  return (
    <Grid templateColumns={{ base: 'repeat(12, 1fr)', md: 'repeat(12, 1fr)' }}
            gap={2}
            w="100%"
        >
        <GridItem colSpan={colSpan} colStart={colStart}>
            <Box
            border="1px solid"
            borderColor="border.default"
            borderRadius="md"
            bg="bg.canvas"
            _focusWithin={{ borderColor: 'accent.teal', boxShadow: '0 0 0 1px var(--chakra-colors-accent-teal)' }}
            transition="all 0.2s"
            >
            <VStack gap={0} align="stretch">
                {/* Textarea with Mentions Support */}
                <Box px={1} py={2}>
                  <LexicalMentionEditor
                    placeholder={isAgentRunning ? `${agentName} is thinking...` : `Ask ${agentName} anything!`}
                    databaseName={databaseName}
                    disabled={disabled || isAgentRunning}
                    onSubmit={handleSend}
                    onChange={setInput}
                  />
                </Box>

                {/* Bottom Control Bar */}
                <HStack
                px={3}
                pb={2}
                pt={2}
                justify="space-between"
                borderTop="1px solid"
                borderColor="border.muted"
                gap={2}
                >
                {/* Left controls - Context selector + Database selector (page) or Auto-accept checkbox (sidebar) */}
                <HStack gap={2}>
                    {container === 'sidebar' ? (
                      <Checkbox
                        checked={!askForConfirmation}
                        onCheckedChange={({ checked }) => dispatch(setAskForConfirmation(!checked))}
                        size="sm"
                      >
                        <Text fontSize="xs" color="fg.muted" fontFamily="mono">Auto-accept Changes</Text>
                      </Checkbox>
                    ) : (
                      <HStack gap={2} align="stretch">
                        {onContextChange && (
                          <ContextSelector
                            selectedContextPath={selectedContextPath || null}
                            selectedVersion={selectedVersion}
                            onSelectContext={onContextChange}
                          />
                        )}
                        <DatabaseSelector
                          value={databaseName}
                          onChange={onDatabaseChange}
                          size="sm"
                        />
                      </HStack>
                    )}
                </HStack>

                {isAgentRunning ? (
                  <IconButton
                    aria-label="Stop agent"
                    onClick={onStop}
                    bg="accent.danger"
                    color="white"
                    _hover={{ bg: 'accent.danger', opacity: 0.9 }}
                    size="sm"
                    borderRadius="md"
                    flexShrink={0}
                    px={2}
                  > Stop
                    <Icon as={LuSquare} boxSize={3.5} fill="white"/>
                  </IconButton>
                ) : (
                  <IconButton
                    aria-label="Send message"
                    onClick={handleSend}
                    disabled={disabled || !input.trim() || connectionsLoading || contextsLoading}
                    bg="accent.teal"
                    color="white"
                    _hover={{ bg: 'accent.teal', opacity: 0.9 }}
                    _disabled={{ opacity: 0.4, cursor: 'not-allowed' }}
                    size="sm"
                    borderRadius="md"
                    flexShrink={0}
                  >
                    <Icon as={LuSendHorizontal} boxSize={4} />
                  </IconButton>
                )}
                </HStack>
            </VStack>
            </Box>
        </GridItem>
    </Grid>
  );
}
