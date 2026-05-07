'use client';

import React, { useCallback, useMemo } from 'react';
import { Box, VStack, Text, Spinner, HStack, Icon } from '@chakra-ui/react';
import { LuSlack } from 'react-icons/lu';
import { ConversationSummary } from '@/app/api/conversations/route';
import { FILE_TYPE_METADATA } from '@/lib/ui/file-metadata';
import { useFetch } from '@/lib/api/useFetch';
import { API } from '@/lib/api/declarations';
import { useUseChatV2 } from '@/lib/chat-v2/use-chat-v2';
import { useFilesByCriteria } from '@/lib/hooks/file-state-hooks';

interface ConversationListProps {
  onSelectConversation: (id?: number) => void;
  currentConversationId?: number;
}

export function ConversationList({
  onSelectConversation,
  currentConversationId
}: ConversationListProps) {
  const useV2 = useUseChatV2();

  // Legacy 'conversation' files via the existing API.
  const legacyResult = useFetch(API.conversations.list);
  const legacyConvs: ConversationSummary[] = (legacyResult.data as { conversations?: ConversationSummary[] } | undefined)?.conversations || [];

  // v=2 'chat' files — read directly from the file index. `meta.logLength`
  // is exposed on partial reads (set by `appendChatLog` atomically) so we
  // can render counts without round-tripping content.
  const v2Criteria = useMemo(() => ({ type: 'chat' as const, depth: -1 }), []);
  const v2Result = useFilesByCriteria({ criteria: v2Criteria, partial: true, skip: !useV2 });
  const v2Convs: ConversationSummary[] = useMemo(() => {
    if (!useV2) return [];
    return (v2Result.files ?? [])
      .slice()
      .sort((a, b) => (b.updated_at ?? '').localeCompare(a.updated_at ?? ''))
      .map((f): ConversationSummary => {
        const meta = (f.meta ?? {}) as { logLength?: number; forkedFrom?: number };
        const ts = f.updated_at ?? f.created_at ?? new Date(0).toISOString();
        return {
          id: f.id,
          name: f.name || 'Untitled chat',
          createdAt: ts,
          updatedAt: ts,
          messageCount: meta.logLength ?? 0,
          ...(meta.forkedFrom !== undefined ? { forkedFrom: meta.forkedFrom } : {}),
          parentPageType: 'explore',
        };
      });
  }, [useV2, v2Result.files]);

  const conversations = useV2 ? v2Convs : legacyConvs;
  const isLoading = useV2 ? v2Result.loading : legacyResult.loading;
  const error = useV2 ? (v2Result.error ? new Error(String(v2Result.error)) : null) : legacyResult.error;

  return (
    <VStack
      align="stretch"
      gap={0}
      h="100%"
      overflow="hidden"
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
        overflow="auto"
        flex="1"
        maxH="400px"
        m={0}
        gap={0}
      >
        {conversations.map((conv) => (
          <ConversationItem
            key={conv.id}
            conversation={conv}
            isActive={conv.id === currentConversationId}
            onSelect={onSelectConversation}
          />
        ))}
      </VStack>
    </VStack>
  );
}

function getTypeColor(type: string): string {
  if (type === 'slack') return 'accent.secondary';
  const meta = FILE_TYPE_METADATA[type as keyof typeof FILE_TYPE_METADATA];
  return meta?.color || 'fg.muted';
}

function getTypeLabel(type: string): string {
  if (type === 'slack') return 'Slack';
  const meta = FILE_TYPE_METADATA[type as keyof typeof FILE_TYPE_METADATA];
  return meta?.label || type;
}

function getTypeIcon(type: string): React.ComponentType | null {
  if (type === 'slack') return LuSlack;
  const meta = FILE_TYPE_METADATA[type as keyof typeof FILE_TYPE_METADATA];
  return meta?.icon || null;
}

interface ConversationItemProps {
  conversation: ConversationSummary;
  isActive: boolean;
  onSelect: (id: number) => void;
}

const ConversationItem = React.memo(function ConversationItem({ conversation, isActive, onSelect }: ConversationItemProps) {
  const handleClick = useCallback(() => onSelect(conversation.id), [onSelect, conversation.id]);

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

  // Unified source label: Slack source takes priority, then page type
  const sourceType = conversation.source?.type === 'slack' ? 'slack' : conversation.parentPageType;
  const sourceColor = sourceType ? getTypeColor(sourceType) : undefined;
  const sourceLabel = sourceType ? getTypeLabel(sourceType) : undefined;

  return (
    <Box
      px={3}
      py={2}
      cursor="pointer"
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
        <HStack justify="space-between" fontSize="2xs" align="center" gap={2}>
          {sourceLabel && sourceType && (
            <HStack gap={1}>
              {getTypeIcon(sourceType) && (
                <Icon as={getTypeIcon(sourceType)!} boxSize="10px" color={sourceColor} />
              )}
              <Text
                fontFamily="mono"
                fontSize="2xs"
                fontWeight="600"
                color={sourceColor}
              >
                {sourceLabel}
              </Text>
            </HStack>
          )}
          <Text fontFamily="mono" color="fg.muted">{getRelativeTime(conversation.updatedAt)}</Text>
        </HStack>
      </VStack>
    </Box>
  );
});
