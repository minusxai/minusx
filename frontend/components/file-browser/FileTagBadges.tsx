'use client';

/**
 * System-tag indicators for a file (`meta.tags` — script/programmatic-written
 * markers, never user-edited). Pure view: takes the meta blob, renders one small
 * indicator per tag, nothing when there are none.
 *
 * Known tags render as a compact ICON with a tooltip, placed beside the file-type
 * icon the browser already shows (a text pill next to every name read as noise).
 * Unknown tags fall back to a plain text pill so a future tagger is visible
 * without a UI change. Every indicator carries `aria-label="<tag> tag"`.
 */
import { HStack, Icon, Text } from '@chakra-ui/react';
import { LuHistory } from 'react-icons/lu';
import type { IconType } from 'react-icons';
import { Tooltip } from '@/components/kit/tooltip';
import { getFileTags, FILE_TAG_LEGACY_STORY } from '@/lib/types/files';

/** Known system tags: icon + human tooltip. Unknown tags render a text pill. */
const TAG_ICONS: Record<string, { icon: IconType; tooltip: string }> = {
  [FILE_TAG_LEGACY_STORY]: {
    icon: LuHistory,
    tooltip: 'Legacy story — authored on the old pipeline',
  },
};

interface FileTagBadgesProps {
  meta: Record<string, unknown> | null | undefined;
  compact?: boolean;
}

export default function FileTagBadges({ meta, compact = false }: FileTagBadgesProps) {
  const tags = getFileTags(meta);
  if (tags.length === 0) return null;

  return (
    <HStack gap={1} flexShrink={0} align="center">
      {tags.map((tag) => {
        const known = TAG_ICONS[tag];
        if (known) {
          return (
            <Tooltip key={tag} content={known.tooltip}>
              <Icon
                as={known.icon}
                aria-label={`${tag} tag`}
                boxSize={compact ? 3 : 3.5}
                color="fg.muted"
                cursor="default"
              />
            </Tooltip>
          );
        }
        return (
          <Text
            key={tag}
            aria-label={`${tag} tag`}
            px={1.5}
            py={0.5}
            bg="bg.muted"
            color="fg.muted"
            borderRadius="full"
            fontSize={compact ? '2xs' : 'xs'}
            fontWeight="500"
            fontFamily="mono"
            cursor="default"
          >
            {tag}
          </Text>
        );
      })}
    </HStack>
  );
}
