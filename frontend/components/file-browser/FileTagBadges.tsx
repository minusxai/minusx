'use client';

/**
 * System-tag badges for a file (`meta.tags` — script/programmatic-written markers,
 * never user-edited). Pure view: takes the meta blob, renders one small badge per
 * tag, nothing when there are none. Known tags get a human label; unknown tags
 * render their raw name so a future tagger is visible without a UI change.
 */
import { HStack, Text } from '@chakra-ui/react';
import { getFileTags, FILE_TAG_LEGACY_STORY } from '@/lib/types/files';

/** Human labels for known system tags; unknown tags fall back to the raw name. */
const TAG_LABELS: Record<string, string> = {
  [FILE_TAG_LEGACY_STORY]: 'Legacy',
};

interface FileTagBadgesProps {
  meta: Record<string, unknown> | null | undefined;
  compact?: boolean;
}

export default function FileTagBadges({ meta, compact = false }: FileTagBadgesProps) {
  const tags = getFileTags(meta);
  if (tags.length === 0) return null;

  return (
    <HStack gap={1} flexShrink={0} flexWrap="wrap" justify="center">
      {tags.map((tag) => (
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
          {TAG_LABELS[tag] ?? tag}
        </Text>
      ))}
    </HStack>
  );
}
