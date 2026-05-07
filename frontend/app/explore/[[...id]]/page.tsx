'use client';

import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Box } from '@chakra-ui/react';
import ExploreInterface from '@/components/explore/ExploreInterface';
import ChatV2Container from '@/components/containers/ChatV2Container';
import { useAppSelector } from '@/store/hooks';
import { DEFAULT_MODE } from '@/lib/mode/mode-types';
import { useFile } from '@/lib/hooks/file-state-hooks';
import { useUseChatV2 } from '@/lib/chat-v2/use-chat-v2';
import { preserveParams } from '@/lib/navigation/url-utils';

export default function ExplorePage() {
  // useParams() reads route params synchronously without causing Suspense/remount
  // (use(params) was causing ExploreInterface to remount on navigation, resetting state)
  const params = useParams<{ id?: string[] }>();
  const id = params?.id;
  const router = useRouter();

  // Get user mode from Redux
  const user = useAppSelector(state => state.auth.user);
  const mode = user?.mode || DEFAULT_MODE;

  // Parse conversationId as number (file ID)
  const conversationId = id?.[0] ? parseInt(id[0], 10) : undefined;

  // Probe the file's type. If it's a chat (Phase-3 surface), route to
  // ChatV2Container; otherwise fall through to the existing ExploreInterface.
  // Plan: /explore/<id> also handles type:'chat'; future PR collapses
  // /explore/<id> → /f/<id>.
  const { fileState: probeFile } = useFile(conversationId ?? 0) ?? {};
  const isChatFile = !!probeFile && !probeFile.loading && probeFile.type === 'chat';

  // ?v=2 is on → /explore is a chat-v2 entry point. With no `conversationId`,
  // there's nothing for ExploreInterface to mount on, and we don't want the
  // user dropped into the legacy chat surface (which would POST to
  // /api/chat/stream). Redirect to /chats?v=2 — the new-chat list view is
  // the right home for chat-v2.
  const useChatV2 = useUseChatV2();
  useEffect(() => {
    if (useChatV2 && conversationId == null) {
      router.replace(preserveParams('/chats'));
    }
  }, [useChatV2, conversationId, router]);

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

  // While the redirect effect above schedules a navigation, render nothing —
  // we explicitly do NOT want to flash the legacy ExploreInterface (which
  // would dispatch a /api/chat/stream call if the user typed quickly).
  if (useChatV2 && conversationId == null) {
    return <Box bg="bg.canvas" h={{ base: 'calc(100vh - 80px)', md: '100vh' }} aria-label="explore-redirecting-to-chats" />;
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
