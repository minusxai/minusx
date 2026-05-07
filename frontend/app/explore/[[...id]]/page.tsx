'use client';

import { useParams } from 'next/navigation';
import { Box } from '@chakra-ui/react';
import ExploreInterface from '@/components/explore/ExploreInterface';
import ChatV2Container from '@/components/containers/ChatV2Container';
import { useAppSelector } from '@/store/hooks';
import { DEFAULT_MODE } from '@/lib/mode/mode-types';
import { useFile } from '@/lib/hooks/file-state-hooks';

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

  // /explore is the unified entry. Layout / chat input / sidebar / etc. all
  // come from ExploreInterface regardless of `?v=2` — the user wants the
  // page to LOOK identical with or without the toggle. The only thing
  // `?v=2` changes is which API the create + send flows hit; that gating
  // lives inside ExploreInterface (and downstream chatSlice/listener), not
  // here. File-type routing is the one exception: an existing chat file
  // (type:'chat') renders the chat-v2 detail surface either way.
  const { fileState: probeFile } = useFile(conversationId ?? 0) ?? {};
  const isChatFile = !!probeFile && !probeFile.loading && probeFile.type === 'chat';

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

  return (
    <Box bg="bg.canvas" h={{base: 'calc(100vh - 80px)', md: '100vh'}} overflow="hidden">
      <ExploreInterface
        conversationId={conversationId}
        filePath={filePath}
      />
    </Box>
  );
}
