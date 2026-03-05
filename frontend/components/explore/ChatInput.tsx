'use client';

import { useState, useRef, KeyboardEvent, useEffect } from 'react';
import { Box, HStack, VStack, Textarea, IconButton, Icon, Grid, GridItem, Text } from '@chakra-ui/react';
import { LuSendHorizontal, LuPaperclip, LuSettings2, LuSquare, LuX } from 'react-icons/lu';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import { selectCompanyName } from '@/store/authSlice';
import { setSidebarPendingMessage, setSidebarDraft, selectSidebarDraft, setAskForConfirmation } from '@/store/uiSlice';
import { Checkbox } from '@/components/ui/checkbox';
import DatabaseSelector from '@/components/DatabaseSelector';
import { ContextSelector } from './ContextSelector';
import { useConfigs } from '@/lib/hooks/useConfigs';
import { LexicalMentionEditor } from '@/components/chat/LexicalMentionEditor';
import { DatabaseWithSchema, Attachment } from '@/lib/types';
import { extractTextFromPDF } from '@/lib/utils/pdf-extract';
import { toaster } from '@/components/ui/toaster';
import { Tooltip } from '@/components/ui/tooltip';

interface ChatInputProps {
  onSend: (message: string, attachments: Attachment[]) => void;
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
  whitelistedSchemas?: DatabaseWithSchema[];
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
  whitelistedSchemas,
}: ChatInputProps) {
  const dispatch = useAppDispatch();
  const companyName = useAppSelector(selectCompanyName);
  const { config } = useConfigs();
  const agentName = config.branding.agentName;
  const pendingMessage = useAppSelector((state) => state.ui.sidebarPendingMessage);
  const askForConfirmation = useAppSelector((state) => state.ui.askForConfirmation);

  // Use Redux for draft text (persists across unmount)
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Handle pending message from SearchBar — wait for connections/context to finish loading
  // before sending, so the message isn't discarded by the loading guard in handleSendMessage.
  useEffect(() => {
    if (pendingMessage && container === 'sidebar' && !connectionsLoading && !contextsLoading) {
      onSend(pendingMessage, []);
      dispatch(setSidebarPendingMessage(null));
    }
  }, [pendingMessage, container, dispatch, onSend, connectionsLoading, contextsLoading]);

  const handleSend = () => {
    if (input.trim() && !disabled && !isAgentRunning && !connectionsLoading && !contextsLoading) {
      onSend(input.trim(), attachments);
      setInput('');
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // Reset input so re-selecting the same file triggers onChange
    e.target.value = '';

    try {
      const { text, totalPages } = await extractTextFromPDF(file);
      setAttachments(prev => [
        ...prev,
        { type: 'text', name: file.name, content: text, metadata: { pages: totalPages } },
      ]);
    } catch (err: any) {
      toaster.create({ title: err.message || 'Failed to extract PDF text', type: 'error' });
    }
  };

  const removeAttachment = (index: number) => {
    setAttachments(prev => prev.filter((_, i) => i !== index));
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
                    whitelistedSchemas={whitelistedSchemas}
                  />
                </Box>

                {/* Hidden file input for PDF attachment */}
                <input
                  type="file"
                  accept=".pdf"
                  ref={fileInputRef}
                  style={{ display: 'none' }}
                  onChange={handleFileSelect}
                />

                {/* Attachment chips */}
                {attachments.length > 0 && (
                  <HStack px={3} py={1} gap={2} flexWrap="wrap" borderTop="1px solid" borderColor="border.muted">
                    {attachments.map((att, idx) => (
                      <HStack
                        key={idx}
                        bg="accent.teal/50"
                        borderRadius="md"
                        border={"1px solid"}
                        borderColor="accent.teal"
                        px={2}
                        py={1}
                        gap={1}
                        fontSize="xs"
                        fontFamily="mono"
                        color="white"
                      >
                        <Tooltip content={att.name} positioning={{ placement: 'top' }}>
                          <Text truncate maxW="150px">{att.name}</Text>
                        </Tooltip>
                        {att.metadata?.pages && (
                          <Text color="white">({att.metadata.pages} pages)</Text>
                        )}
                        <IconButton
                          aria-label="Remove attachment"
                          onClick={() => removeAttachment(idx)}
                          variant="ghost"
                          size="2xs"
                          minW="auto"
                          h="auto"
                          p={0}
                        >
                          <Icon as={LuX} boxSize={3} />
                        </IconButton>
                      </HStack>
                    ))}
                  </HStack>
                )}

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

                <HStack gap={1}>
                  <Tooltip content="Attach PDF" positioning={{ placement: 'top' }}>
                    <IconButton
                      aria-label="Attach PDF"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={isAgentRunning}
                      variant="ghost"
                      size="sm"
                      color="fg.muted"
                      _hover={{ color: 'accent.teal' }}
                      _disabled={{ opacity: 0.4, cursor: 'not-allowed' }}
                      borderRadius="md"
                      flexShrink={0}
                    >
                      <Icon as={LuPaperclip} boxSize={4} />
                    </IconButton>
                  </Tooltip>

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
                </HStack>
            </VStack>
            </Box>
        </GridItem>
    </Grid>
  );
}
