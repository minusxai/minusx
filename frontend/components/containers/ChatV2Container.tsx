'use client';

// Adapter for the FileComponentProps registry — when a `type:'chat'` file is
// loaded via the file detail page, we render the SAME `<ChatInterface>` the
// rest of the app uses, fed from the v=2 data source. This file is the only
// chat-v2-specific rendering surface that remains; everything else is shared
// with legacy chat.

import { Box } from '@chakra-ui/react';
import ChatInterface from '@/components/explore/ChatInterface';
import { useV2ChatData } from '@/lib/chat-data-source';
import type { FileComponentProps } from '@/lib/ui/fileComponents';

export default function ChatV2Container({ fileId }: FileComponentProps) {
  const numericId = typeof fileId === 'number' ? fileId : 0;
  const dataSource = useV2ChatData(numericId);
  return (
    <Box bg="bg.canvas" h={{ base: 'calc(100vh - 80px)', md: '100vh' }} overflow="hidden">
      <ChatInterface
        dataSource={dataSource}
        contextPath=""
        appState={undefined}
        container="page"
      />
    </Box>
  );
}
