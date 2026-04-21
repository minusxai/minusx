'use client';

import { Box, Container, Heading, VStack, Text, Spinner, HStack, Icon, Input, Button, Badge } from '@chakra-ui/react';
import { useRouter } from 'next/navigation';
import React, { useCallback, useMemo, useState } from 'react';
import { LuSlack, LuSearch, LuPlus, LuMessageSquare } from 'react-icons/lu';
import { ConversationSummary } from '@/app/api/conversations/route';
import { FILE_TYPE_METADATA } from '@/lib/ui/file-metadata';
import { useFetch } from '@/lib/api/useFetch';
import { API } from '@/lib/api/declarations';
import Breadcrumb from '@/components/Breadcrumb';

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

function getRelativeTime(timestamp: string) {
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
}

function ConversationRow({ conversation, onClick }: { conversation: ConversationSummary; onClick: () => void }) {
  const sourceType = conversation.source?.type === 'slack' ? 'slack' : conversation.parentPageType;
  const sourceColor = sourceType ? getTypeColor(sourceType) : undefined;
  const sourceLabel = sourceType ? getTypeLabel(sourceType) : undefined;

  return (
    <Box
      px={6}
      py={3}
      cursor="pointer"
      _hover={{ bg: 'bg.muted' }}
      onClick={onClick}
      transition="all 0.15s"
      borderBottomWidth="1px"
      borderColor="border.muted"
    >
      <HStack justify="space-between" align="center">
        <HStack flex="1" gap={2} truncate>
          <Text fontSize="sm" fontFamily="mono" truncate>
            {conversation.name}
          </Text>
          <Badge variant="subtle" size="sm" fontFamily="mono" flexShrink={0}>
            <LuMessageSquare size={11} />
            {conversation.messageCount}
          </Badge>
        </HStack>
        <HStack gap={3} flexShrink={0}>
          {sourceLabel && sourceType && (
            <HStack gap={1}>
              {getTypeIcon(sourceType) && (
                <Icon as={getTypeIcon(sourceType)!} boxSize="12px" color={sourceColor} />
              )}
              <Text fontSize="xs" fontFamily="mono" fontWeight="600" color={sourceColor}>
                {sourceLabel}
              </Text>
            </HStack>
          )}
          <Text fontSize="xs" fontFamily="mono" color="fg.muted" minW="70px" textAlign="right">
            {getRelativeTime(conversation.updatedAt)}
          </Text>
        </HStack>
      </HStack>
    </Box>
  );
}

export default function HistoryPage() {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const { data, loading, error } = useFetch(API.conversations.list);
  const allConversations: ConversationSummary[] = (data as any)?.conversations || [];

  const conversations = useMemo(() => {
    if (!search.trim()) return allConversations;
    const q = search.toLowerCase();
    return allConversations.filter(c => c.name.toLowerCase().includes(q));
  }, [allConversations, search]);

  const handleSelect = useCallback((id: number) => {
    router.push(`/explore/${id}`);
  }, [router]);

  const breadcrumbItems = [
    { label: 'Home', href: '/' },
    { label: 'Conversations', href: undefined },
  ];

  return (
    <Box minH="100vh" bg="bg.canvas">
      <Container maxW="container.md" py={{ base: 4, md: 8 }} px={{ base: 4, md: 8 }}>
        <Breadcrumb items={breadcrumbItems} />

        <HStack justify="space-between" align="center" mt={10} mb={8}>
          <Heading
            fontSize={{ base: '3xl', md: '4xl', lg: '5xl' }}
            fontWeight="900"
            letterSpacing="-0.03em"
            color="fg.default"
          >
            Conversations
          </Heading>
          <Button
            aria-label="New chat"
            size="sm"
            bg="accent.teal"
            color="white"
            fontFamily="mono"
            onClick={() => router.push('/explore')}
          >
            <LuPlus />
            New Chat
          </Button>
        </HStack>

        <Box position="relative" mb={6}>
          <Box position="absolute" left={4} top="50%" transform="translateY(-50%)" color="fg.muted" zIndex={1}>
            <LuSearch size={16} />
          </Box>
          <Input
            aria-label="Search conversations"
            placeholder="Search conversations..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            size="md"
            fontFamily="mono"
            fontSize="sm"
            pl={10}
            bg="bg.surface"
            borderColor="border"
            borderRadius="lg"
            _focus={{ borderColor: 'accent.teal', boxShadow: '0 0 0 1px var(--chakra-colors-accent-teal)' }}
          />
        </Box>

        {loading && (
          <Box textAlign="center" py={8}>
            <Spinner size="md" />
            <Text fontSize="sm" color="fg.muted" mt={3}>Loading conversations...</Text>
          </Box>
        )}

        {error && !loading && (
          <Box p={4} bg="bg.error" borderRadius="md">
            <Text fontSize="sm" color="fg.error">
              {error.message || 'Failed to load conversations'}
            </Text>
          </Box>
        )}

        {!loading && !error && conversations.length === 0 && (
          <Box py={8} textAlign="center">
            <Text fontSize="sm" color="fg.muted">No conversations yet</Text>
          </Box>
        )}

        {!loading && !error && conversations.length > 0 && (
          <Box bg="bg.surface" borderRadius="xl" shadow="sm" borderWidth="1px" borderColor="border" overflow="hidden">
            <VStack align="stretch" gap={0}>
              {conversations.map((conv) => (
                <ConversationRow
                  key={conv.id}
                  conversation={conv}
                  onClick={() => handleSelect(conv.id)}
                />
              ))}
            </VStack>
          </Box>
        )}
      </Container>
    </Box>
  );
}
