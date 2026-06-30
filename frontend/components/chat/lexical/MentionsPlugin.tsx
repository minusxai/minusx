import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  $getRoot,
  $getSelection,
  $isRangeSelection,
  $createParagraphNode,
  TextNode,
  $createTextNode,
  COMMAND_PRIORITY_CRITICAL,
  KEY_ARROW_DOWN_COMMAND,
  KEY_ARROW_UP_COMMAND,
  KEY_ARROW_LEFT_COMMAND,
  KEY_ARROW_RIGHT_COMMAND,
  KEY_ENTER_COMMAND,
  KEY_ESCAPE_COMMAND,
} from 'lexical';
import { $createMentionNode, MentionData } from './MentionNode';
import { Box, HStack, VStack, Text, Icon, Portal } from '@chakra-ui/react';
import { CompletionsAPI } from '@/lib/data/completions/completions';
import { MentionItem } from '@/lib/data/completions/types';
import { FILE_TYPE_METADATA, TABLE_MENTION_METADATA, COLUMN_MENTION_METADATA, METRIC_MENTION_METADATA, ACCENT_HEX } from '@/lib/ui/file-metadata';
import type { DatabaseWithSchema, MetricDef, SkillMention, SlashCommand } from '@/lib/types';
import { LuTerminal, LuChevronRight } from 'react-icons/lu';

interface MentionsPluginProps {
  databaseName?: string;
  whitelistedSchemas?: DatabaseWithSchema[];
  availableSkills?: SkillMention[];
  availableCommands?: SlashCommand[];
  onCommandExecute?: (command: SlashCommand) => void;
  /** Context metrics — surfaced in a table's column drill-down. */
  metrics?: MetricDef[];
  /**
   * When true, anchor the dropdown at the text caret and drop it below (for
   * in-document editors like docs). Default false keeps the chat-input behavior
   * of anchoring above the input box.
   */
  anchorToCaret?: boolean;
}

type MentionOption = MentionItem | SkillMention | SlashCommand;
type MentionTrigger = 'all' | 'questions' | 'skills' | 'commands';

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

function isSlashCommand(option: MentionOption): option is SlashCommand {
  return option.type === 'command';
}

// Get badge info (color, label, icon) for a mention type
function getMentionBadgeInfo(option: MentionOption) {
  if (isSlashCommand(option)) {
    return {
      label: 'CMD',
      icon: LuTerminal,
      color: ACCENT_HEX.info,
    };
  }

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
  if (mentionType === 'commands') return 'Commands';
  if (mentionType === 'skills') return 'Skills';
  if (mentionType === 'questions') return 'Questions';
  return 'Tables, Questions & Dashboards';
}

interface ColumnInfo { name: string; type: string }

/** Look up a table's columns from the whitelisted schemas (client-side, no API). */
function getTableColumns(
  whitelistedSchemas: DatabaseWithSchema[] | undefined,
  schema: string | undefined,
  table: string,
): ColumnInfo[] {
  if (!whitelistedSchemas) return [];
  for (const db of whitelistedSchemas) {
    for (const s of db.schemas) {
      if (schema && s.schema !== schema) continue;
      for (const t of s.tables) {
        if (t.table === table) return t.columns ?? [];
      }
    }
  }
  return [];
}

/** Metrics attached to a given table. */
function getTableMetrics(metrics: MetricDef[] | undefined, schema: string | undefined, table: string): MetricDef[] {
  if (!metrics) return [];
  return metrics.filter((m) => m.table === table && (!schema || !m.schema || m.schema === schema));
}

type SubItem = { kind: 'metric'; metric: MetricDef } | { kind: 'column'; column: ColumnInfo };

/** The combined drill-down items for a table: its metrics first, then its columns. */
function getSubmenuItems(
  table: MentionItem,
  whitelistedSchemas: DatabaseWithSchema[] | undefined,
  metrics: MetricDef[] | undefined,
): SubItem[] {
  const ms: SubItem[] = getTableMetrics(metrics, table.schema, table.name).map((m) => ({ kind: 'metric', metric: m }));
  const cs: SubItem[] = getTableColumns(whitelistedSchemas, table.schema, table.name).map((c) => ({ kind: 'column', column: c }));
  return [...ms, ...cs];
}

