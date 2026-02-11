'use client';

import { Box, Button, VStack, Text, Spinner, HStack } from '@chakra-ui/react';
import { ConversationSummary } from '@/app/api/conversations/route';
import FileTypeBadge from '../FileTypeBadge';
import { useFetch } from '@/lib/api/useFetch';
import { API } from '@/lib/api/declarations';

interface ConversationListProps {
  onSelectConversation: (id?: number) => void;
  currentConversationId?: number;
}

export function ConversationList({
  onSelectConversation,
  currentConversationId
}: ConversationListProps) {
  // Use centralized fetch with automatic caching and deduplication
  const { data, loading: isLoading, error } = useFetch(API.conversations.list);

  const conversations: ConversationSummary[] = (data as any)?.conversations || [];

  return (
    <VStack
      align="stretch"
      gap={2}
      h="100%"
      overflow="hidden"
      p={3}
    >

      {/* Loading State */}
      {isLoading && (
        <Box textAlign="center" py={4}>
          <Spinner size="sm" />
          <Text fontSize="sm" color="accent.muted" mt={2}>
            Loading conversations...
          </Text>
        </Box>
      )}

      {/* Error State */}
      {error && !isLoading && (
        <Box p={3} bg="accent.danger" borderRadius="md">
          <Text fontSize="sm" color="accent.danger">
            {error.message || 'Failed to load conversations'}
          </Text>
        </Box>
      )}

      {/* Conversations List */}
      {!isLoading && !error && conversations.length === 0 && (
        <Box p={3} textAlign="center">
          <Text fontSize="sm" color="accent.muted">
            No conversations yet
          </Text>
        </Box>
      )}

      {/* Scrollable Conversation Items */}
      <VStack
        align="stretch"
        // gap={1}
        overflow="auto"
        flex="1"
        maxH="400px"
        m={0}
      >
        {conversations.map((conv) => (
          <ConversationItem
            key={conv.id}
            conversation={conv}
            isActive={conv.id === currentConversationId}
            onClick={() => onSelectConversation(conv.id)}
          />
        ))}
      </VStack>
    </VStack>
  );
}

interface ConversationItemProps {
  conversation: ConversationSummary;
  isActive: boolean;
  onClick: () => void;
}

function ConversationItem({ conversation, isActive, onClick }: ConversationItemProps) {
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
      px={2}
      py={1}
      borderRadius="md"
      cursor="pointer"
      bg={isActive ? 'bg.muted' : 'transparent'}
      borderWidth={isActive ? 1 : 0}
      borderColor="border.muted"
      _hover={{ bg: "bg.muted"}}
      onClick={onClick}
      transition="all 0.15s"
    >
      <VStack align="stretch" gap={0.5}>
        {/* Conversation Name */}
        <Text
          fontSize="sm"
        //   fontWeight={isActive ? 'semibold' : 'normal'}
          truncate
        >
          {conversation.name}
        </Text>

        {/* Metadata Row */}
        <HStack justify="space-between" fontSize="xs" color="accent.muted" align="center">
          {conversation.parentPageType && (
            <FileTypeBadge fileType={conversation.parentPageType} size="xs" opacity={0.9}/>
          )}
          <Text>{conversation.messageCount} user message{conversation.messageCount > 1 ? 's' : ''}</Text>
          <Text>{getRelativeTime(conversation.updatedAt)}</Text>
        </HStack>
      </VStack>
    </Box>
  );
}
