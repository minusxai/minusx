'use client';

import { useState, useMemo } from 'react';
import { HStack, Box, Text, Icon, VStack } from '@chakra-ui/react';
import { LuChevronDown, LuChevronRight, LuCheck, LuX } from 'react-icons/lu';
import type { MessageWithFlags } from '../message/messageHelpers';
import { getToolConfig } from '@/lib/api/tool-config';
import { useAppSelector } from '@/store/hooks';

interface ToolChipsProps {
  toolMessages: MessageWithFlags[];
  readOnly: boolean;
  showThinking: boolean;
}

interface ChipGroup {
  chipLabel: string;
  chipLabelPlural: string;
  chipIcon: React.ComponentType;
  chipColor: string;
  messages: MessageWithFlags[];
}

/** Extract tool name from a tool message */
function getToolName(msg: MessageWithFlags): string {
  if (msg.role !== 'tool') return '';
  return (msg as any).function?.name || '';
}

/** Extract a display name from a tool call's arguments or result */
function getDisplayName(msg: MessageWithFlags): string {
  const toolMsg = msg as any;
  const args = toolMsg.function?.arguments;
  let parsed: any = {};
  try {
    parsed = typeof args === 'string' ? JSON.parse(args) : args || {};
  } catch { /* ignore */ }

  // Try common name fields
  return parsed.name || parsed.query || parsed.file_type || '';
}

/** Check if a tool message was successful */
function isSuccess(msg: MessageWithFlags): boolean {
  const toolMsg = msg as any;
  const content = toolMsg.content;
  if (!content || content === '(executing...)') return true; // pending = show as in progress
  try {
    const parsed = typeof content === 'string' ? JSON.parse(content) : content;
    return parsed.success !== false;
  } catch {
    return true;
  }
}

export default function ToolChips({ toolMessages, readOnly, showThinking }: ToolChipsProps) {
  const [expandedChip, setExpandedChip] = useState<string | null>(null);
  const filesDict = useAppSelector(state => state.files.files);

  // Group messages by chipLabel
  const chipGroups = useMemo(() => {
    const groupMap = new Map<string, ChipGroup>();

    for (const msg of toolMessages) {
      const toolName = getToolName(msg);
      const config = getToolConfig(toolName);
      const key = config.chipLabel;

      if (!groupMap.has(key)) {
        groupMap.set(key, {
          chipLabel: config.chipLabel,
          chipLabelPlural: config.chipLabelPlural,
          chipIcon: config.chipIcon,
          chipColor: config.chipColor,
          messages: [],
        });
      }
      groupMap.get(key)!.messages.push(msg);
    }

    return Array.from(groupMap.values());
  }, [toolMessages]);

  if (chipGroups.length === 0) return null;

  return (
    <VStack gap={1} align="stretch">
      {/* Chip row */}
      <HStack gap={1.5} flexWrap="wrap">
        {chipGroups.map((group) => {
          const isExpanded = expandedChip === group.chipLabel;
          const count = group.messages.length;

          return (
            <Box
              key={group.chipLabel}
              as="button"
              aria-label={`${count} ${count === 1 ? group.chipLabel : group.chipLabelPlural}`}
              onClick={() => setExpandedChip(isExpanded ? null : group.chipLabel)}
              display="flex"
              alignItems="center"
              gap={1.5}
              px={2}
              py={1}
              bg={isExpanded ? 'accent.teal/18' : 'accent.teal/10'}
              borderLeft="2px solid"
              borderColor={isExpanded ? 'accent.teal' : 'accent.teal/40'}
              borderRadius="sm"
              cursor="pointer"
              transition="all 0.2s"
              backdropFilter="blur(4px)"
              _hover={{
                bg: 'accent.teal/18',
                borderColor: 'accent.teal',
                boxShadow: '0 0 8px var(--chakra-colors-accent-teal/15)',
              }}
            >
              <Icon as={group.chipIcon} boxSize={3} color="accent.teal" opacity={0.8} />
              <Text fontSize="xs" fontFamily="mono" color="fg.muted" fontWeight="500">
                <Text as="span" color="accent.teal" fontWeight="700">{count}</Text>
                {' '}{count === 1 ? group.chipLabel : group.chipLabelPlural}
              </Text>
              <Icon
                as={isExpanded ? LuChevronDown : LuChevronRight}
                boxSize={2.5}
                color="accent.teal"
                opacity={0.6}
              />
            </Box>
          );
        })}
      </HStack>

      {/* Expanded details for selected chip */}
      {expandedChip && (() => {
        const group = chipGroups.find(g => g.chipLabel === expandedChip);
        if (!group) return null;

        return (
          <Box
            bg="accent.teal/5"
            borderLeft="2px solid"
            borderColor="accent.teal/30"
            borderRadius="sm"
            px={2}
            py={1.5}
          >
            <VStack gap={0.5} align="stretch">
              {group.messages.map((msg, idx) => {
                const toolMsg = msg as any;
                const success = isSuccess(msg);
                const displayName = getDisplayName(msg);
                const toolName = getToolName(msg);

                // Try to get file name from Redux for EditFile/ReadFiles
                let fileName = displayName;
                if (!fileName && toolMsg.function?.arguments) {
                  try {
                    const args = typeof toolMsg.function.arguments === 'string'
                      ? JSON.parse(toolMsg.function.arguments)
                      : toolMsg.function.arguments;
                    const fileId = args.fileId || args.fileIds?.[0];
                    if (fileId && filesDict[fileId]) {
                      fileName = filesDict[fileId].name || `#${fileId}`;
                    }
                  } catch { /* ignore */ }
                }

                return (
                  <HStack key={`${toolMsg.tool_call_id || idx}`} gap={1.5} py={0.5}>
                    <Icon
                      as={success ? LuCheck : LuX}
                      boxSize={2.5}
                      color={success ? 'accent.teal' : 'accent.danger'}
                      flexShrink={0}
                    />
                    <Text
                      fontSize="xs"
                      fontFamily="mono"
                      color="fg.muted"
                      overflow="hidden"
                      textOverflow="ellipsis"
                      whiteSpace="nowrap"
                    >
                      {fileName || toolName}
                    </Text>
                  </HStack>
                );
              })}
            </VStack>
          </Box>
        );
      })()}
    </VStack>
  );
}
