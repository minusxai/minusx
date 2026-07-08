'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { shallowEqual } from 'react-redux';
import { Box, Center, Dialog, Flex, HStack, Icon, Portal, Spinner, Text } from '@chakra-ui/react';
import { LuChevronRight, LuMessageSquare, LuX } from 'react-icons/lu';
import { Tooltip } from '@/components/ui/tooltip';

import { useAppDispatch, useAppSelector } from '@/store/hooks';
import { setUser } from '@/store/authSlice';
import { setColorMode } from '@/store/uiSlice';
import { selectMergedContent } from '@/store/filesSlice';
import { selectAugmentedFiles } from '@/lib/store/file-selectors';
import { compressAugmentedFile, APP_STATE_LIMIT_CHARS } from '@/lib/chat/compress-augmented';
import { useFile } from '@/lib/hooks/file-state-hooks';
import { useConfigs } from '@/lib/hooks/useConfigs';
import StoryView from '@/components/views/story/StoryView';
import ChatInterface from '@/components/explore/ChatInterface';
import ShareLeadGate from './ShareLeadGate';
import ShareFloatingChat from './ShareFloatingChat';
import { StoryContent } from '@/lib/types';
import type { CompiledCssStoryContent } from '@/lib/data/story/story-css';
import type { AppState } from '@/lib/appState';
import type { Mode } from '@/lib/mode/mode-types';

interface ShareSession {
  fileId: number;
  folderPath: string;
  home_folder: string;
  mode: Mode;
  uid: number;
  canChat: boolean;
  chatEnabled: boolean;
  name?: string;
}

type Status = 'minting' | 'ready' | 'error';

const CHAT_WIDTH = '420px';
const CHAT_RAIL_WIDTH = '52px';

/** Mints/refreshes the guest session. Returns the session payload or throws. */
async function mintSession(shareId: string, body: Record<string, unknown>): Promise<ShareSession> {
  const res = await fetch('/api/share/guest-session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ shareId, ...body }),
  });
  if (!res.ok) throw new Error(`mint failed: ${res.status}`);
  return res.json();
}

