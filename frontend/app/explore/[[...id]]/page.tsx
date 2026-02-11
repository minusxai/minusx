'use client';

import { use } from 'react';
import { Box } from '@chakra-ui/react';
import ExploreInterface from '@/components/explore/ExploreInterface';
import { useAppSelector } from '@/store/hooks';
import { DEFAULT_MODE } from '@/lib/mode/mode-types';

interface ExplorePageProps {
  params: Promise<{ id?: string[] }>;
}

export default function ExplorePage({ params }: ExplorePageProps) {
  // Unwrap params Promise (Next.js 16 requirement)
  const { id } = use(params);
  console.log('explore params are', id)

  // Get user mode from Redux
  const user = useAppSelector(state => state.auth.user);
  const mode = user?.mode || DEFAULT_MODE;

  // Parse conversationId as number (file ID)
  const conversationId = id?.[0] ? parseInt(id[0], 10) : undefined;

  // Explore page uses empty string for filePath (isolates conversations from sidebar)
  const filePath = "";

  return (
    <Box bg="bg.canvas" h={{base: 'calc(100vh - 80px)', md: '100vh'}} overflow="hidden">
      <ExploreInterface
        conversationId={conversationId}
        filePath={filePath}
      />
    </Box>
  );
}
