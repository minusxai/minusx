'use client';

import { Box, Flex, Heading, VStack, Text, Spinner, HStack, Input, Button } from '@chakra-ui/react';
// Param-preserving router so chat navigation keeps ?v=2 (and as_user/mode).
import { useRouter } from '@/lib/navigation/use-navigation';
import { useCallback, useMemo, useState } from 'react';
import { LuSearch, LuPlus } from 'react-icons/lu';
import { ConversationSummary } from '@/app/api/conversations/route';
import { useFetch } from '@/lib/api/useFetch';
import { API } from '@/lib/api/declarations';
import Breadcrumb from '@/components/Breadcrumb';

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
  return (
    <Box
      px={6}
      py={3}
      cursor="pointer"
      aria-label={`Open conversation: ${conversation.name}`}
      _hover={{ bg: 'bg.muted' }}
      onClick={onClick}
      transition="all 0.15s"
      borderBottomWidth="1px"
      borderColor="border.muted"
    >
      <HStack justify="space-between" align="center" gap={3}>
        <Text fontSize="sm" fontFamily="mono" truncate flex="1">
          {conversation.name}
        </Text>
        <Text fontSize="xs" fontFamily="mono" color="fg.muted" minW="70px" textAlign="right" flexShrink={0}>
          {getRelativeTime(conversation.updatedAt)}
        </Text>
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
    <Box minH="90vh" bg="bg.canvas" display="flex">
      <VStack flex="1" minW="0" position="relative" align="stretch">
        <Box w="100%" flex="1" mx="auto" px={{ base: 4, md: 8, lg: 12 }} pt={{ base: 3, md: 4, lg: 5 }} pb={{ base: 6, md: 8, lg: 10 }}>
          <Flex justify="space-between" align="center" mb={4} gap={4}>
            <Box flex="1" minW={0}>
              <Breadcrumb items={breadcrumbItems} />
            </Box>
          </Flex>

        <HStack justify="space-between" align="flex-start" mt={10} mb={2}>
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
        </Box>
      </VStack>
    </Box>
  );
}
