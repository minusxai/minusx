'use client';

import { useState, useCallback } from 'react';
import { Box, HStack, Text, Icon, Button, Menu, Portal, Input } from '@chakra-ui/react';
import { LuPlus, LuChevronDown, LuRefreshCw, LuPin, LuShare2, LuExpand, LuPencil, LuUnplug } from 'react-icons/lu';
import { Tooltip } from '@/components/ui/tooltip';
import { toaster } from '@/components/ui/toaster';
import { useAppDispatch } from '@/store/hooks';
import { setActiveConversation, setConversationTitle, setRemoteSession, createConversation } from '@/store/chatSlice';
import type { RemoteSessionMintResult } from '@/lib/data/remote-sessions.types';
import { ConversationsAPI } from '@/lib/data/conversations';
import { API_BASE_URL, patchApiUrl } from '@/store/api-url';
import { preserveParams } from '@/lib/navigation/url-utils';

interface ChatHeaderBarProps {
  container: 'page' | 'sidebar';
  conversationID: number | undefined;
  providedConversationId: number | undefined;
  hasConversation: boolean;
  isConversationActive: boolean;
  conversationTitle: string | null;
  hasMessages: boolean;
  isExplorePage: boolean;
  /** Agent turn in flight — mirrors the server's mint guard by disabling Copy-to-Agent. */
  agentBusy?: boolean;
  /** Current page state — captured at mint time so the remote agent knows what the user is looking at. */
  appState?: unknown;
  navigate: (href: string) => void;
  handleNewChat: () => void;
}

