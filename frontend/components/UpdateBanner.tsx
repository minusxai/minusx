'use client';

import { useEffect, useState } from 'react';
import { Flex, Text, Icon, IconButton, Code } from '@chakra-ui/react';
import { Tooltip } from '@/components/ui/tooltip';
import { LuRefreshCw, LuX, LuCopy, LuCheck } from 'react-icons/lu';
import { GIT_COMMIT_SHA, BUILD_TIME, DISABLE_UPDATE_BANNER } from '@/lib/constants';
import { useAppSelector } from '@/store/hooks';
import { selectEffectiveUser } from '@/store/authSlice';

const INSTALL_CMD = 'curl -fsSL https://minusx.ai/install.sh | bash';
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
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (user?.role !== 'admin') return;
    if (GIT_COMMIT_SHA === 'unknown' || DISABLE_UPDATE_BANNER) return;

    let cancelled = false;

    (async () => {
      await Promise.resolve();

      const cache = readCache();
      const now = Date.now();

      if (cache?.dismissedAt && now - cache.dismissedAt < TTL_MS) return;
      if (cache && now - cache.checkedAt < TTL_MS) {
        if (!cancelled) setVisible(cache.shouldShow);
        return;
      }

      if (BUILD_TIME && now - new Date(BUILD_TIME).getTime() < MIN_AGE_MS) {
        writeCache({ checkedAt: now, shouldShow: false });
        return;
      }

      try {
        const r = await fetch(
          `https://api.github.com/repos/minusxai/minusx/compare/${GIT_COMMIT_SHA}...main`,
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
  }, [user?.role]);

  if (user?.role !== 'admin' || !visible) return null;

  const handleDismiss = () => {
    writeCache({ dismissedAt: Date.now() });
    setVisible(false);
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(INSTALL_CMD).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  };

  return (
    <Flex
      bg="accent.primary"
      color="white"
      px={4}
      py={2.5}
      align="center"
      justify="center"
      position="relative"
      gap={3}
      borderRadius="lg"
      mb={4}
      role="status"
      aria-label="Update available"
    >
      <Icon as={LuRefreshCw} boxSize={4} flexShrink={0} aria-hidden="true" />
      <Text fontSize="sm" fontWeight="500" flexShrink={0}>
        A new version of MinusX is available.
      </Text>
      <Text fontSize="xs" opacity={0.85} flexShrink={0}>Update by re-running (in the same directory):</Text>
      <Tooltip content="Click to copy">
        <Flex
          align="center"
          gap={2}
          bg="whiteAlpha.200"
          borderRadius="md"
          px={3}
          py={1.5}
          cursor="pointer"
          onClick={handleCopy}
          _hover={{ bg: 'whiteAlpha.300' }}
          transition="background 0.15s"
          maxW="500px"
        >
          <Code
            fontSize="xs"
            bg="transparent"
            color="white"
            overflow="hidden"
            textOverflow="ellipsis"
            whiteSpace="nowrap"
            flex={1}
          >
            {INSTALL_CMD}
          </Code>
          <Icon
            as={copied ? LuCheck : LuCopy}
            boxSize={3.5}
            color={copied ? 'green.200' : 'whiteAlpha.700'}
            flexShrink={0}
            transition="color 0.15s"
          />
        </Flex>
      </Tooltip>
      {copied && (
        <Text fontSize="xs" color="green.200" fontWeight="500" flexShrink={0}>
          Copied!
        </Text>
      )}
      <Flex position="absolute" right={4}>
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
