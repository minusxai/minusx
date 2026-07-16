'use client';

import { Box, GridItem, HStack, VStack, Text, Icon, Image } from '@chakra-ui/react';
import { LuCamera, LuX } from 'react-icons/lu';
import { DisplayProps, type ScreenshotDetails } from '@/lib/types';
import { type DetailCardProps } from './DetailCarousel';
import { useAppDispatch } from '@/store/hooks';
import { openImageLightbox } from '@/store/uiSlice';

const IMG_LABEL = 'Captured screenshot';

/** Find an image_url block's url inside a content array. */
function urlFromContentArray(content: unknown): string | null {
  const arr = Array.isArray(content)
    ? content
    : Array.isArray((content as { content?: unknown } | null)?.content)
      ? (content as { content: unknown[] }).content
      : null;
  if (!arr) return null;
  const img = (arr as Array<{ type?: string; image_url?: { url?: string } }>).find(b => b?.type === 'image_url');
  return img?.image_url?.url ?? null;
}

/**
 * Robustly extract the screenshot URL from a tool message in ANY shape it can take:
 *  - live stream: `details.screenshotUrl` (preferred) or a content array with an image_url block;
 *  - after the turn: content reloaded as a JSON string, or an object whose `details.screenshotUrl`
 *    rides along. `details` is the UI-only channel that survives the turn, so it's tried first.
 */
function extractScreenshotUrl(msg: { details?: unknown; content?: unknown }): string | null {
  const fromDetails = (msg.details as ScreenshotDetails | undefined)?.screenshotUrl;
  if (fromDetails) return fromDetails;
  let c: unknown = msg.content;
  if (typeof c === 'string') {
    try { c = JSON.parse(c); } catch { return null; }
  }
  const nested = (c as { details?: ScreenshotDetails } | null)?.details?.screenshotUrl;
  if (nested) return nested;
  return urlFromContentArray(c);
}

// ─── Detail card (AgentTurnContainer carousel) — the full screenshot ──────────
export function ScreenshotDetailCard({ msg }: DetailCardProps) {
  const dispatch = useAppDispatch();
  const url = extractScreenshotUrl(msg as { details?: unknown; content?: unknown });
  if (!url) {
    return (
      <Box mx={3} mb={2} p={3} bg="bg.subtle" borderRadius="md" border="1px solid" borderColor="border.default">
        <HStack gap={2}>
          <Icon as={LuX} boxSize={4} color="accent.danger" />
          <Text fontSize="sm" color="fg.muted">Screenshot unavailable</Text>
        </HStack>
      </Box>
    );
  }
  return (
    <Box mx={3} mb={2} borderRadius="md" border="1px solid" borderColor="border.default" overflow="hidden" bg="bg.canvas">
      {/* loading=lazy: slim-view screenshots are lazy URLs — only fetch when scrolled near view. */}
      <Image aria-label={IMG_LABEL} alt={IMG_LABEL} src={url} loading="lazy" w="full" objectFit="contain"
        cursor="zoom-in" onClick={() => dispatch(openImageLightbox(url))} />
    </Box>
  );
}

// ─── Compact display — a thumbnail inline under the response ──────────────────
export default function ScreenshotDisplay({ toolCallTuple }: DisplayProps) {
  const dispatch = useAppDispatch();
  const [, toolMessage] = toolCallTuple;
  // Still capturing — render nothing until the result lands (timeline shows the pending tool).
  if (toolMessage.content === '(executing...)') return null;

  const url = extractScreenshotUrl(toolMessage);
  if (!url) {
    return (
      <GridItem colSpan={12} my={1}>
        <HStack gap={1.5} py={1.5} px={2} bg="accent.danger/8" borderRadius="md" border="1px solid" borderColor="accent.danger/15">
          <Icon as={LuX} boxSize={3} color="accent.danger" flexShrink={0} />
          <Text fontSize="xs" color="fg.muted" fontFamily="mono">Screenshot failed</Text>
        </HStack>
      </GridItem>
    );
  }

  return (
    <GridItem colSpan={12} my={1}>
      <VStack gap={1.5} align="stretch" bg="accent.primary/8" borderRadius="md" border="1px solid" borderColor="accent.primary/15" p={2}>
        <HStack gap={1.5}>
          <Icon as={LuCamera} boxSize={3} color="accent.primary" flexShrink={0} />
          <Text fontSize="xs" color="fg.muted" fontFamily="mono">Screenshot</Text>
        </HStack>
        <Image
          aria-label={IMG_LABEL}
          alt={IMG_LABEL}
          src={url}
          loading="lazy"
          maxH="240px"
          w="full"
          objectFit="contain"
          borderRadius="sm"
          border="1px solid"
          borderColor="border.muted"
          bg="bg.canvas"
          cursor="zoom-in"
          onClick={() => dispatch(openImageLightbox(url))}
        />
      </VStack>
    </GridItem>
  );
}
