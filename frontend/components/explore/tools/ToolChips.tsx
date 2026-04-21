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
  chipIcon: React.ComponentType;
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
          chipIcon: config.chipIcon,
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
          const failCount = group.messages.filter(m => !isSuccess(m)).length;

          return (
            <Box
              key={group.chipLabel}
              as="button"
              aria-label={`${count} ${group.chipLabel}`}
              onClick={() => setExpandedChip(isExpanded ? null : group.chipLabel)}
              display="flex"
              alignItems="center"
              gap={1}
              px={2}
              py={0.5}
              bg={isExpanded ? 'bg.muted' : 'bg.subtle'}
              border="1px solid"
              borderColor={isExpanded ? 'border.emphasized' : 'border.default'}
              borderRadius="full"
              cursor="pointer"
              transition="all 0.15s"
              _hover={{ bg: 'bg.muted', borderColor: 'border.emphasized' }}
            >
              <Icon as={group.chipIcon} boxSize={3} color="fg.muted" />
              <Text fontSize="xs" fontFamily="mono" color="fg.muted" fontWeight="500">
                {count} {group.chipLabel}
              </Text>
              {failCount > 0 && (
                <Text fontSize="2xs" color="accent.danger">
                  ({failCount} failed)
                </Text>
              )}
              <Icon
                as={isExpanded ? LuChevronDown : LuChevronRight}
                boxSize={2.5}
                color="fg.subtle"
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
            bg="bg.subtle"
            border="1px solid"
            borderColor="border.default"
            borderRadius="md"
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
                      color={success ? 'accent.success' : 'accent.danger'}
                      flexShrink={0}
                    />
                    <Text
                      fontSize="xs"
                      fontFamily="mono"
                      color="fg.default"
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
