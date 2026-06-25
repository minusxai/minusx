'use client';

import { Box, GridItem, HStack, VStack, Text, Icon, Image } from '@chakra-ui/react';
import { LuCamera, LuX } from 'react-icons/lu';
import { DisplayProps } from '@/lib/types';
import { type DetailCardProps, parseToolContent } from './DetailCarousel';

const IMG_LABEL = 'Captured screenshot';

/** Pull the captured image URL out of the Screenshot tool result (its image_url content block). */
function screenshotUrl(content: unknown): string | null {
  const arr = Array.isArray(content)
    ? content
    : Array.isArray((content as { content?: unknown } | null)?.content)
      ? (content as { content: unknown[] }).content
      : null;
  if (!arr) return null;
  const img = (arr as Array<{ type?: string; image_url?: { url?: string } }>).find(b => b?.type === 'image_url');
  return img?.image_url?.url ?? null;
}

// ─── Detail card (AgentTurnContainer carousel) — the full screenshot ──────────
export function ScreenshotDetailCard({ msg }: DetailCardProps) {
  const url = screenshotUrl(parseToolContent(msg));
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
      <Image aria-label={IMG_LABEL} alt={IMG_LABEL} src={url} w="full" objectFit="contain" />
    </Box>
  );
}

// ─── Compact display — a thumbnail inline under the response ──────────────────
export default function ScreenshotDisplay({ toolCallTuple }: DisplayProps) {
  const [, toolMessage] = toolCallTuple;
  // Still capturing — render nothing until the result lands (timeline shows the pending tool).
  if (toolMessage.content === '(executing...)') return null;

  const url = screenshotUrl(toolMessage.content);
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
          maxH="240px"
          w="full"
          objectFit="contain"
          borderRadius="sm"
          border="1px solid"
          borderColor="border.muted"
          bg="bg.canvas"
        />
      </VStack>
    </GridItem>
  );
}
