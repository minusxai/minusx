import React from 'react';
import { Box, HStack, VStack, Text, Icon } from '@chakra-ui/react';
import {
  MentionOption,
  isSlashCommand,
  getMentionBadgeInfo,
  getMentionPrimaryText,
  getMentionMetaText,
} from './mentions-plugin-utils';
import { LuChevronRight } from 'react-icons/lu';

interface MentionRowProps {
  mention: MentionOption;
  index: number;
  isSelected: boolean;
  selectedItemRef: React.RefObject<HTMLDivElement | null>;
  isUserSkillHeader: boolean;
  isSystemSkillHeader: boolean | null;
  onHover: (index: number) => void;
  onSelect: (mention: MentionOption) => void;
}

/** A single row in the mentions dropdown (plus any group header above it). */
export function MentionRow({
  mention,
  index,
  isSelected,
  selectedItemRef,
  isUserSkillHeader,
  isSystemSkillHeader,
  onHover,
  onSelect,
}: MentionRowProps) {
  return (
    <>
      {isUserSkillHeader && (
        <Box px={3} py={1.5} bg="bg.subtle" borderBottom="1px solid" borderColor="border.muted">
          <Text fontSize="2xs" fontWeight="700" color="fg.muted" textTransform="uppercase" letterSpacing="0.02em">
            Your skills
          </Text>
        </Box>
      )}
      {isSystemSkillHeader && (
        <Box px={3} py={1.5} bg="bg.subtle" borderBottom="1px solid" borderColor="border.muted">
          <Text fontSize="2xs" fontWeight="700" color="fg.muted" textTransform="uppercase" letterSpacing="0.02em">
            System
          </Text>
        </Box>
      )}
      <Box
        ref={isSelected ? selectedItemRef : null}
        px={3}
        py={2.5}
        cursor={isSlashCommand(mention) && mention.disabled ? 'not-allowed' : 'pointer'}
        opacity={isSlashCommand(mention) && mention.disabled ? 0.4 : 1}
        bg={isSelected ? 'bg.muted' : 'transparent'}
        borderBottom="1px solid"
        borderColor="border.muted"
        _last={{ borderBottom: 'none' }}
        _hover={isSlashCommand(mention) && mention.disabled ? {} : { bg: 'bg.muted' }}
        onMouseEnter={() => onHover(index)}
        onClick={() => onSelect(mention)}
      >
        {(() => {
          const badgeInfo = getMentionBadgeInfo(mention);
          const primary = getMentionPrimaryText(mention);
          const meta = getMentionMetaText(mention);
          return (
            <HStack gap={2.5} align="start" minW={0}>
              <Box
                as="span"
                display="inline-flex"
                alignItems="center"
                justifyContent="center"
                minW="54px"
                h="20px"
                px={1.5}
                bg={`color-mix(in srgb, ${badgeInfo.color} 12%, transparent)`}
                color={badgeInfo.color}
                borderRadius="full"
                fontSize="2xs"
                fontWeight="700"
                flexShrink={0}
                gap={1}
              >
                {badgeInfo.icon && <Icon as={badgeInfo.icon} boxSize={3} />}
                {badgeInfo.label}
              </Box>
              <VStack gap={0.5} align="stretch" minW={0} flex={1}>
                <HStack gap={1.5} minW={0} align="baseline">
                  <Text fontSize="sm" fontWeight="650" color="fg.default" truncate>
                    {primary}
                  </Text>
                  {!isSlashCommand(mention) && mention.type === 'table' && meta && (
                    <Text fontSize="xs" color="fg.subtle" flexShrink={0}>
                      {meta}
                    </Text>
                  )}
                </HStack>
                {(isSlashCommand(mention) || (!isSlashCommand(mention) && mention.type === 'skill')) && meta && (
                  <Text fontSize="xs" color="fg.muted" lineClamp={2}>
                    {meta}
                  </Text>
                )}
              </VStack>
              {/* Every table can drill down into its columns (resolved on demand). */}
              {!isSlashCommand(mention) && mention.type === 'table' && (
                <Icon as={LuChevronRight} boxSize={3.5} color="fg.subtle" flexShrink={0} alignSelf="center" />
              )}
            </HStack>
          );
        })()}
      </Box>
    </>
  );
}