// Action Buttons Bar: conversation title (with inline rename), "Set as Active",
// "New Chat", "Copy link", and (in sidebar) "Open in explore". Extracted wholesale
// from ChatInterface — the rename state/handlers and the "Set as Active" dispatch
// are local to this bar and move with it.
export default function ChatHeaderBar({
  container,
  conversationID,
  providedConversationId,
  hasConversation,
  isConversationActive,
  conversationTitle,
  hasMessages,
  isExplorePage,
  agentBusy = false,
  appState,
  navigate,
  handleNewChat,
}: ChatHeaderBarProps) {
  const dispatch = useAppDispatch();

  // Inline rename of the conversation title (the ▾ menu → Rename).
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const startRename = useCallback(() => {
    setRenameValue(conversationTitle ?? '');
    setIsRenaming(true);
  }, [conversationTitle]);
  const submitRename = useCallback(async () => {
    setIsRenaming(false);
    const next = renameValue.trim();
    if (!next || !conversationID || conversationID <= 0 || next === conversationTitle) return;
    dispatch(setConversationTitle({ conversationID, title: next })); // optimistic
    try {
      await ConversationsAPI.rename(conversationID, next);
    } catch (err) {
      console.error('[ChatInterface] rename failed:', err);
      toaster.create({ title: "Couldn't rename the conversation", type: 'error' });
    }
  }, [renameValue, conversationID, conversationTitle, dispatch]);

  // Copy to Agent: mint a Remote Agent Session for this conversation and copy the one-liner an
  // external agent (Claude Code, Codex, ...) fetches to drive this chat. Minting freezes the input
  // (the server flips runStatus -> 'remote'; setRemoteSession raises the local flag + observer).
  // An EMPTY chat has no conversation row yet — create one first (same pattern as the send path's
  // lazy pre-create), so "open side chat -> hand straight to my agent" works without a filler message.
  const handleCopyToAgent = useCallback(async () => {
    try {
      let targetId = conversationID && conversationID > 0 ? conversationID : undefined;
      if (!targetId) {
        const initRes = await fetch(patchApiUrl(`${API_BASE_URL}/api/conversations`), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
        const { id: newId } = await initRes.json();
        if (!newId) throw new Error('Failed to create a conversation for the session');
        targetId = newId as number;
        dispatch(createConversation({ conversationID: targetId, agent: 'AnalystAgent', version: 3 }));
      }
      // patchApiUrl carries mode/as_user — a tutorial-mode session must mint AS tutorial, or the
      // owner/mode check correctly 403s (browser-verified failure).
      const res = await fetch(patchApiUrl(`${API_BASE_URL}/api/conversations/${targetId}/remote-session`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Mint-time app state: the page the user is looking at (dashboard/question/story) rides to
        // the session root so the agent starts oriented (skill doc "Current page", /context).
        body: JSON.stringify({ appState: appState ?? undefined }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        const message = (body as { error?: { message?: string } })?.error?.message
          ?? 'Could not start a remote session';
        toaster.create({ title: message, type: 'error' });
        return;
      }
      const mint = (body as { data: RemoteSessionMintResult }).data;
      await navigator.clipboard.writeText(mint.copyText);
      dispatch(setRemoteSession({ conversationID: targetId, active: true, expiresAt: mint.expiresAt }));
      toaster.create({
        title: 'Copied — paste it into your agent',
        description: 'Anyone with this link can operate this chat until it expires or you stop it.',
        type: 'success',
      });
    } catch (err) {
      console.error('[ChatHeaderBar] copy-to-agent failed:', err);
      toaster.create({ title: 'Could not start a remote session', type: 'error' });
    }
  }, [conversationID, appState, dispatch]);

  // Handler for setting conversation as active
  const handleSetAsActive = () => {
    if (conversationID) {
      dispatch(setActiveConversation(conversationID));
    }
  };

  // "Set as Active" button (only shown for non-active conversations)
  const setAsActiveButton = providedConversationId && !isConversationActive && hasConversation && (
    <Tooltip content="Make this conversation active in sidechat" positioning={{ placement: 'bottom' }}>
      <Button
        onClick={handleSetAsActive}
        size="xs"
        variant="outline"
        borderColor="border.emphasized"
        color="fg.muted"
        _hover={{ bg: 'bg.muted', borderColor: 'accent.teal', color: 'accent.teal' }}
      >
        <Icon as={LuPin} boxSize={4} mr={1} />
        Set as Active
      </Button>
    </Tooltip>
  );

  // New Chat button component (reused in both banner and standalone)
  const newChatButton = hasMessages && (
    <Button
      onClick={handleNewChat}
      size="xs"
      bg="accent.teal"
      color="white"
      _hover={{ bg: 'accent.teal', opacity: 0.9 }}
    >
      {isExplorePage ? (
        <><Icon as={LuPlus} boxSize={4} mr={1} />New Chat</>
      ) : (
        <Tooltip content="Clear Chat" positioning={{ placement: 'left' }}><LuRefreshCw /></Tooltip>
      )}
    </Button>
  );

  return (
    <Box
      position="sticky"
      top={0}
      bg="bg.canvas"
      pt={3}
      pb={2}
      zIndex={10}
      display="flex"
      justifyContent="center"
    >
      <Box width="100%" display="flex" justifyContent="space-between" alignItems="center" px={5}>
        <HStack gap={2}>
        {container === 'sidebar' && (
          <Tooltip content="Open in explore" positioning={{ placement: 'bottom' }}>
            <Button
              onClick={() => {
                const path = conversationID && conversationID > 0
                  ? `/explore/${conversationID}`
                  : '/explore';
                navigate(preserveParams(path));
              }}
              size="xs"
              variant="outline"
              borderColor="border.muted"
              color="fg.subtle"
              _hover={{ color: 'accent.teal', borderColor: 'accent.teal' }}
            >
              <LuExpand />
            </Button>
          </Tooltip>
        )}
        {conversationID && conversationID > 0 && (
          isRenaming ? (
            <Input
              aria-label="Conversation title"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onBlur={submitRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); submitRename(); }
                else if (e.key === 'Escape') { e.preventDefault(); setIsRenaming(false); }
              }}
              autoFocus
              size="xs"
              fontFamily="mono"
              fontWeight="700"
              variant="flushed"
              maxW="360px"
              h="26px"
            />
          ) : (
            <Menu.Root>
              <Menu.Trigger asChild>
                <HStack
                  as="button"
                  aria-label="Conversation title menu"
                  gap={1}
                  px={1.5}
                  h="26px"
                  borderRadius="sm"
                  color="fg.default"
                  _hover={{ bg: 'bg.muted' }}
                  maxW="380px"
                  minW={0}
                >
                  <Tooltip content={conversationTitle || 'Untitled chat'} positioning={{ placement: 'bottom' }}>
                    <Text fontSize="sm" fontFamily="mono" fontWeight="700" truncate maxW="120px">
                      {conversationTitle || 'Untitled chat'}
                    </Text>
                  </Tooltip>
                  <Icon as={LuChevronDown} boxSize={3.5} color="fg.muted" flexShrink={0} />
                </HStack>
              </Menu.Trigger>
              <Portal>
                <Menu.Positioner>
                  <Menu.Content minW="160px" bg="bg.surface" borderColor="border.default" shadow="lg" p={1}>
                    <Menu.Item
                      value="rename"
                      aria-label="Rename conversation"
                      cursor="pointer"
                      borderRadius="sm"
                      px={3}
                      py={2}
                      _hover={{ bg: 'bg.muted' }}
                      onClick={startRename}
                    >
                      <HStack gap={2}>
                        <Icon as={LuPencil} boxSize={4} />
                        <span>Rename</span>
                      </HStack>
                    </Menu.Item>
                  </Menu.Content>
                </Menu.Positioner>
              </Portal>
            </Menu.Root>
          )
        )}
        {/* ViewModeToggle removed — always use compact */}
        </HStack>
        <HStack gap={2}>
          {setAsActiveButton}
          {newChatButton}
          {(
            <Tooltip content="Copy to agent — let Claude Code (or any agent) drive this chat" positioning={{ placement: 'bottom' }}>
              <Button
                aria-label="Copy to agent"
                onClick={handleCopyToAgent}
                disabled={agentBusy}
                size="xs"
                variant="outline"
                borderColor="border.emphasized"
                color="fg.muted"
                _hover={{ bg: 'bg.muted', borderColor: 'accent.teal', color: 'accent.teal' }}
              >
                <LuUnplug />
              </Button>
            </Tooltip>
          )}
          <Tooltip content="Copy link" positioning={{ placement: 'bottom' }}>
            <Button
              onClick={() => {
                const path = conversationID && conversationID > 0
                  ? `/explore/${conversationID}`
                  : window.location.pathname + window.location.search;
                const url = window.location.origin + preserveParams(path);
                navigator.clipboard.writeText(url);
                toaster.create({ title: 'Link copied to clipboard', type: 'success' });
              }}
              size="xs"
              bg="accent.teal"
              color="white"
              _hover={{ bg: 'accent.teal', opacity: 0.9 }}
            >
              <LuShare2 />
            </Button>
          </Tooltip>
        </HStack>
      </Box>
    </Box>
  );
}
