'use client';

import { useState, useRef, KeyboardEvent, useEffect } from 'react';
import { Box, HStack, VStack, Textarea, IconButton, Icon, Grid, GridItem, Text, Spinner } from '@chakra-ui/react';
import { LuSendHorizontal, LuPaperclip, LuSettings2, LuX } from 'react-icons/lu';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import { selectCompanyName } from '@/store/authSlice';
import { setSidebarPendingMessage, setSidebarDraft, selectSidebarDraft, selectChatAttachments, addChatAttachment, removeChatAttachment, clearChatAttachments } from '@/store/uiSlice';
import DatabaseSelector from '@/components/DatabaseSelector';
import { ContextSelector } from './ContextSelector';
import { useConfigs } from '@/lib/hooks/useConfigs';
import { LexicalMentionEditor, LexicalMentionEditorRef } from '@/components/chat/LexicalMentionEditor';
import { DatabaseWithSchema, Attachment } from '@/lib/types';
import { extractTextFromDocument, SUPPORTED_DOC_EXTENSIONS } from '@/lib/utils/attachment-extract';
import { uploadFile } from '@/lib/object-store/client';
import { toaster } from '@/components/ui/toaster';
import { Tooltip } from '@/components/ui/tooltip';

interface ChatInputProps {
  onSend: (message: string, attachments: Attachment[]) => void;
  onStop: () => void;
  isAgentRunning: boolean;
  allowChatQueue?: boolean;
  disabled?: boolean;
  isPreparing?: boolean;
  databaseName: string;
  onDatabaseChange: (name: string) => void;
  container?: 'page' | 'sidebar' | 'floating';
  isCompact: boolean;
  colSpan?: any;
  colStart?: any;
  connectionsLoading?: boolean;
  contextsLoading?: boolean;
  selectedContextPath?: string | null;
  selectedVersion?: number;
  onContextChange?: (contextPath: string | null, version?: number) => void;
  whitelistedSchemas?: DatabaseWithSchema[];
  prefillText?: string;
}

