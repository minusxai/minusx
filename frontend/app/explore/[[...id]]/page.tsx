'use client';

import { useParams, useSearchParams } from 'next/navigation';
import { Box } from '@chakra-ui/react';
import ExploreInterface from '@/components/explore/ExploreInterface';

export default function ExplorePage() {
  // useParams() reads route params synchronously without causing Suspense/remount
  // (use(params) was causing ExploreInterface to remount on navigation, resetting state)
  const params = useParams<{ id?: string[] }>();
  const searchParams = useSearchParams();
  const id = params?.id;

  // Parse conversationId as number (file ID)
  const conversationId = id?.[0] ? parseInt(id[0], 10) : undefined;
  const linkedContextVersion = searchParams.get('contextVersion');
  const initialContextVersion = linkedContextVersion && /^\d+$/.test(linkedContextVersion)
    ? Number(linkedContextVersion)
    : undefined;

  // Explore page uses empty string for filePath (isolates conversations from sidebar)
  const filePath = "";

  return (
    <Box bg="bg.canvas" h={{base: 'calc(100vh - 80px)', md: '100vh'}} overflow="hidden">
      <ExploreInterface
        conversationId={conversationId}
        filePath={filePath}
        initialContextPath={searchParams.get('context')}
        initialContextVersion={initialContextVersion}
        initialAgentName={searchParams.get('agent')}
      />
    </Box>
  );
}
