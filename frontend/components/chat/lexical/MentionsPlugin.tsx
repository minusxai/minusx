import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  $getSelection,
  $isRangeSelection,
  TextNode,
  $createTextNode,
  COMMAND_PRIORITY_CRITICAL,
  KEY_ARROW_DOWN_COMMAND,
  KEY_ARROW_UP_COMMAND,
  KEY_ENTER_COMMAND,
  KEY_ESCAPE_COMMAND,
} from 'lexical';
import { $createMentionNode, MentionData } from './MentionNode';
import { Box, HStack, VStack, Text, Icon, Portal } from '@chakra-ui/react';
import { CompletionsAPI } from '@/lib/data/completions/completions';
import { MentionItem } from '@/lib/data/completions/types';
import { FILE_TYPE_METADATA, TABLE_MENTION_METADATA, ACCENT_HEX } from '@/lib/ui/file-metadata';
import type { DatabaseWithSchema, SkillMention } from '@/lib/types';

interface MentionsPluginProps {
  databaseName?: string;
  whitelistedSchemas?: DatabaseWithSchema[];
  availableSkills?: SkillMention[];
}

type MentionOption = MentionItem | SkillMention;
type MentionTrigger = 'all' | 'questions' | 'skills';

// Map semantic token to hex value
const colorMap: Record<string, string> = {
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

// Get badge info (color, label, icon) for a mention type
function getMentionBadgeInfo(option: MentionOption) {
  if (option.type === 'skill') {
    return {
      label: 'SKILL',
      icon: null,
      color: ACCENT_HEX.teal,
    };
  }

  const type = option.type;
  if (type === 'table') {
    return {
      label: TABLE_MENTION_METADATA.label,
      icon: TABLE_MENTION_METADATA.icon,
      color: TABLE_MENTION_METADATA.color,
    };
  }

  const metadata = FILE_TYPE_METADATA[type];
  return {
    label: metadata.label.toUpperCase(),
    icon: metadata.icon,
    color: colorMap[metadata.color] || ACCENT_HEX.muted,
  };
}

function getFilteredMentions(mentions: MentionOption[], mentionType: MentionTrigger) {
  const filtered = mentions.filter(m => mentionType === 'questions' ? m.type !== 'table' : true);
  // Sort skills: user skills first, then system
  if (mentionType === 'skills') {
    filtered.sort((a, b) => {
      const aSource = a.type === 'skill' ? a.source : 'system';
      const bSource = b.type === 'skill' ? b.source : 'system';
      if (aSource === bSource) return 0;
      return aSource === 'user' ? -1 : 1;
    });
  }
  return filtered;
}

function getDropdownTitle(mentionType: MentionTrigger) {
  if (mentionType === 'skills') return 'Skills';
  if (mentionType === 'questions') return 'Questions';
  return 'Tables, Questions & Dashboards';
}

function getMentionPrimaryText(mention: MentionOption) {
  return 'display_text' in mention ? mention.display_text : mention.name;
}

function getMentionMetaText(mention: MentionOption) {
  if (mention.type === 'table' && 'schema' in mention && mention.schema) {
    return mention.schema;
  }
  if (mention.type === 'skill') {
    return mention.description;
  }
  return undefined;
}

export function MentionsPlugin({ databaseName, whitelistedSchemas, availableSkills = [] }: MentionsPluginProps) {
  const [editor] = useLexicalComposerContext();
  const [mentions, setMentions] = useState<MentionOption[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [mentionType, setMentionType] = useState<MentionTrigger>('all');
  const [query, setQuery] = useState('');
  const selectedItemRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<HTMLDivElement>(null);
  const requestIdRef = useRef(0);

  const fetchMentions = useCallback(async (prefix: string, type: 'all' | 'questions') => {
    // Increment request ID to track latest request
    requestIdRef.current += 1;
    const currentRequestId = requestIdRef.current;

    try {
      const result = await CompletionsAPI.getMentions({
        prefix,
        mentionType: type,
        databaseName,
        whitelistedSchemas
      });

      // Only update if this is still the latest request
      if (currentRequestId === requestIdRef.current) {
        setMentions(result.suggestions);
        setSelectedIndex(0);
      }
    } catch (error) {
      console.error('Failed to fetch mentions:', error);
      // Only clear if this is still the latest request
      if (currentRequestId === requestIdRef.current) {
        setMentions([]);
      }
    }
  }, [databaseName, whitelistedSchemas]);

  const insertMention = useCallback((mention: MentionOption, triggerLength: number) => {
    editor.update(() => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection)) return;

      const anchor = selection.anchor;
      const anchorNode = anchor.getNode();

      if (!(anchorNode instanceof TextNode)) return;

      // Remove the trigger text (@... or @@...)
      const offset = anchor.offset;
      const text = anchorNode.getTextContent();
      const newText = text.slice(0, offset - triggerLength) + text.slice(offset);
      anchorNode.setTextContent(newText);

      // Move cursor to where @ started
      anchorNode.select(offset - triggerLength, offset - triggerLength);

      // Create mention data (only include non-null fields)
      const mentionData: MentionData = {
        type: mention.type,
        name: mention.name,
      };
      if ('schema' in mention && mention.schema) mentionData.schema = mention.schema;
      if (mention.type === 'skill') mentionData.source = mention.source;
      if (mention.id != null) mentionData.id = mention.id;

      // Create mention node
      const mentionNode = $createMentionNode(mentionData);

      // Insert mention and add space after
      const newSelection = $getSelection();
      if ($isRangeSelection(newSelection)) {
        newSelection.insertNodes([mentionNode, $createTextNode(' ')]);
      }
    });

    setShowDropdown(false);
    setQuery('');
  }, [editor]);

  useEffect(() => {
    // Monitor text changes to detect @ and / triggers
    return editor.registerUpdateListener(({ editorState }) => {
      editorState.read(() => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection)) {
          setShowDropdown(false);
          return;
        }

        const anchor = selection.anchor;
        const anchorNode = anchor.getNode();

        if (!(anchorNode instanceof TextNode)) {
          setShowDropdown(false);
          return;
        }

        const text = anchorNode.getTextContent();
        const offset = anchor.offset;
        const textBeforeCursor = text.slice(0, offset);

        // Check for @@ (questions only)
        const doubleAtMatch = textBeforeCursor.match(/@@([\w_]*)$/);
        if (doubleAtMatch) {
          setMentionType('questions');
          setQuery(doubleAtMatch[1]);
          setShowDropdown(true);
          fetchMentions(doubleAtMatch[1], 'questions');
          return;
        }

        // Check for @ (all) - use negative lookbehind to not match second @ in @@
        const singleAtMatch = textBeforeCursor.match(/(?<!@)@([\w.]*)$/);
        if (singleAtMatch) {
          setMentionType('all');
          setQuery(singleAtMatch[1]);
          setShowDropdown(true);
          fetchMentions(singleAtMatch[1], 'all');
          return;
        }

        const slashMatch = textBeforeCursor.match(/\/([\w-]*)$/);
        if (slashMatch) {
          const nextQuery = slashMatch[1].toLowerCase();
          const seen = new Set<string>();
          setMentionType('skills');
          setQuery(slashMatch[1]);
          setMentions(
            availableSkills
              .filter(skill => skill.name.toLowerCase().includes(nextQuery))
              .filter(skill => {
                const key = `${skill.source}:${skill.name}`;
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
              })
              .slice(0, 8)
          );
          setSelectedIndex(0);
          setShowDropdown(true);
          return;
        }

        setShowDropdown(false);
      });
    });
  }, [editor, fetchMentions, availableSkills]);

  useEffect(() => {
    // Scroll selected item into view
    if (selectedItemRef.current) {
      selectedItemRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [selectedIndex]);

  useEffect(() => {
    // Register keyboard commands for dropdown navigation
    const removeArrowDown = editor.registerCommand(
      KEY_ARROW_DOWN_COMMAND,
      (event) => {
        const filteredMentions = getFilteredMentions(mentions, mentionType);
        if (showDropdown && filteredMentions.length > 0) {
          if (event) {
            event.preventDefault();
          }
          setSelectedIndex((prev) => (prev + 1) % filteredMentions.length);
          return true;
        }
        return false;
      },
      COMMAND_PRIORITY_CRITICAL
    );

    const removeArrowUp = editor.registerCommand(
      KEY_ARROW_UP_COMMAND,
      (event) => {
        const filteredMentions = getFilteredMentions(mentions, mentionType);
        if (showDropdown && filteredMentions.length > 0) {
          if (event) {
            event.preventDefault();
          }
          setSelectedIndex((prev) => (prev - 1 + filteredMentions.length) % filteredMentions.length);
          return true;
        }
        return false;
      },
      COMMAND_PRIORITY_CRITICAL
    );

    const removeEnter = editor.registerCommand(
      KEY_ENTER_COMMAND,
      (event) => {
        const filteredMentions = getFilteredMentions(mentions, mentionType);
        if (showDropdown && filteredMentions.length > 0) {
          if (filteredMentions[selectedIndex]) {
            // Prevent default Enter behavior (newline)
            if (event) {
              event.preventDefault();
            }
            // Calculate trigger length: @ or @@ plus query length
            const triggerLength = (mentionType === 'questions' ? 2 : 1) + query.length;
            insertMention(filteredMentions[selectedIndex], triggerLength);
            return true;
          }
        }
        return false;
      },
      COMMAND_PRIORITY_CRITICAL
    );

    const removeEscape = editor.registerCommand(
      KEY_ESCAPE_COMMAND,
      () => {
        if (showDropdown) {
          setShowDropdown(false);
          return true;
        }
        return false;
      },
      COMMAND_PRIORITY_CRITICAL
    );

    return () => {
      removeArrowDown();
      removeArrowUp();
      removeEnter();
      removeEscape();
    };
  }, [editor, showDropdown, mentions, selectedIndex, mentionType, query, insertMention]);

  const filteredMentions = getFilteredMentions(mentions, mentionType);

  // Reset selectedIndex if it's out of bounds after filtering — intentional setState in effect
  useEffect(() => {
    if (selectedIndex >= filteredMentions.length && filteredMentions.length > 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelectedIndex(0);
    }
  }, [filteredMentions.length, selectedIndex]);

  // Track dropdown position in state, updated via effect
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number; width: number } | null>(null);

  useEffect(() => {
    if (!showDropdown || filteredMentions.length === 0) return;
    const el = anchorRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDropdownPos({ top: rect.top - 4, left: rect.left, width: rect.width });
  }, [showDropdown, filteredMentions.length]);

  if (!showDropdown || filteredMentions.length === 0) {
    return <Box ref={anchorRef} position="absolute" top={0} left={0} right={0} pointerEvents="none" />;
  }

  return (
    <>
      <Box ref={anchorRef} position="absolute" top={0} left={0} right={0} pointerEvents="none" />
      <Portal>
        <Box
          position="fixed"
          top={dropdownPos ? `${dropdownPos.top}px` : 0}
          left={dropdownPos ? `${dropdownPos.left}px` : 0}
          width={dropdownPos ? `${dropdownPos.width}px` : undefined}
          transform="translateY(-100%)"
          bg="bg.panel"
          border="1px solid"
          borderColor="border.default"
          borderRadius="lg"
          boxShadow="lg"
          maxH="360px"
          overflow="hidden"
          zIndex={1000}
          fontFamily="mono"
        >
          <Box
            px={3}
            py={2}
            borderBottom="1px solid"
            borderColor="border.muted"
            bg="bg.subtle"
          >
            <HStack justify="space-between" gap={2}>
              <Text fontSize="xs" fontWeight="700" color="fg.muted" textTransform="uppercase" letterSpacing="0">
                {getDropdownTitle(mentionType)}
              </Text>
              <Text fontSize="xs" color="fg.subtle" fontFamily="mono">
                {filteredMentions.length}
              </Text>
            </HStack>
          </Box>
          <Box maxH="312px" overflowY="auto">
            <VStack align="stretch" gap={0}>
              {filteredMentions.map((mention, index) => {
                // Generate unique key including schema for tables
                const uniqueKey = mention.type === 'table' && 'schema' in mention && mention.schema
                  ? `${mention.type}-${mention.schema}-${mention.name}`
                  : mention.type === 'skill'
                    ? `${mention.type}-${mention.source}-${mention.name}`
                  : `${mention.type}-${mention.id || mention.name}`;

                // Show group headers for user/system skill sections
                const prevMention = index > 0 ? filteredMentions[index - 1] : null;
                const isUserSkillHeader = mentionType === 'skills'
                  && mention.type === 'skill' && mention.source === 'user' && index === 0;
                const isSystemSkillHeader = mentionType === 'skills'
                  && mention.type === 'skill' && mention.source === 'system'
                  && (index === 0 || (prevMention?.type === 'skill' && prevMention.source === 'user'));

                return (
                <React.Fragment key={uniqueKey}>
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
                  key={uniqueKey}
                  ref={index === selectedIndex ? selectedItemRef : null}
                  px={3}
                  py={2.5}
                  cursor="pointer"
                  bg={index === selectedIndex ? 'bg.muted' : 'transparent'}
                  borderBottom="1px solid"
                  borderColor="border.muted"
                  _last={{ borderBottom: 'none' }}
                  _hover={{ bg: 'bg.muted' }}
                  onClick={() => {
                    const triggerLength = (mentionType === 'questions' ? 2 : 1) + query.length;
                    insertMention(mention, triggerLength);
                  }}
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
                            {mention.type === 'table' && meta && (
                              <Text fontSize="xs" color="fg.subtle" flexShrink={0}>
                                {meta}
                              </Text>
                            )}
                          </HStack>
                          {mention.type === 'skill' && meta && (
                            <Text fontSize="xs" color="fg.muted" lineClamp={2}>
                              {meta}
                            </Text>
                          )}
                        </VStack>
                      </HStack>
                    );
                  })()}
                </Box>
                </React.Fragment>
                );
              })}
            </VStack>
          </Box>
        </Box>
      </Portal>
    </>
  );
}