export default function SharePageClient({ shareId }: { shareId: string }) {
  const dispatch = useAppDispatch();
  const searchParams = useSearchParams();
  const skipLead = searchParams.has('skip_lead');

  const [status, setStatus] = useState<Status>('minting');
  const [session, setSession] = useState<ShareSession | null>(null);

  // Seed Redux auth with the guest identity so role-aware UI + chat behave consistently.
  // Server authz always relies on the httpOnly mx-guest cookie, not this.
  const applySession = (s: ShareSession) => {
    dispatch(setUser({
      id: s.uid,
      email: '',
      name: s.name || 'Guest',
      role: 'viewer',
      home_folder: s.home_folder,
      mode: s.mode,
    }));
    setSession(s);
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const s = await mintSession(shareId, { skipLead });
        if (!cancelled) { applySession(s); setStatus('ready'); }
      } catch {
        if (!cancelled) setStatus('error');
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shareId, skipLead]);

  const handleLead = async (name: string, email: string) => {
    const s = await mintSession(shareId, { name, email });
    applySession(s);
  };

  // Build the "file is open" app state for the shared story, so the chat knows what
  // "this report" refers to (the route-based selector doesn't recognize /l/ pages).
  const fileId = session?.fileId;
  const augmented = useAppSelector(
    state => (fileId !== undefined ? selectAugmentedFiles(state, [fileId])[0] : undefined),
    shallowEqual,
  );
  const storyAppState = useMemo<AppState | null>(
    () => (augmented ? { type: 'file', state: compressAugmentedFile(augmented, APP_STATE_LIMIT_CHARS) } : null),
    [augmented],
  );

  // Story-specific "try these questions" (set by the agent / JSON tab on the story).
  const storyContent = useAppSelector(state =>
    (fileId !== undefined ? selectMergedContent(state, fileId) : undefined) as StoryContent | undefined,
  );
  const suggestedPrompts = useMemo(
    () => (storyContent?.suggestedQuestions ?? undefined) || undefined,
    [storyContent?.suggestedQuestions],
  );

  // Public viewers can't toggle light/dark, so honor the mode the story was
  // authored for. Charts/tiles/chat all read ui.colorMode from Redux, so a
  // single dispatch themes the whole page; ColorModeSync mirrors it to the
  // <html> class. No-op (viewer default) when the story doesn't set one.
  const storyColorMode = storyContent?.colorMode ?? undefined;
  useEffect(() => {
    if (storyColorMode) dispatch(setColorMode(storyColorMode));
  }, [storyColorMode, dispatch]);

  // Collapse toggle for the chat panel — mirrors the right sidebar sidechat.
  const [chatCollapsed, setChatCollapsed] = useState(false);

  // Mobile: the desktop right panel is hidden (display none < md), so chat lives
  // in a bottom sheet opened by a FAB. Its ChatInterface reads the same active
  // conversation from Redux as the (hidden) desktop panel, so state is shared.
  const [mobileChatOpen, setMobileChatOpen] = useState(false);

  // Agent name for the chat FAB label (e.g. "Ask MinusX").
  const { config } = useConfigs();
  const agentName = config.branding.agentName || 'MinusX';

  if (status === 'minting') {
    return <Center h="100vh" bg="bg.canvas"><Spinner size="xl" color="primary" /></Center>;
  }
  if (status === 'error' || !session) {
    return (
      <Center h="100vh" bg="bg.canvas">
        <Text color="fg.muted">This link is invalid or has been revoked.</Text>
      </Center>
    );
  }

  const showChat = session.chatEnabled;

  return (
    <Flex h="100vh" bg="bg.canvas" overflow="hidden">
      <Box flex="1" overflowY="auto">
        <SharedStory fileId={session.fileId} />
      </Box>
      {showChat && (
        <Box
          w={chatCollapsed ? CHAT_RAIL_WIDTH : { base: '100%', md: CHAT_WIDTH }}
          flexShrink={0}
          borderLeftWidth="1px"
          borderColor="border.default"
          bg="bg.surface"
          display={{ base: 'none', md: 'flex' }}
          flexDirection="column"
          h="100vh"
          transition="width 0.2s ease"
        >
          {chatCollapsed ? (
            <Tooltip content="Open chat" positioning={{ placement: 'left' }}>
              <Box
                as="button"
                aria-label="Open chat"
                onClick={() => setChatCollapsed(false)}
                p={3}
                bg="bg.muted"
                borderBottom="1px solid"
                borderColor="border.default"
                cursor="pointer"
                _hover={{ bg: 'bg.elevated' }}
                transition="background 0.2s"
              >
                <Icon as={LuMessageSquare} boxSize={5} color="accent.primary" />
              </Box>
            </Tooltip>
          ) : (
            <HStack
              flexShrink={0}
              px={2}
              py={2}
              bg="bg.muted"
              borderBottom="1px solid"
              borderColor="border.default"
            >
              <Tooltip content="Collapse chat" positioning={{ placement: 'bottom' }}>
                <Box
                  as="button"
                  aria-label="Collapse chat"
                  onClick={() => setChatCollapsed(true)}
                  color="fg.muted"
                  cursor="pointer"
                  _hover={{ color: 'fg.default' }}
                  transition="color 0.2s"
                  display="flex"
                  alignItems="center"
                >
                  <Icon as={LuChevronRight} boxSize={4} />
                </Box>
              </Tooltip>
            </HStack>
          )}
          {/* Body stays MOUNTED across collapse (only hidden) so the conversation
              and the floating-bar pending-message handoff survive. Unmounting it
              made the floating-bar message get consumed at remount, double-sending
              under StrictMode. */}
          <Box flex="1" overflow="hidden" minH={0} display={chatCollapsed ? 'none' : 'block'}>
            {session.canChat ? (
              <ChatInterface
                contextPath={session.folderPath}
                container="sidebar"
                appState={storyAppState}
                suggestedPrompts={suggestedPrompts}
              />
            ) : (
              <ShareLeadGate onSubmit={handleLead} suggestedPrompts={suggestedPrompts} />
            )}
          </Box>
        </Box>
      )}

      {/* Floating "ask anything" bar — only once the guest can chat, and only
          while the panel is collapsed (open panel already shows its own input). */}
      {showChat && session.canChat && chatCollapsed && (
        <ShareFloatingChat
          contextPath={session.folderPath}
          appState={storyAppState}
          railWidth={CHAT_RAIL_WIDTH}
          onOpenChat={() => setChatCollapsed(false)}
        />
      )}

      {/* Mobile chat: the desktop right panel is hidden below md, so chat opens
          as a bottom sheet (pattern lifted from MobileRightSidebar) hosting the
          same ChatInterface / ShareLeadGate leaf components as the desktop panel.
          No sidebarPendingMessage handoff here — the guest types directly into
          the sheet — so there's no double-consume with the hidden desktop input. */}
      {showChat && (
        <Box display={{ base: 'block', md: 'none' }}>
          {!mobileChatOpen && (
            <Box
              as="button"
              aria-label="Open chat"
              onClick={() => setMobileChatOpen(true)}
              position="fixed"
              bottom={4}
              right={4}
              zIndex={99}
              display="flex"
              alignItems="center"
              gap={2}
              px={4}
              py={3}
              borderRadius="full"
              bg="accent.teal"
              color="white"
              boxShadow="0 4px 12px rgba(0, 0, 0, 0.2)"
              cursor="pointer"
              _active={{ opacity: 0.9 }}
            >
              <Icon as={LuMessageSquare} boxSize={5} />
              <Text fontSize="sm" fontWeight="600" fontFamily="mono">Ask {agentName}</Text>
            </Box>
          )}

          <Dialog.Root
            open={mobileChatOpen}
            onOpenChange={(e) => setMobileChatOpen(e.open)}
            placement="bottom"
          >
            <Portal>
              <Dialog.Backdrop />
              <Dialog.Positioner padding={0}>
                <Dialog.Content
                  maxH="85vh"
                  w="100%"
                  maxW="100%"
                  m={0}
                  borderTopRadius="xl"
                  borderBottomRadius="0"
                  overflow="hidden"
                >
                  <HStack
                    flexShrink={0}
                    px={4}
                    py={3}
                    borderBottom="1px solid"
                    borderColor="border.default"
                    bg="bg.muted"
                    justify="space-between"
                  >
                    <HStack gap={2}>
                      <Icon as={LuMessageSquare} boxSize={5} color="accent.teal" />
                      <Text fontSize="sm" fontWeight="700" fontFamily="mono" color="fg.default">Chat</Text>
                    </HStack>
                    <Icon
                      as={LuX}
                      boxSize={5}
                      color="fg.muted"
                      cursor="pointer"
                      aria-label="Close chat"
                      onClick={() => setMobileChatOpen(false)}
                      _hover={{ color: 'fg.default' }}
                    />
                  </HStack>
                  <Box height="calc(85vh - 56px)" overflow="hidden" bg="bg.canvas">
                    {mobileChatOpen && (
                      session.canChat ? (
                        <ChatInterface
                          contextPath={session.folderPath}
                          container="sidebar"
                          appState={storyAppState}
                          suggestedPrompts={suggestedPrompts}
                        />
                      ) : (
                        <ShareLeadGate onSubmit={handleLead} suggestedPrompts={suggestedPrompts} />
                      )
                    )}
                  </Box>
                </Dialog.Content>
              </Dialog.Positioner>
            </Portal>
          </Dialog.Root>
        </Box>
      )}
    </Flex>
  );
}