export default function ChatInput({
  onSend,
  onStop,
  isAgentRunning,
  allowChatQueue = false,
  disabled = false,
  isPreparing = false,
  databaseName,
  onDatabaseChange,
  container = 'page',
  isCompact,
  colSpan: colSpanProp,
  colStart: colStartProp,
  connectionsLoading = false,
  contextsLoading = false,
  selectedContextPath,
  selectedVersion,
  onContextChange,
  whitelistedSchemas,
  prefillText,
}: ChatInputProps) {
  const dispatch = useAppDispatch();
  const companyName = useAppSelector(selectCompanyName);
  const { config } = useConfigs();
  const agentName = config.branding.agentName;
  const pendingMessage = useAppSelector((state) => state.ui.sidebarPendingMessage);


  // Use Redux for draft text (persists across unmount)
  const [input, setInput] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [uploadingNames, setUploadingNames] = useState<string[]>([]);
  const attachments = useAppSelector(selectChatAttachments);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<LexicalMentionEditorRef>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const prevIsPreparingRef = useRef(false);

  const isFloating = container === 'floating';
  const hasContent = input.trim().length > 0 || attachments.length > 0;
  const isCollapsed = isFloating && !isFocused && !hasContent;

  // Detect platform for keyboard shortcut display
  const isMac = typeof window !== 'undefined' && navigator.platform.toUpperCase().indexOf('MAC') >= 0;
  const shortcutKey = isMac ? '⌘+k' : 'Ctrl+k';

  // Global Cmd+K shortcut for floating mode
  useEffect(() => {
    if (!isFloating) return;
    const handleKeyDown = (e: globalThis.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        editorRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isFloating]);

  // Clear input only after preparation completes (isPreparing: true → false)
  // so the text stays visible (greyed) while chart images are being uploaded.
  useEffect(() => {
    if (prevIsPreparingRef.current && !isPreparing) {
      setInput('');
      editorRef.current?.clear();
      dispatch(clearChatAttachments());
    }
    prevIsPreparingRef.current = isPreparing;
  }, [isPreparing, dispatch]);
  // Handle prefill text (e.g., from queued messages after stop)
  useEffect(() => {
    if (prefillText) {
      setInput(prefillText);
      editorRef.current?.setText(prefillText);
      editorRef.current?.focus();
    }
  }, [prefillText]);

  // Handle pending message from floating chat — wait for connections/context to finish loading
  // before sending, so the message isn't discarded by the loading guard in handleSendMessage.
  useEffect(() => {
    if (pendingMessage && container === 'sidebar' && !connectionsLoading && !contextsLoading) {
      onSend(pendingMessage, attachments);
      dispatch(setSidebarPendingMessage(null));
      dispatch(clearChatAttachments());
    }
  }, [pendingMessage, container, dispatch, onSend, connectionsLoading, contextsLoading]);

  const chatLocked = isAgentRunning && !allowChatQueue;

  const handleSend = () => {
    if (input.trim() && !disabled && !isPreparing && !connectionsLoading && !contextsLoading && !chatLocked) {
      onSend(input.trim(), attachments);
      // Don't clear here — input stays greyed while isPreparing=true,
      // then cleared by the useEffect when isPreparing transitions to false.
    }
  };

  const processFile = async (file: File) => {
    if (file.type.startsWith('image/')) {
      setUploadingNames(prev => [...prev, file.name]);
      try {
        const { publicUrl } = await uploadFile(file, () => {});
        dispatch(addChatAttachment({ type: 'image', name: file.name, content: publicUrl, metadata: {} }));
      } catch (err: any) {
        toaster.create({ title: err.message || 'Failed to upload image', type: 'error' });
      } finally {
        setUploadingNames(prev => prev.filter((_, i) => i !== prev.indexOf(file.name)));
      }
    } else {
      try {
        const { text, pages, wordCount } = await extractTextFromDocument(file);
        const metadata: Attachment['metadata'] = {};
        if (pages) metadata.pages = pages;
        if (wordCount) metadata.wordCount = wordCount;
        dispatch(addChatAttachment({ type: 'text', name: file.name, content: text, metadata }));
      } catch (err: any) {
        toaster.create({ title: err.message || 'Failed to extract document text', type: 'error' });
      }
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    await Promise.all(files.map(processFile));
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (!isAgentRunning) setIsDraggingOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    // Only clear when leaving the box itself, not a child element
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDraggingOver(false);
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingOver(false);
    if (isAgentRunning) return;
    const files = Array.from(e.dataTransfer.files ?? []);
    await Promise.all(files.map(processFile));
  };

  const removeAttachment = (index: number) => {
    dispatch(removeChatAttachment(index));
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const colSpan = colSpanProp ?? (isFloating ? 12 : isCompact ? 12 : { base: 12, md: 8, lg: 6 });
  const colStart = colStartProp ?? (isFloating ? 1 : isCompact ? 1 : { base: 1, md: 3, lg: 4 });

  const placeholder = isFloating
    ? `Ask ${agentName} anything (${shortcutKey})`
    : chatLocked ? `${agentName} is still working...` : isAgentRunning ? `Add to agent queue...` : `Ask ${agentName} anything!`;

  return (
    <Grid templateColumns={{ base: 'repeat(12, 1fr)', md: 'repeat(12, 1fr)' }}
            gap={2}
            w="100%"
        >
        <GridItem colSpan={colSpan} colStart={colStart}>
            <Box
            mx={isFloating ? 'auto' : undefined}
            width={isFloating ? (isCollapsed ? { base: '85%', md: '450px', lg: '450px' } : { base: '90%', md: '600px', lg: '700px' }) : undefined}
            transition="width 0.25s ease, border-radius 0.25s ease"
            >
            <Box
            ref={containerRef}
            border="1px solid"
            borderColor={isDraggingOver ? 'accent.teal' : isFloating ? 'fg.default/30' : 'border.default'}
            boxShadow={isDraggingOver ? '0 0 0 1px var(--chakra-colors-accent-teal)' : isFloating ? 'lg' : undefined}
            borderRadius="xl"
            bg={isFloating ? 'bg.subtle' : 'bg.canvas'}
            backdropFilter={isFloating ? 'blur(12px)' : undefined}
            _focusWithin={isPreparing ? undefined : { borderColor: 'accent.teal', boxShadow: isFloating ? '0 0 0 1px var(--chakra-colors-accent-teal), 0 10px 15px -3px rgba(0, 0, 0, 0.1)' : '0 0 0 1px var(--chakra-colors-accent-teal)' }}
            transition="border-radius 0.25s ease, border-color 0.2s ease, box-shadow 0.2s ease, opacity 0.2s ease, background 0.2s ease"
            opacity={isPreparing ? 0.5 : 1}
            pointerEvents={isPreparing ? 'none' : undefined}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            cursor="text"
            onMouseDown={(e) => {
              // Focus editor when clicking empty space — skip if clicking a button/input/select
              const target = e.target as HTMLElement;
              if (!target.closest('button, input, select, [role="listbox"], [role="option"], [data-lexical-editor]')) {
                e.preventDefault(); // Prevent blur from firing
                editorRef.current?.focus();
              }
            }}
            >
            <VStack gap={0} align="stretch">
                {/* Editor row with inline send button (collapsed only) */}
                <HStack gap={0} align="center" pr={isCollapsed ? 3 : 0}>
                  <Box flex="1" px={1} py={isCollapsed ? 0 : 2} transition="padding 0.25s ease">
                    <Box
                      maxHeight={isCollapsed ? '40px' : '200px'}
                      overflow={isCollapsed ? 'hidden' : 'auto'}
                      transition={isFloating ? 'max-height 0.25s ease' : undefined}
                    >
                      <LexicalMentionEditor
                        ref={editorRef}
                        placeholder={placeholder}
                        databaseName={databaseName}
                        disabled={disabled || isPreparing || chatLocked}
                        singleLine={isCollapsed}
                        onSubmit={handleSend}
                        onChange={setInput}
                        onFocus={() => setIsFocused(true)}
                        onBlur={() => {
                          // Delay check so activeElement updates after blur
                          requestAnimationFrame(() => {
                            if (!containerRef.current?.contains(document.activeElement)) {
                              setIsFocused(false);
                            }
                          });
                        }}
                        whitelistedSchemas={whitelistedSchemas}
                      />
                    </Box>
                  </Box>

                  {/* Inline attach + send buttons — only when collapsed (pill state) */}
                  {isCollapsed && (
                    <>
                      <IconButton
                        aria-label="Attach file or image"
                        onClick={() => {
                          setIsFocused(true);
                          setTimeout(() => fileInputRef.current?.click(), 300);
                        }}
                        variant="ghost"
                        size="xs"
                        color="fg.muted"
                        _hover={{ color: 'accent.teal' }}
                        borderRadius="md"
                        flexShrink={0}
                      >
                        <Icon as={LuPaperclip} boxSize={3.5} />
                      </IconButton>
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
                        flexShrink={0}
                      >
                        <Icon as={LuSendHorizontal} boxSize={3.5} />
                      </IconButton>
                    </>
                  )}
                </HStack>

                {/* Hidden file input for documents + images */}
                <input
                  type="file"
                  accept={`${SUPPORTED_DOC_EXTENSIONS},image/*`}
                  multiple
                  ref={fileInputRef}
                  style={{ display: 'none' }}
                  onChange={handleFileSelect}
                />

                {/* Attachment chips — collapsed via max-height in floating mode */}
                <Box
                  maxHeight={isCollapsed ? '0px' : '200px'}
                  opacity={isCollapsed ? 0 : 1}
                  overflow="hidden"
                  transition={isFloating ? 'max-height 0.2s ease 0.05s, opacity 0.2s ease 0.05s' : undefined}
                >
                  {(attachments.length > 0 || uploadingNames.length > 0) && (
                    <HStack px={3} py={1} gap={2} flexWrap="wrap" borderTop="1px solid" borderColor="border.muted">
                      {uploadingNames.map((name, idx) => (
                        <HStack
                          key={`uploading-${idx}`}
                          aria-label={`Uploading: ${name}`}
                          bg="accent.teal/20"
                          borderRadius="md"
                          border="1px solid"
                          borderColor="accent.teal"
                          px={2}
                          py={1}
                          gap={1}
                          fontSize="xs"
                          fontFamily="mono"
                          color="white"
                        >
                          <Spinner size="xs" color="accent.teal" />
                          <Text truncate maxW="150px" color="fg.muted">{name}</Text>
                        </HStack>
                      ))}
                      {attachments.map((att, idx) => (
                        <HStack
                          key={idx}
                          aria-label={`Attachment: ${att.name}`}
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
                          {att.type === 'image' && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={att.content}
                              alt={att.name}
                              style={{ width: 20, height: 20, objectFit: 'cover', borderRadius: 2 }}
                            />
                          )}
                          <Tooltip content={att.name} positioning={{ placement: 'top' }}>
                            <Text truncate maxW="150px">{att.name}</Text>
                          </Tooltip>
                          {att.metadata?.pages ? (
                            <Text color="white">({att.metadata.pages} pages)</Text>
                          ) : att.metadata?.wordCount ? (
                            <Text color="white">({att.metadata.wordCount} words)</Text>
                          ) : null}
                          <IconButton
                            aria-label={`Remove attachment ${att.name}`}
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
                </Box>

                {/* Bottom Control Bar — collapsed via max-height in floating mode */}
                <Box
                  maxHeight={isCollapsed ? '0px' : '100px'}
                  opacity={isCollapsed ? 0 : 1}
                  overflow="hidden"
                  transition={isFloating ? 'max-height 0.2s ease 0.05s, opacity 0.2s ease 0.05s' : undefined}
                >
                  <HStack
                  px={3}
                  pb={2}
                  pt={1}
                  justify="space-between"
                  gap={2}
                  >
                  {/* Left controls - Context + Database status indicators */}
                  <HStack gap={1.5} align="center">
                    <ContextSelector
                      selectedContextPath={selectedContextPath || null}
                      selectedVersion={selectedVersion}
                      onSelectContext={onContextChange || (() => {})}
                      compact
                    />
                    <DatabaseSelector
                      value={databaseName}
                      onChange={({ connection_name }) => onDatabaseChange(connection_name)}
                      size="sm"
                      compact
                    />
                  </HStack>

                  <HStack gap={1}>
                    <Tooltip content="Attach file or image (PDF, DOCX, TXT, PNG, JPG…)" positioning={{ placement: 'top' }}>
                      <IconButton
                        aria-label="Attach file or image"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={isAgentRunning}
                        variant="ghost"
                        size="xs"
                        color="fg.muted"
                        _hover={{ color: 'accent.teal' }}
                        _disabled={{ opacity: 0.4, cursor: 'not-allowed' }}
                        borderRadius="md"
                        flexShrink={0}
                      >
                        <Icon as={LuPaperclip} boxSize={3.5} />
                      </IconButton>
                    </Tooltip>

                    {isPreparing ? (
                      <Spinner size="sm" color="accent.teal" flexShrink={0} />
                    ) : (
                      <IconButton
                        aria-label="Send message"
                        onClick={handleSend}
                        disabled={disabled || !input.trim() || connectionsLoading || contextsLoading || chatLocked}
                        bg="accent.teal"
                        color="white"
                        _hover={{ bg: 'accent.teal', opacity: 0.9 }}
                        _disabled={{ opacity: 0.4, cursor: 'not-allowed' }}
                        size="xs"
                        borderRadius="md"
                        flexShrink={0}
                      >
                        <Icon as={LuSendHorizontal} boxSize={3.5} />
                      </IconButton>
                    )}
                  </HStack>
                  </HStack>
                </Box>
            </VStack>
            </Box>
            </Box>
        </GridItem>
    </Grid>
  );
}
