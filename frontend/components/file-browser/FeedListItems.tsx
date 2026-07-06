'use client';

import { useEffect, useState } from 'react';
import { Box, HStack, Text, VStack, Icon, Skeleton } from '@chakra-ui/react';
// Param-preserving Link so file/chat links keep ?v=2 (and as_user/mode).
import { Link } from '@/components/ui/Link';
import { LuMessageSquare, LuArrowRight } from 'react-icons/lu';
import { FILE_TYPE_METADATA } from '@/lib/ui/file-metadata';
import { generateFileUrl } from '@/lib/slug-utils';
import type { RecentFile } from '@/lib/analytics/file-analytics.types';
import type { ConversationSummary } from '@/app/api/conversations/route';

/**
 * Compute "5m ago" / "yesterday" / etc. relative to a given `now`. Splitting
 * `now` from the call means callers control SSR-safety — see <RelativeTime>
 * below for the hydration-safe component wrapper.
 */
function relativeTime(isoString: string, now: number): string {
  const then = new Date(isoString).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay === 1) return 'yesterday';
  if (diffDay < 7) return `${diffDay}d ago`;
  if (diffDay < 30) return `${Math.floor(diffDay / 7)}w ago`;
  return `${Math.floor(diffDay / 30)}mo ago`;
}

/**
 * Hydration-safe "5m ago"-style label.
 *
 * On SSR (and the first client render before useEffect runs) we emit a
 * locale-formatted absolute date — deterministic, identical on both sides, so
 * React's hydration check passes. After mount we swap to the relative form
 * and refresh every minute. This was the source of Sentry MINUSX-BI-3 —
 * `relativeTime` previously read `Date.now()` directly during render, so SSR
 * at T and client at T+Δ produced different text (and cascaded into the
 * React-reported "xmlns" SVG-frame in the stack).
 */
export function RelativeTime({ iso }: { iso: string }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    // Intentional setState-on-mount: this hook deliberately defers the
    // "Date.now()"-dependent render to post-hydration. Same pattern as
    // useFilesByCriteria in lib/hooks/file-state-hooks.ts.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  if (now === null) {
    return <>{new Date(iso).toLocaleDateString()}</>;
  }
  return <>{relativeTime(iso, now)}</>;
}

/** Section header with horizontal rule */
export function SectionHeader({ label }: { label: string }) {
  return (
    <HStack gap={2}>
      <Text fontSize="2xs" fontFamily="mono" fontWeight="600" color="fg.subtle" textTransform="uppercase" letterSpacing="wider" flexShrink={0}>
        {label}
      </Text>
      <Box flex="1" h="1px" bg="border.default" />
    </HStack>
  );
}

/** Empty state with optional CTA link */
export function SectionEmptyState({ message, linkLabel, linkHref }: { message: string; linkLabel?: string; linkHref?: string }) {
  return (
    <VStack gap={2} py={4} align="center">
      <Text fontSize="xs" color="fg.subtle" fontFamily="mono">
        {message}
      </Text>
      {linkLabel && linkHref && (
        <Link href={linkHref}>
          <HStack
            gap={1.5}
            px={3}
            py={1}
            borderRadius="full"
            bg="accent.teal/10"
            cursor="pointer"
            transition="all 0.15s ease"
            _hover={{ bg: 'accent.teal/20' }}
          >
            <Icon as={LuArrowRight} color="accent.teal" boxSize={3} />
            <Text fontSize="2xs" fontWeight="600" fontFamily="mono" color="accent.teal">
              {linkLabel}
            </Text>
          </HStack>
        </Link>
      )}
    </VStack>
  );
}

/** Skeleton for list sections (dashboards, conversations) */
export function ListSkeleton({ count = 3 }: { count?: number }) {
  return (
    <VStack gap={2} align="stretch">
      {Array.from({ length: count }, (_, i) => (
        <HStack key={i} gap={2.5} py={1.5} px={2}>
          <Skeleton height="12px" width="12px" borderRadius="sm" />
          <Skeleton height="10px" flex="1" borderRadius="sm" />
          <Skeleton height="10px" width="40px" borderRadius="sm" />
        </HStack>
      ))}
    </VStack>
  );
}

/** Compact list item */
export function CompactFileLink({ file, meta: subtitle }: { file: RecentFile; meta: React.ReactNode }) {
  const typeMeta = FILE_TYPE_METADATA[file.fileType as keyof typeof FILE_TYPE_METADATA];
  const FileIcon = typeMeta?.icon;
  const color = typeMeta?.color ?? 'fg.muted';

  return (
    <Link href={`/f/${generateFileUrl(file.fileId, file.fileName)}`}>
      <HStack
        gap={2.5}
        py={1.5}
        px={2}
        borderRadius="md"
        cursor="pointer"
        transition="all 0.15s ease"
        _hover={{ bg: 'bg.surface' }}
      >
        {FileIcon && (
          <Icon as={FileIcon} color={color} boxSize={3} flexShrink={0} />
        )}
        <Box flex="1" minW={0}>
          <Text fontSize="xs" fontWeight="500" color="fg.default" truncate fontFamily="mono">
            {file.fileName}
          </Text>
        </Box>
        <Text fontSize="2xs" color="fg.subtle" flexShrink={0} fontFamily="mono">
          {subtitle}
        </Text>
      </HStack>
    </Link>
  );
}

/** Compact conversation link for the feed */
export function CompactConversationLink({ conversation }: { conversation: ConversationSummary }) {
  return (
    <Link href={`/explore/${conversation.id}`}>
      <HStack
        gap={2.5}
        py={1.5}
        px={2}
        borderRadius="md"
        cursor="pointer"
        transition="all 0.15s ease"
        _hover={{ bg: 'bg.surface' }}
        overflow="hidden"
      >
        <Icon as={LuMessageSquare} color="fg.muted" boxSize={3} flexShrink={0} />
        <Text flex="1" minW={0} fontSize="xs" fontWeight="500" color="fg.default" truncate fontFamily="mono">
          {conversation.name}
        </Text>
        <Text fontSize="2xs" color="fg.subtle" flexShrink={0} fontFamily="mono">
          <RelativeTime iso={conversation.updatedAt} />
        </Text>
      </HStack>
    </Link>
  );
}
