'use client';

import { useParams } from 'next/navigation';
import { Box } from '@chakra-ui/react';
import ExploreInterface from '@/components/explore/ExploreInterface';
import ChatV2Container from '@/components/containers/ChatV2Container';
import ChatV2ListView from '@/components/containers/ChatV2ListView';
import { useAppSelector } from '@/store/hooks';
import { DEFAULT_MODE } from '@/lib/mode/mode-types';
import { useFile } from '@/lib/hooks/file-state-hooks';
import { useUseChatV2 } from '@/lib/chat-v2/use-chat-v2';

export default function ExplorePage() {
  // useParams() reads route params synchronously without causing Suspense/remount
  // (use(params) was causing ExploreInterface to remount on navigation, resetting state)
  const params = useParams<{ id?: string[] }>();
  const id = params?.id;

  // Get user mode from Redux
  const user = useAppSelector(state => state.auth.user);
  const mode = user?.mode || DEFAULT_MODE;

  // Parse conversationId as number (file ID)
  const conversationId = id?.[0] ? parseInt(id[0], 10) : undefined;

  // Probe the file's type. If it's a chat (Phase-3 surface), route to
  // ChatV2Container; otherwise fall through to the existing ExploreInterface.
  const { fileState: probeFile } = useFile(conversationId ?? 0) ?? {};
  const isChatFile = !!probeFile && !probeFile.loading && probeFile.type === 'chat';

  // /explore is the unified entry point for both legacy and chat-v2:
  //   - No id, ?v=2 on  → chat-v2 list view (replaces the deleted /chats page)
  //   - No id, no ?v=2  → legacy ExploreInterface (start a new conversation)
  //   - With id, file is type:'chat' → ChatV2Container (regardless of ?v=2)
  //   - With id, file is type:'conversation' → legacy ExploreInterface
  const useChatV2 = useUseChatV2();

  // Explore page uses empty string for filePath (isolates conversations from sidebar)
  const filePath = "";

  if (isChatFile && conversationId) {
    return (
      <Box
        bg="bg.canvas"
        h={{ base: 'calc(100vh - 80px)', md: '100vh' }}
        overflow="hidden"
        aria-label="explore-chat-v2-container"
      >
        <ChatV2Container fileId={conversationId} />
      </Box>
    );
  }

  if (useChatV2 && conversationId == null) {
    return (
      <Box bg="bg.canvas" h={{ base: 'calc(100vh - 80px)', md: '100vh' }} overflowY="auto" aria-label="explore-chat-v2-list">
        <ChatV2ListView />
      </Box>
    );
  }

  return (
    <Box bg="bg.canvas" h={{base: 'calc(100vh - 80px)', md: '100vh'}} overflow="hidden">
      <ExploreInterface
        conversationId={conversationId}
        filePath={filePath}
      />
    </Box>
  );
}
