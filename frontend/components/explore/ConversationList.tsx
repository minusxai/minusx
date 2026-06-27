'use client';

import React, { useCallback } from 'react';
import { Box, VStack, HStack, Text, Spinner } from '@chakra-ui/react';
import { ConversationSummary } from '@/app/api/conversations/route';
import { useConversationsList } from '@/lib/hooks/useConversationsList';
import { useStableCallback, shallowEqualExcept } from '@/lib/hooks/use-stable-callback';

const NEAR_BOTTOM_PX = 200;

interface ConversationListProps {
  onSelectConversation: (id?: number) => void;
  currentConversationId?: number;
}

export function ConversationList({
  onSelectConversation,
  currentConversationId
}: ConversationListProps) {
  // Keyset-paginated: first page on mount, more as you scroll the list (metadata-only, light).
  const { conversations, loading: isLoading, error, hasMore, loadMore } = useConversationsList({ pageSize: 15 });

  // Load the next page as the user nears the bottom of this scroll box.
  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX) loadMore();
  }, [loadMore]);

  const showInitialLoading = isLoading && conversations.length === 0;

  return (
    <VStack
      align="stretch"
      gap={0}
      h="100%"
      overflow="hidden"
    >

      {/* Initial loading state */}
      {showInitialLoading && (
        <Box textAlign="center" py={4}>
          <Spinner size="sm" />
          <Text fontSize="sm" color="accent.muted" mt={2}>
            Loading conversations...
          </Text>
        </Box>
      )}

      {/* Error State */}
      {error && !isLoading && (
        <Box p={3} borderRadius="md">
          <Text fontSize="sm" color="accent.danger">
            {error || 'Failed to load conversations'}
          </Text>
        </Box>
      )}

      {/* Empty state */}
      {!isLoading && !error && conversations.length === 0 && (
        <Box p={3} textAlign="center">
          <Text fontSize="sm" color="accent.muted">
            No conversations yet
          </Text>
        </Box>
      )}

      {/* Scrollable Conversation Items (paginated) */}
      {conversations.length > 0 && (
        <VStack
          align="stretch"
          overflow="auto"
          flex="1"
          maxH="400px"
          m={0}
          gap={0}
          onScroll={handleScroll}
        >
          {conversations.map((conv) => (
            <ConversationItem
              key={conv.id}
              conversation={conv}
              isActive={conv.id === currentConversationId}
              onSelect={onSelectConversation}
            />
          ))}
          {/* Footer: loading-more spinner while paginating */}
          {hasMore && isLoading && (
            <Box textAlign="center" py={3} aria-label="Loading more conversations">
              <Spinner size="xs" />
            </Box>
          )}
        </VStack>
      )}
    </VStack>
  );
}

interface ConversationItemProps {
  conversation: ConversationSummary;
  isActive: boolean;
  onSelect: (id: number) => void;
}

// Custom comparator: `onSelect` is consumed through a stable wrapper inside,
// so its identity (the parent typically passes a fresh closure each render)
// is intentionally ignored. Other props are shallow-compared. Pre-fix the
// trace showed ConversationItem as 40/40 wasted renders.
const ConversationItem = React.memo(function ConversationItem({ conversation, isActive, onSelect }: ConversationItemProps) {
  const stableOnSelect = useStableCallback(onSelect);
  const handleClick = useCallback(() => stableOnSelect(conversation.id), [stableOnSelect, conversation.id]);

  // Format timestamp to relative time
  const getRelativeTime = (timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    return date.toLocaleDateString();
  };

  return (
    <Box
      px={3}
      py={2}
      cursor="pointer"
      aria-label={`Open conversation: ${conversation.name}`}
      bg={isActive ? 'bg.muted' : 'transparent'}
      borderBottomWidth="1px"
      borderBottomColor="border.muted"
      _hover={{ bg: "bg.muted"}}
      onClick={handleClick}
      transition="all 0.15s"
    >
      <VStack align="stretch" gap={0.5}>
        {/* Conversation Name */}
        <Text
          fontSize="sm"
          truncate
        >
          {conversation.name}
        </Text>

        {/* Metadata Row */}
        <HStack gap={1.5}>
          <Text fontFamily="mono" fontSize="2xs" color="fg.muted">
            {getRelativeTime(conversation.updatedAt)}
          </Text>
        </HStack>
      </VStack>
    </Box>
  );
}, (prev, next) => shallowEqualExcept(prev, next, ['onSelect']));
