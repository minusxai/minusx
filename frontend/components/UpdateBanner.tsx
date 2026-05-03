'use client';

import { useEffect, useState } from 'react';
import { Flex, Text, Icon, IconButton, Code } from '@chakra-ui/react';
import { LuRefreshCw, LuX } from 'react-icons/lu';
import { GIT_COMMIT_SHA, BUILD_TIME, DISABLE_UPDATE_BANNER } from '@/lib/constants';
import { useAppSelector } from '@/store/hooks';
import { selectEffectiveUser } from '@/store/authSlice';

const INSTALL_CMD = 'curl -fsSL https://raw.githubusercontent.com/minusxai/minusx/main/install.sh | bash';
const CACHE_KEY = 'minusx-update-check';
const TTL_MS = 24 * 60 * 60 * 1000;
const MIN_AGE_MS = 10 * 24 * 60 * 60 * 1000;
const MIN_COMMITS_BEHIND = 10;

interface UpdateCache {
  checkedAt: number;
  shouldShow: boolean;
  dismissedAt?: number;
}

function readCache(): UpdateCache | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as UpdateCache) : null;
  } catch {
    return null;
  }
}

function writeCache(patch: Partial<UpdateCache>) {
  try {
    const existing = readCache() ?? { checkedAt: 0, shouldShow: false };
    localStorage.setItem(CACHE_KEY, JSON.stringify({ ...existing, ...patch }));
  } catch {
    // localStorage unavailable — no-op
  }
}

export default function UpdateBanner() {
  const user = useAppSelector(selectEffectiveUser);
  const [visible, setVisible] = useState(false);

  if (user?.role !== 'admin') return null;

  useEffect(() => {
    if (GIT_COMMIT_SHA === 'unknown' || DISABLE_UPDATE_BANNER) return;

    let cancelled = false;

    (async () => {
      // Defer out of the synchronous effect body
      await Promise.resolve();

      const cache = readCache();
      const now = Date.now();

      if (cache?.dismissedAt && now - cache.dismissedAt < TTL_MS) return;
      if (cache && now - cache.checkedAt < TTL_MS) {
        if (!cancelled) setVisible(cache.shouldShow);
        return;
      }

      // Skip API call if the build is too fresh
      if (BUILD_TIME && now - new Date(BUILD_TIME).getTime() < MIN_AGE_MS) {
        writeCache({ checkedAt: now, shouldShow: false });
        return;
      }

      try {
        const r = await fetch(
          `https://api.github.com/repos/minusxai/minusx/compare/25bd27d...main`,
          { headers: { Accept: 'application/vnd.github+json' } },
        );
        if (!r.ok) throw new Error(`status ${r.status}`);
        const data = await r.json();
        const shouldShow = typeof data.ahead_by === 'number' && data.ahead_by >= MIN_COMMITS_BEHIND;
        writeCache({ checkedAt: now, shouldShow });
        if (!cancelled) setVisible(shouldShow);
      } catch {
        writeCache({ checkedAt: now, shouldShow: false });
      }
    })();

    return () => { cancelled = true; };
  }, []);

  if (!visible) return null;

  const handleDismiss = () => {
    writeCache({ dismissedAt: Date.now() });
    setVisible(false);
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(INSTALL_CMD).catch(() => {});
  };

  return (
    <Flex
      bg="accent.primary"
      color="white"
      px={4}
      py={2}
      align="center"
      gap={3}
      flexWrap="wrap"
      role="status"
      aria-label="Update available"
    >
      <Icon as={LuRefreshCw} boxSize={4} flexShrink={0} aria-hidden="true" />
      <Text fontSize="sm" fontWeight="500" flexShrink={0}>
        A new version of MinusX is available.
      </Text>
      <Flex align="center" gap={2} flex={1} flexWrap="wrap">
        <Text fontSize="xs" opacity={0.9} flexShrink={0}>To update, in the same directory re-run:</Text>
        <Code
          fontSize="xs"
          bg="whiteAlpha.200"
          color="white"
          px={2}
          py={0.5}
          borderRadius="sm"
          cursor="pointer"
          onClick={handleCopy}
          title="Click to copy"
          flexShrink={1}
          overflow="hidden"
          textOverflow="ellipsis"
          whiteSpace="nowrap"
        >
          {INSTALL_CMD}
        </Code>
      </Flex>
      <Flex gap={2} align="center" flexShrink={0}>
        <IconButton
          aria-label="Dismiss update banner"
          size="xs"
          variant="ghost"
          color="white"
          _hover={{ bg: 'whiteAlpha.200' }}
          onClick={handleDismiss}
        >
          <LuX />
        </IconButton>
      </Flex>
    </Flex>
  );
}