/** Read-only story renderer (mirrors StoryContainerV2 but pins readOnly). */
function SharedStory({ fileId }: { fileId: number }) {
  const { fileState: file } = useFile(fileId) ?? {};
  const mergedContent = useAppSelector(state => selectMergedContent(state, fileId)) as StoryContent | undefined;
  const colorMode = useAppSelector(state => state.ui.colorMode);

  const ready = useMemo(() => Boolean(file && !file.loading && mergedContent), [file, mergedContent]);
  if (!ready || !mergedContent) {
    return <Center h="60vh"><Spinner size="lg" /></Center>;
  }
  // fileId is intentionally NOT forwarded to StoryView here (read-only share render, no editing) —
  // headerEditMode/storyPath/storyName mirror what StoryView would compute with no fileId.
  // Published render: the persisted compiledCss is always fresh (recomputed on every save).
  // The story's declared colorMode pins the surface (the page-level dispatch also syncs the app
  // chrome, but this keeps the iframe correct even before that effect lands).
  const effectiveColorMode = (mergedContent.colorMode as 'light' | 'dark' | null | undefined) ?? colorMode;
  return <StoryView content={mergedContent} readOnly headerEditMode={false} storyPath={undefined} storyName={undefined} colorMode={effectiveColorMode} compiledCss={(mergedContent as CompiledCssStoryContent).compiledCss} />;
}
