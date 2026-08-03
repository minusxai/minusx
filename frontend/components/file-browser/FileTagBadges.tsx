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

/** Known system tags: icon + short label + human tooltip. Unknown tags render a text pill. */
const TAG_DISPLAY: Record<string, { icon: IconType; label: string; tooltip: string }> = {
  [FILE_TAG_LEGACY_STORY]: {
    icon: LuHistory,
    label: 'Legacy',
    tooltip: 'Legacy story — authored on the old pipeline',
  },
};

interface FileTagBadgesProps {
  meta: Record<string, unknown> | null | undefined;
  compact?: boolean;
  /**
   * `labeled` renders known tags as icon+text pills (the file HEADER, whose
   * neighbours — Story, File Health — are labeled pills; a bare 14px icon
   * disappears there). Default is icon-only, for rows/tiles where the
   * indicator sits directly beside the file-type icon.
   */
  labeled?: boolean;
}

export default function FileTagBadges({ meta, compact = false, labeled = false }: FileTagBadgesProps) {
  const tags = getFileTags(meta);
  if (tags.length === 0) return null;

  return (
    <HStack gap={1} flexShrink={0} align="center">
      {tags.map((tag) => {
        const known = TAG_DISPLAY[tag];
        if (known && !labeled) {
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
        const pill = (
          <HStack
            key={tag}
            aria-label={`${tag} tag`}
            gap={1}
            px={2}
            py={0.5}
            bg="bg.muted"
            color="fg.muted"
            borderRadius="full"
            fontSize={compact ? '2xs' : 'xs'}
            fontWeight="500"
            fontFamily="mono"
            cursor="default"
          >
            {known && <Icon as={known.icon} boxSize={3} />}
            <Text>{known?.label ?? tag}</Text>
          </HStack>
        );
        return known ? <Tooltip key={tag} content={known.tooltip}>{pill}</Tooltip> : pill;
      })}
    </HStack>
  );
}
