'use client';

import { useState, useMemo } from 'react';
import { VStack, HStack, Box, Text, Icon } from '@chakra-ui/react';
import { LuChevronDown, LuChevronRight, LuCheck, LuX } from 'react-icons/lu';
import type { MessageWithFlags } from '../message/messageHelpers';
import { getToolConfig } from '@/lib/api/tool-config';
import { useAppSelector } from '@/store/hooks';

interface ActivityRailProps {
  toolMessages: MessageWithFlags[];
  readOnly: boolean;
  showThinking: boolean;
}

interface RailGroup {
  chipLabel: string;
  chipIcon: React.ComponentType;
  messages: MessageWithFlags[];
}

function getToolName(msg: MessageWithFlags): string {
  if (msg.role !== 'tool') return '';
  return (msg as any).function?.name || '';
}

function getDisplayName(msg: MessageWithFlags, filesDict: Record<number, any>): string {
  const toolMsg = msg as any;
  const args = toolMsg.function?.arguments;
  let parsed: any = {};
  try {
    parsed = typeof args === 'string' ? JSON.parse(args) : args || {};
  } catch { /* ignore */ }

  // Try file name from Redux
  const fileId = parsed.fileId || parsed.fileIds?.[0];
  if (fileId && filesDict[fileId]) {
    return filesDict[fileId].name || `#${fileId}`;
  }

  return parsed.name || parsed.query || parsed.file_type || getToolName(msg);
}

function isSuccess(msg: MessageWithFlags): boolean {
  const toolMsg = msg as any;
  const content = toolMsg.content;
  if (!content || content === '(executing...)') return true;
  try {
    const parsed = typeof content === 'string' ? JSON.parse(content) : content;
    return parsed.success !== false;
  } catch {
    return true;
  }
}

export default function ActivityRail({ toolMessages, readOnly, showThinking }: ActivityRailProps) {
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);
  const filesDict = useAppSelector(state => state.files.files);

  const railGroups = useMemo(() => {
    const groupMap = new Map<string, RailGroup>();

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

  if (railGroups.length === 0) return null;

  return (
    <VStack gap={1} align="stretch" py={1}>
      {railGroups.map((group) => {
        const isExpanded = expandedGroup === group.chipLabel;
        const count = group.messages.length;

        return (
          <Box key={group.chipLabel}>
            {/* Badge */}
            <Box
              as="button"
              aria-label={`${count} ${group.chipLabel}`}
              onClick={() => setExpandedGroup(isExpanded ? null : group.chipLabel)}
              display="flex"
              flexDirection="column"
              alignItems="center"
              gap={0}
              py={1}
              px={1}
              w="100%"
              borderRadius="md"
              cursor="pointer"
              transition="all 0.15s"
              bg={isExpanded ? 'bg.muted' : 'transparent'}
              _hover={{ bg: 'bg.muted' }}
            >
              <Icon as={group.chipIcon} boxSize={3.5} color="fg.muted" />
              <Text fontSize="2xs" fontFamily="mono" color="fg.subtle" fontWeight="500">
                {count > 1 ? `×${count}` : ''}
              </Text>
            </Box>

            {/* Expanded popover-like detail */}
            {isExpanded && (
              <Box
                position="absolute"
                left="100%"
                ml={1}
                mt={-8}
                bg="bg.default"
                border="1px solid"
                borderColor="border.default"
                borderRadius="md"
                px={2}
                py={1.5}
                minW="200px"
                maxW="300px"
                zIndex={10}
                boxShadow="md"
              >
                <Text fontSize="2xs" fontFamily="mono" color="fg.subtle" mb={1} fontWeight="600" textTransform="uppercase">
                  {count} {group.chipLabel}
                </Text>
                <VStack gap={0.5} align="stretch">
                  {group.messages.slice(0, 10).map((msg, idx) => {
                    const toolMsg = msg as any;
                    const success = isSuccess(msg);
                    const name = getDisplayName(msg, filesDict);

                    return (
                      <HStack key={toolMsg.tool_call_id || idx} gap={1.5} py={0.5}>
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
                          {name}
                        </Text>
                      </HStack>
                    );
                  })}
                  {group.messages.length > 10 && (
                    <Text fontSize="2xs" color="fg.subtle" fontFamily="mono">
                      ...and {group.messages.length - 10} more
                    </Text>
                  )}
                </VStack>
              </Box>
            )}
          </Box>
        );
      })}
    </VStack>
  );
}
