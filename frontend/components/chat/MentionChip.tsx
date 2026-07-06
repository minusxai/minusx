import React from 'react';
import { Box, Icon, Text } from '@chakra-ui/react';
import type { ChatMentionData } from '@/lib/types';
import { ACCENT_HEX } from '@/lib/ui/file-metadata';
import { getMentionChipMetadata } from '../lexical/MentionNode';

const COLOR_MAP: Record<string, string> = {
  'accent.primary': ACCENT_HEX.primary,
  'accent.danger': ACCENT_HEX.danger,
  'accent.secondary': ACCENT_HEX.secondary,
  'accent.success': ACCENT_HEX.success,
  'accent.warning': ACCENT_HEX.warning,
  'accent.teal': ACCENT_HEX.teal,
  'accent.info': ACCENT_HEX.info,
  'accent.cyan': ACCENT_HEX.cyan,
  'accent.muted': ACCENT_HEX.muted,
};

interface MentionChipProps {
  data: ChatMentionData;
  /** Full `@{...}` string — stored on the element for copy/paste round-tripping. */
  raw: string;
}

/**
 * Inline mention chip (table / column / metric / file / skill).
 * Shared between chat messages (`MessageWithMentions`) and rendered markdown
 * (the `Markdown` component's mention rehype plugin).
 */
export function MentionChip({ data, raw }: MentionChipProps) {
  const displayText = data.name;
  const metaText = data.type === 'table'
    ? data.schema
    : (data.type === 'column' || data.type === 'metric')
      ? (data.schema && data.table ? `${data.schema}.${data.table}` : data.table)
      : undefined;
  const isSkill = data.type === 'skill';

  const metadata = getMentionChipMetadata(data, COLOR_MAP);

  // Map mention type to Chakra semantic color token for the icon
  const iconColorToken = isSkill ? 'accent.teal'
    : data.type === 'table' ? 'accent.cyan'
    : data.type === 'column' ? 'accent.secondary'
    : data.type === 'metric' ? 'accent.teal'
    : data.type === 'question' ? 'accent.primary'
    : data.type === 'dashboard' ? 'accent.danger'
    : 'fg.muted';

  return (
    <Box
      as="span"
      display="inline"
      px="4px"
      py="2px"
      mx="1px"
      bg="bg.muted"
      borderRadius="sm"
      fontSize="0.85em"
      fontFamily="mono"
      lineHeight="inherit"
      color="fg.default"
      fontWeight="600"
      whiteSpace="nowrap"
      data-mention-json={raw}
      userSelect="all"
    >
      <Text as="span" color={iconColorToken}>
        {isSkill ? '#' : metadata.icon ? <Icon as={metadata.icon} boxSize="0.85em" verticalAlign="-0.1em" /> : null}
      </Text>
      {' '}
      {metaText && (
        <Text as="span" color="fg.muted" fontWeight="500">{metaText}.</Text>
      )}
      <Text as="span">{displayText}</Text>
    </Box>
  );
}
