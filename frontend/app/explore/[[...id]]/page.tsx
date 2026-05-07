'use client';

import { useParams } from 'next/navigation';
import { Box } from '@chakra-ui/react';
import ExploreInterface from '@/components/explore/ExploreInterface';
import { useAppSelector } from '@/store/hooks';
import { DEFAULT_MODE } from '@/lib/mode/mode-types';

export default function ExplorePage() {
  // useParams() reads route params synchronously without causing Suspense/remount
  // (use(params) was causing ExploreInterface to remount on navigation, resetting state)
  const params = useParams<{ id?: string[] }>();
  const id = params?.id;

  // Get user mode from Redux
  const user = useAppSelector(state => state.auth.user);
  const mode = user?.mode || DEFAULT_MODE;
  void mode;

  // Parse conversationId as number (file ID). For v=2, this is also the chat
  // file id — useChatData picks the v=2 adapter when ?v=2 is present.
  const conversationId = id?.[0] ? parseInt(id[0], 10) : undefined;

  // Explore page uses empty string for filePath (isolates conversations from sidebar)
  const filePath = '';

  return (
    <Box bg="bg.canvas" h={{ base: 'calc(100vh - 80px)', md: '100vh' }} overflow="hidden">
      <ExploreInterface conversationId={conversationId} filePath={filePath} />
    </Box>
  );
}
