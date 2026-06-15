'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { shallowEqual } from 'react-redux';
import { Box, Center, Flex, Spinner, Text } from '@chakra-ui/react';

import { useAppDispatch, useAppSelector } from '@/store/hooks';
import { setUser } from '@/store/authSlice';
import { selectMergedContent } from '@/store/filesSlice';
import { selectAugmentedFiles } from '@/lib/store/file-selectors';
import { compressAugmentedFile, APP_STATE_LIMIT_CHARS } from '@/lib/api/compress-augmented';
import { useFile } from '@/lib/hooks/file-state-hooks';
import StoryView from '@/components/views/story/StoryView';
import ChatInterface from '@/components/explore/ChatInterface';
import ShareLeadGate from './ShareLeadGate';
import { StoryContent } from '@/lib/types';
import type { AppState } from '@/lib/appState';
import type { Mode } from '@/lib/mode/mode-types';

interface ShareSession {
  fileId: number;
  folderPath: string;
  home_folder: string;
  mode: Mode;
  uid: number;
  canChat: boolean;
  chatEnabled: boolean;
  name?: string;
}

type Status = 'minting' | 'ready' | 'error';

const CHAT_WIDTH = '420px';

/** Mints/refreshes the guest session. Returns the session payload or throws. */
async function mintSession(shareId: string, body: Record<string, unknown>): Promise<ShareSession> {
  const res = await fetch('/api/share/guest-session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ shareId, ...body }),
  });
  if (!res.ok) throw new Error(`mint failed: ${res.status}`);
  return res.json();
}

export default function SharePageClient({ shareId }: { shareId: string }) {
  const dispatch = useAppDispatch();
  const searchParams = useSearchParams();
  const skipLead = searchParams.has('skip_lead');

  const [status, setStatus] = useState<Status>('minting');
  const [session, setSession] = useState<ShareSession | null>(null);

  // Seed Redux auth with the guest identity so role-aware UI + chat behave consistently.
  // Server authz always relies on the httpOnly mx-guest cookie, not this.
  const applySession = (s: ShareSession) => {
    dispatch(setUser({
      id: s.uid,
      email: '',
      name: s.name || 'Guest',
      role: 'viewer',
      home_folder: s.home_folder,
      mode: s.mode,
    }));
    setSession(s);
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const s = await mintSession(shareId, { skipLead });
        if (!cancelled) { applySession(s); setStatus('ready'); }
      } catch {
        if (!cancelled) setStatus('error');
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shareId, skipLead]);

  const handleLead = async (name: string, email: string) => {
    const s = await mintSession(shareId, { name, email });
    applySession(s);
  };

  // Build the "file is open" app state for the shared story, so the chat knows what
  // "this report" refers to (the route-based selector doesn't recognize /l/ pages).
  const fileId = session?.fileId;
  const augmented = useAppSelector(
    state => (fileId !== undefined ? selectAugmentedFiles(state, [fileId])[0] : undefined),
    shallowEqual,
  );
  const storyAppState = useMemo<AppState | null>(
    () => (augmented ? { type: 'file', state: compressAugmentedFile(augmented, APP_STATE_LIMIT_CHARS) } : null),
    [augmented],
  );

  if (status === 'minting') {
    return <Center h="100vh" bg="bg.canvas"><Spinner size="xl" color="primary" /></Center>;
  }
  if (status === 'error' || !session) {
    return (
      <Center h="100vh" bg="bg.canvas">
        <Text color="fg.muted">This link is invalid or has been revoked.</Text>
      </Center>
    );
  }

  const showChat = session.chatEnabled;

  return (
    <Flex h="100vh" bg="bg.canvas" overflow="hidden">
      <Box flex="1" overflowY="auto" px={{ base: 4, md: 8 }} py={6}>
        <SharedStory fileId={session.fileId} />
      </Box>
      {showChat && (
        <Box
          w={{ base: '100%', md: CHAT_WIDTH }}
          flexShrink={0}
          borderLeftWidth="1px"
          borderColor="border.default"
          bg="bg.surface"
          display={{ base: 'none', md: 'flex' }}
          flexDirection="column"
          h="100vh"
        >
          {session.canChat ? (
            <ChatInterface contextPath={session.folderPath} container="sidebar" appState={storyAppState} />
          ) : (
            <ShareLeadGate onSubmit={handleLead} />
          )}
        </Box>
      )}
    </Flex>
  );
}

/** Read-only story renderer (mirrors StoryContainerV2 but pins readOnly). */
function SharedStory({ fileId }: { fileId: number }) {
  const { fileState: file } = useFile(fileId) ?? {};
  const mergedContent = useAppSelector(state => selectMergedContent(state, fileId)) as StoryContent | undefined;

  const ready = useMemo(() => Boolean(file && !file.loading && mergedContent), [file, mergedContent]);
  if (!ready || !mergedContent) {
    return <Center h="60vh"><Spinner size="lg" /></Center>;
  }
  return <StoryView content={mergedContent} viewMode="visual" readOnly />;
}
