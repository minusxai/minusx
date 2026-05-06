'use client';

// Phase-3 Chats list page. Mirrors /conversations but for `type: 'chat'`
// (TS-orchestrator-driven). Reachable when `useChatV2` is on (Sidebar swaps
// the link). The page itself is also reachable directly without the toggle —
// it just shows the user's chat files.

import { Box, Flex, Heading, VStack, Text, Spinner, HStack, Button, Icon } from '@chakra-ui/react';
import { useRouter } from 'next/navigation';
import React from 'react';
import { LuMessageSquare, LuPlus } from 'react-icons/lu';
import { useFilesByCriteria } from '@/lib/hooks/file-state-hooks';
import { FILE_TYPE_METADATA } from '@/lib/ui/file-metadata';
import Breadcrumb from '@/components/Breadcrumb';

export default function ChatsPage() {
  const router = useRouter();
  const { files, loading } = useFilesByCriteria({
    criteria: { type: 'chat', depth: -1 },
    partial: true,
  });

  const sortedFiles = [...files].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));

  return (
    <Box p={6}>
      <Breadcrumb items={[{ label: 'Chats' }]} />
      <Flex align="center" justify="space-between" mt={4} mb={6}>
        <Heading size="lg" aria-label="chats-page-title">Chats</Heading>
        <Button
          aria-label="new-chat"
          colorPalette="teal"
          onClick={() => router.push('/explore?v=2')}
        >
          <Icon as={LuPlus} mr={1} />New Chat
        </Button>
      </Flex>

      {loading && (
        <Box display="flex" alignItems="center" justifyContent="center" minH="200px">
          <Spinner />
        </Box>
      )}

      {!loading && sortedFiles.length === 0 && (
        <VStack aria-label="chats-empty-state" gap={3} py={12}>
          <Icon as={LuMessageSquare} boxSize={8} color="fg.muted" />
          <Text fontSize="md" color="fg.muted">No chats yet — start a new chat above.</Text>
        </VStack>
      )}

      {!loading && sortedFiles.length > 0 && (
        <VStack align="stretch" gap={2} aria-label="chats-list">
          {sortedFiles.map((file) => (
            <Box
              key={file.id}
              aria-label={`chat-row-${file.id}`}
              borderWidth="1px"
              borderRadius="md"
              p={3}
              cursor="pointer"
              _hover={{ bg: 'bg.muted' }}
              onClick={() => router.push(`/f/${file.id}`)}
            >
              <HStack>
                <Icon as={FILE_TYPE_METADATA.chat.icon} color={FILE_TYPE_METADATA.chat.color} />
                <VStack align="stretch" gap={0} flex="1">
                  <Text fontSize="sm" fontWeight="medium">{file.name}</Text>
                  <Text fontSize="xs" color="fg.muted">
                    {file.updatedAt ? new Date(file.updatedAt).toLocaleString() : ''}
                  </Text>
                </VStack>
              </HStack>
            </Box>
          ))}
        </VStack>
      )}
    </Box>
  );
}