function getMentionPrimaryText(mention: MentionOption) {
  if (isSlashCommand(mention)) return mention.label;
  return 'display_text' in mention ? mention.display_text : mention.name;
}

function getMentionMetaText(mention: MentionOption) {
  if (isSlashCommand(mention)) return mention.description;
  if (mention.type === 'table' && 'schema' in mention && mention.schema) {
    return mention.schema;
  }
  if (mention.type === 'skill') {
    return mention.description;
  }
  return undefined;
}

export function MentionsPlugin({ databaseName, whitelistedSchemas, availableSkills = [], availableCommands = [], onCommandExecute, metrics, anchorToCaret = false }: MentionsPluginProps) {
  const [editor] = useLexicalComposerContext();
  const [mentions, setMentions] = useState<MentionOption[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [mentionType, setMentionType] = useState<MentionTrigger>('all');
  const [query, setQuery] = useState('');
  // Column drill-down submenu (for table mentions that have known columns).
  const [inSubmenu, setInSubmenu] = useState(false);
  const [columnIndex, setColumnIndex] = useState(0);
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
        setInSubmenu(false);
      }
    } catch (error) {
      console.error('Failed to fetch mentions:', error);
      // Only clear if this is still the latest request
      if (currentRequestId === requestIdRef.current) {
        setMentions([]);
      }
    }
  }, [databaseName, whitelistedSchemas]);

  // Core: remove the trigger text and insert a mention node for the given data.
  const insertMentionData = useCallback((mentionData: MentionData, triggerLength: number) => {
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

      // Create mention node
      const mentionNode = $createMentionNode(mentionData);

      // Insert mention and add space after
      const newSelection = $getSelection();
      if ($isRangeSelection(newSelection)) {
        newSelection.insertNodes([mentionNode, $createTextNode(' ')]);
      }
    });

    setShowDropdown(false);
    setInSubmenu(false);
    setQuery('');
  }, [editor]);

  const insertMention = useCallback((mention: MentionOption, triggerLength: number) => {
    if (isSlashCommand(mention)) return; // Commands are executed, not inserted
    const mentionData: MentionData = { type: mention.type, name: mention.name };
    if ('schema' in mention && mention.schema) mentionData.schema = mention.schema;
    if ('connection' in mention && mention.connection) mentionData.connection = mention.connection;
    if (mention.type === 'skill') mentionData.source = mention.source;
    if (mention.id != null) mentionData.id = mention.id;
    insertMentionData(mentionData, triggerLength);
  }, [insertMentionData]);

  // Insert a column mention drilled into from a table row.
  const insertColumn = useCallback((column: ColumnInfo, table: MentionItem, triggerLength: number) => {
    const mentionData: MentionData = { type: 'column', name: column.name, table: table.name };
    if (table.schema) mentionData.schema = table.schema;
    if (table.connection) mentionData.connection = table.connection;
    insertMentionData(mentionData, triggerLength);
  }, [insertMentionData]);

  // Insert a metric mention drilled into from a table row.
  const insertMetric = useCallback((metric: MetricDef, table: MentionItem, triggerLength: number) => {
    const mentionData: MentionData = { type: 'metric', name: metric.name, table: table.name };
    if (table.schema) mentionData.schema = table.schema;
    if (table.connection) mentionData.connection = table.connection;
    insertMentionData(mentionData, triggerLength);
  }, [insertMentionData]);

  // Insert the selected drill-down item (metric or column).
  const insertSubItem = useCallback((item: SubItem, table: MentionItem, triggerLength: number) => {
    if (item.kind === 'metric') insertMetric(item.metric, table, triggerLength);
    else insertColumn(item.column, table, triggerLength);
  }, [insertMetric, insertColumn]);

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

        const hashMatch = textBeforeCursor.match(/#([\w-]*)$/);
        if (hashMatch) {
          const nextQuery = hashMatch[1].toLowerCase();
          const seen = new Set<string>();
          setMentionType('skills');
          setQuery(hashMatch[1]);
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

        // Check for / (commands) — only at start of input
        const slashMatch = textBeforeCursor.match(/^\/([\w-]*)$/);
        if (slashMatch && availableCommands.length > 0) {
          const cmdQuery = slashMatch[1].toLowerCase();
          setMentionType('commands');
          setQuery(slashMatch[1]);
          setMentions(
            availableCommands.filter(cmd => cmd.name.toLowerCase().includes(cmdQuery))
          );
          setSelectedIndex(0);
          setShowDropdown(true);
          return;
        }

        setShowDropdown(false);
      });
    });
  }, [editor, fetchMentions, availableSkills, availableCommands]);

  useEffect(() => {
    // Scroll selected item into view
    if (selectedItemRef.current) {
      selectedItemRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [selectedIndex]);

  useEffect(() => {
    // The active table's columns (empty unless the highlighted item is a table
    // with known columns) — drives the column drill-down submenu.
    const getActive = () => {
      const fm = getFilteredMentions(mentions, mentionType);
      const sel = fm[selectedIndex];
      if (sel && !isSlashCommand(sel) && sel.type === 'table') {
        const table = sel as MentionItem;
        return { fm, table, items: getSubmenuItems(table, whitelistedSchemas, metrics) };
      }
      return { fm, table: null as MentionItem | null, items: [] as SubItem[] };
    };

    // Register keyboard commands for dropdown navigation
    const removeArrowDown = editor.registerCommand(
      KEY_ARROW_DOWN_COMMAND,
      (event) => {
        const { fm, items } = getActive();
        if (!showDropdown || fm.length === 0) return false;
        event?.preventDefault();
        if (inSubmenu && items.length > 0) {
          setColumnIndex((prev) => (prev + 1) % items.length);
        } else {
          setSelectedIndex((prev) => (prev + 1) % fm.length);
        }
        return true;
      },
      COMMAND_PRIORITY_CRITICAL
    );

    const removeArrowUp = editor.registerCommand(
      KEY_ARROW_UP_COMMAND,
      (event) => {
        const { fm, items } = getActive();
        if (!showDropdown || fm.length === 0) return false;
        event?.preventDefault();
        if (inSubmenu && items.length > 0) {
          setColumnIndex((prev) => (prev - 1 + items.length) % items.length);
        } else {
          setSelectedIndex((prev) => (prev - 1 + fm.length) % fm.length);
        }
        return true;
      },
      COMMAND_PRIORITY_CRITICAL
    );

    // ArrowRight enters the table's drill-down submenu (metrics + columns).
    const removeArrowRight = editor.registerCommand(
      KEY_ARROW_RIGHT_COMMAND,
      (event) => {
        if (!showDropdown || inSubmenu) return false;
        const { items } = getActive();
        if (items.length === 0) return false;
        event?.preventDefault();
        setInSubmenu(true);
        setColumnIndex(0);
        return true;
      },
      COMMAND_PRIORITY_CRITICAL
    );

    // ArrowLeft exits the column submenu back to the table list.
    const removeArrowLeft = editor.registerCommand(
      KEY_ARROW_LEFT_COMMAND,
      (event) => {
        if (!showDropdown || !inSubmenu) return false;
        event?.preventDefault();
        setInSubmenu(false);
        return true;
      },
      COMMAND_PRIORITY_CRITICAL
    );

    const removeEnter = editor.registerCommand(
      KEY_ENTER_COMMAND,
      (event) => {
        const { fm, table, items } = getActive();
        if (!showDropdown || fm.length === 0) return false;
        const triggerLength = (mentionType === 'questions' ? 2 : 1) + query.length;

        // In the drill-down submenu: insert the highlighted metric or column.
        if (inSubmenu) {
          const item = items[columnIndex];
          if (item && table) {
            event?.preventDefault();
            insertSubItem(item, table, triggerLength);
            return true;
          }
          return false;
        }

        const selected = fm[selectedIndex];
        if (selected) {
          event?.preventDefault();
          // Commands: execute and clear editor instead of inserting
          if (mentionType === 'commands' && isSlashCommand(selected)) {
            if (!selected.disabled && onCommandExecute) {
              editor.update(() => {
                const root = $getRoot();
                root.clear();
                root.append($createParagraphNode());
              });
              setShowDropdown(false);
              setQuery('');
              onCommandExecute(selected);
            }
            return true;
          }
          insertMention(selected, triggerLength);
          return true;
        }
        return false;
      },
      COMMAND_PRIORITY_CRITICAL
    );

    const removeEscape = editor.registerCommand(
      KEY_ESCAPE_COMMAND,
      () => {
        if (inSubmenu) {
          setInSubmenu(false);
          return true;
        }
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
      removeArrowRight();
      removeArrowLeft();
      removeEnter();
      removeEscape();
    };
  }, [editor, showDropdown, mentions, selectedIndex, mentionType, query, insertMention, insertSubItem, onCommandExecute, inSubmenu, columnIndex, whitelistedSchemas, metrics]);

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
  // Caret-anchored position (docs editors) — recomputed as the query/caret moves.
  const [caretPos, setCaretPos] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    if (!showDropdown || filteredMentions.length === 0) return;
    if (anchorToCaret) {
      const domSel = window.getSelection();
      if (domSel && domSel.rangeCount > 0) {
        const rect = domSel.getRangeAt(0).getBoundingClientRect();
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setCaretPos({ top: rect.bottom + 4, left: rect.left });
      }
      return;
    }
    const el = anchorRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();

    setDropdownPos({ top: rect.top - 4, left: rect.left, width: rect.width });
  }, [showDropdown, filteredMentions.length, anchorToCaret, query]);

  if (!showDropdown || filteredMentions.length === 0) {
    return <Box ref={anchorRef} position="absolute" top={0} left={0} right={0} pointerEvents="none" />;
  }

  // Drill-down: the highlighted table's metrics + columns, if any are known.
  const activeMention = filteredMentions[selectedIndex];
  const activeTable = activeMention && !isSlashCommand(activeMention) && activeMention.type === 'table'
    ? (activeMention as MentionItem) : null;
  const activeItems = activeTable ? getSubmenuItems(activeTable, whitelistedSchemas, metrics) : [];
  const showSubmenu = !!activeTable && activeItems.length > 0;

  return (
    <>
      <Box ref={anchorRef} position="absolute" top={0} left={0} right={0} pointerEvents="none" />
      <Portal>
        <Box
          position="fixed"
          top={anchorToCaret ? (caretPos ? `${caretPos.top}px` : 0) : (dropdownPos ? `${dropdownPos.top}px` : 0)}
          left={anchorToCaret ? (caretPos ? `${caretPos.left}px` : 0) : (dropdownPos ? `${dropdownPos.left}px` : 0)}
          transform={anchorToCaret ? undefined : 'translateY(-100%)'}
          zIndex={1000}
          display="flex"
          alignItems="flex-start"
          gap={2}
        >
        <Box
          width={anchorToCaret ? undefined : (dropdownPos ? `${dropdownPos.width}px` : undefined)}
          minW={anchorToCaret ? '280px' : undefined}
          bg="bg.panel"
          border="1px solid"
          borderColor="border.default"
          borderRadius="lg"
          boxShadow="lg"
          maxH="360px"
          overflow="hidden"
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
                const uniqueKey = isSlashCommand(mention)
                  ? `cmd-${mention.name}`
                  : mention.type === 'table' && 'schema' in mention && mention.schema
                  ? `${mention.type}-${mention.schema}-${mention.name}`
                  : mention.type === 'skill'
                    ? `${mention.type}-${mention.source}-${mention.name}`
                  : `${mention.type}-${mention.id || mention.name}`;

                // Show group headers for user/system skill sections
                const prevMention = index > 0 ? filteredMentions[index - 1] : null;
                const isUserSkillHeader = mentionType === 'skills'
                  && !isSlashCommand(mention) && mention.type === 'skill' && mention.source === 'user' && index === 0;
                const isSystemSkillHeader = mentionType === 'skills'
                  && !isSlashCommand(mention) && mention.type === 'skill' && mention.source === 'system'
                  && (index === 0 || (prevMention && !isSlashCommand(prevMention) && prevMention.type === 'skill' && prevMention.source === 'user'));

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
                  cursor={isSlashCommand(mention) && mention.disabled ? 'not-allowed' : 'pointer'}
                  opacity={isSlashCommand(mention) && mention.disabled ? 0.4 : 1}
                  bg={index === selectedIndex ? 'bg.muted' : 'transparent'}
                  borderBottom="1px solid"
                  borderColor="border.muted"
                  _last={{ borderBottom: 'none' }}
                  _hover={isSlashCommand(mention) && mention.disabled ? {} : { bg: 'bg.muted' }}
                  onMouseEnter={() => { setSelectedIndex(index); setInSubmenu(false); }}
                  onClick={() => {
                    if (mentionType === 'commands' && isSlashCommand(mention)) {
                      if (!mention.disabled && onCommandExecute) {
                        editor.update(() => {
                          const root = $getRoot();
                          root.clear();
                          root.append($createParagraphNode());
                        });
                        setShowDropdown(false);
                        setQuery('');
                        onCommandExecute(mention);
                      }
                      return;
                    }
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
                        {!isSlashCommand(mention) && mention.type === 'table'
                          && getSubmenuItems(mention as MentionItem, whitelistedSchemas, metrics).length > 0 && (
                          <Icon as={LuChevronRight} boxSize={3.5} color="fg.subtle" flexShrink={0} alignSelf="center" />
                        )}
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

        {/* Drill-down submenu (metrics + columns) for the highlighted table */}
        {showSubmenu && activeTable && (
          <Box
            minW="210px"
            maxW="300px"
            bg="bg.panel"
            border="1px solid"
            borderColor={inSubmenu ? 'accent.secondary' : 'border.default'}
            borderRadius="lg"
            boxShadow="lg"
            maxH="360px"
            overflow="hidden"
            fontFamily="mono"
          >
            <Box px={3} py={2} borderBottom="1px solid" borderColor="border.muted" bg="bg.subtle">
              <Text fontSize="xs" fontWeight="700" color="fg.muted" textTransform="uppercase" letterSpacing="0" truncate>
                {activeTable.name}
              </Text>
            </Box>
            <Box maxH="312px" overflowY="auto">
              <VStack align="stretch" gap={0}>
                {activeItems.map((item, i) => {
                  const prevKind = i > 0 ? activeItems[i - 1].kind : null;
                  const showHeader = prevKind !== item.kind;
                  const isMetric = item.kind === 'metric';
                  const label = isMetric ? item.metric.name : item.column.name;
                  return (
                    <React.Fragment key={`${item.kind}-${label}-${i}`}>
                      {showHeader && (
                        <Box px={3} py={1} bg="bg.subtle" borderBottom="1px solid" borderColor="border.muted">
                          <Text fontSize="2xs" fontWeight="700" color="fg.subtle" textTransform="uppercase" letterSpacing="0.02em">
                            {isMetric ? 'Metrics' : 'Columns'}
                          </Text>
                        </Box>
                      )}
                      <HStack
                        aria-label={`Insert ${item.kind} ${label}`}
                        px={3}
                        py={2}
                        gap={2}
                        justify="space-between"
                        cursor="pointer"
                        bg={inSubmenu && i === columnIndex ? 'bg.muted' : 'transparent'}
                        _hover={{ bg: 'bg.muted' }}
                        borderBottom="1px solid"
                        borderColor="border.muted"
                        _last={{ borderBottom: 'none' }}
                        onMouseEnter={() => { setInSubmenu(true); setColumnIndex(i); }}
                        onClick={() => {
                          const triggerLength = (mentionType === 'questions' ? 2 : 1) + query.length;
                          insertSubItem(item, activeTable, triggerLength);
                        }}
                      >
                        <HStack gap={1.5} minW={0}>
                          <Icon
                            as={isMetric ? METRIC_MENTION_METADATA.icon : COLUMN_MENTION_METADATA.icon}
                            boxSize={3}
                            color={isMetric ? METRIC_MENTION_METADATA.color : COLUMN_MENTION_METADATA.color}
                            flexShrink={0}
                          />
                          <Text fontSize="sm" fontWeight="600" color="fg.default" truncate>{label}</Text>
                        </HStack>
                        <Text fontSize="2xs" color="fg.subtle" flexShrink={0}>
                          {isMetric ? 'metric' : item.column.type}
                        </Text>
                      </HStack>
                    </React.Fragment>
                  );
                })}
              </VStack>
            </Box>
          </Box>
        )}
        </Box>
      </Portal>
    </>
  );
}
