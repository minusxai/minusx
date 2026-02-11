'use client';

import { Box, VStack, HStack, Badge, Text } from '@chakra-ui/react';
import { useAppSelector } from '@/store/hooks';
import { selectFile } from '@/store/filesSlice';
import JsonViewer from '@/components/JsonViewer';
import { ConversationFileContent } from '@/lib/types';
import { FileComponentProps } from '@/lib/ui/fileComponents';

export default function ConversationContainerV2({ fileId }: FileComponentProps) {
  const file = useAppSelector((state) => selectFile(state, fileId));

  if (!file) {
    return (
      <Box p={8}>
        <Text color="accent.danger">Conversation file not found</Text>
      </Box>
    );
  }

  const conversation = file.content as unknown as ConversationFileContent;
  const taskCount = conversation.log?.length || 0;

  return (
    <Box p={8} maxW="1400px" mx="auto">
      <VStack align="start" gap={6} w="100%">
        {/* Header */}
        <Box w="100%">
          <HStack justify="space-between" align="start" mb={2}>
            <Box>
              <Text fontSize="2xl" fontWeight="700" fontFamily="mono">
                {file.name}
              </Text>
              <Text fontSize="sm" color="accent.muted" fontFamily="mono" mt={1}>
                {file.path}
              </Text>
            </Box>
            <Badge colorScheme="teal" fontSize="xs" px={2} py={1}>
              {taskCount} tasks
            </Badge>
          </HStack>
        </Box>

        {/* Metadata */}
        <Box w="100%" p={4} bg="bg.muted" borderRadius="md" border="1px" borderColor="border.default">
          <VStack align="start" gap={3}>
            <HStack>
              <Text fontWeight="600" minW="120px" color="fg.default">File ID:</Text>
              <Text fontFamily="mono" fontSize="sm" color="fg.default">{file.id}</Text>
            </HStack>
            <HStack>
              <Text fontWeight="600" minW="120px" color="fg.default">User ID:</Text>
              <Text fontFamily="mono" fontSize="sm" color="fg.default">{conversation.metadata?.userId || 'N/A'}</Text>
            </HStack>
            <HStack>
              <Text fontWeight="600" minW="120px" color="fg.default">Created:</Text>
              <Text fontSize="sm" color="fg.default">
                {conversation.metadata?.createdAt
                  ? new Date(conversation.metadata.createdAt).toLocaleString()
                  : 'N/A'}
              </Text>
            </HStack>
            <HStack>
              <Text fontWeight="600" minW="120px" color="fg.default">Updated:</Text>
              <Text fontSize="sm" color="fg.default">
                {conversation.metadata?.updatedAt
                  ? new Date(conversation.metadata.updatedAt).toLocaleString()
                  : 'N/A'}
              </Text>
            </HStack>
            <HStack>
              <Text fontWeight="600" minW="120px" color="fg.default">Tasks:</Text>
              <Text fontSize="sm" color="fg.default">{taskCount} orchestration tasks</Text>
            </HStack>
          </VStack>
        </Box>

        {/* JSON Viewer */}
        <Box w="100%">
          <JsonViewer data={conversation} title="Full Conversation Data" />
        </Box>
      </VStack>
    </Box>
  );
}
