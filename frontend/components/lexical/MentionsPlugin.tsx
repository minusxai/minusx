import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { useEffect, useState, useCallback, useRef } from 'react';
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
import { createPortal } from 'react-dom';
import { $createMentionNode, MentionData } from './MentionNode';
import { CompletionsAPI } from '@/lib/data/completions/completions';
import { MentionItem } from '@/lib/data/completions/types';
import type { DatabaseWithSchema, SkillMention, SlashCommand } from '@/lib/types';
import {
  MentionOption,
  MentionTrigger,
  ColumnInfo,
  isSlashCommand,
  getFilteredMentions,
  getDropdownTitle,
  getTableColumns,
} from './mentions-plugin-utils';
import { useTableColumns } from '@/lib/hooks/use-table-columns';
import { MentionRow } from './MentionRow';
import { MentionSubmenu } from './MentionSubmenu';

interface MentionsPluginProps {
  databaseName?: string;
  whitelistedSchemas?: DatabaseWithSchema[];
  availableSkills?: SkillMention[];
  availableCommands?: SlashCommand[];
  onCommandExecute?: (command: SlashCommand) => void;
  /**
   * When true, anchor the dropdown at the text caret and drop it below (for
   * in-document editors like docs). Default false keeps the chat-input behavior
   * of anchoring above the input box.
   */
  anchorToCaret?: boolean;
}

export function MentionsPlugin({ databaseName, whitelistedSchemas, availableSkills = [], availableCommands = [], onCommandExecute, anchorToCaret = false }: MentionsPluginProps) {
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

  const filteredMentions = getFilteredMentions(mentions, mentionType);

  // The highlighted table (if any) and its columns — drives the drill-down
  // submenu. Columns come from the whitelisted schemas when present, else are
  // fetched on demand (the bounded schema may have had them stripped).
  const activeOption = filteredMentions[selectedIndex];
  const activeTable = activeOption && !isSlashCommand(activeOption) && activeOption.type === 'table'
    ? (activeOption as MentionItem) : null;
  const activeColumns = useTableColumns(
    showDropdown ? activeTable : null,
    activeTable ? getTableColumns(whitelistedSchemas, activeTable.schema, activeTable.name) : [],
    databaseName,
  );

  useEffect(() => {
    const getActive = () => ({ fm: filteredMentions, table: activeTable, items: activeColumns });

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

        // In the drill-down submenu: insert the highlighted column.
        if (inSubmenu) {
          const item = items[columnIndex];
          if (item && table) {
            event?.preventDefault();
            insertColumn(item, table, triggerLength);
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
  }, [editor, showDropdown, filteredMentions, activeTable, activeColumns, mentionType, query, insertMention, insertColumn, onCommandExecute, inSubmenu, columnIndex]);

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
    return <div ref={anchorRef} className="pointer-events-none absolute top-0 right-0 left-0" />;
  }

  // Drill-down: the highlighted table's columns, if any are known (yet).
  const showSubmenu = !!activeTable && activeColumns.length > 0;

  return (
    <>
      <div ref={anchorRef} className="pointer-events-none absolute top-0 right-0 left-0" />
      {createPortal(
        <div
          data-mx-theme-host=""
          className="fixed z-[1000] flex items-start gap-2"
          style={{
            top: anchorToCaret ? (caretPos ? `${caretPos.top}px` : 0) : (dropdownPos ? `${dropdownPos.top}px` : 0),
            left: anchorToCaret ? (caretPos ? `${caretPos.left}px` : 0) : (dropdownPos ? `${dropdownPos.left}px` : 0),
            transform: anchorToCaret ? undefined : 'translateY(-100%)',
          }}
        >
        <div
          className="max-h-[360px] overflow-hidden rounded-lg border border-border bg-popover shadow-lg"
          style={{
            width: anchorToCaret ? undefined : (dropdownPos ? `${dropdownPos.width}px` : undefined),
            minWidth: anchorToCaret ? '280px' : undefined,
            fontFamily: 'var(--font-jetbrains-mono), monospace',
          }}
        >
          <div
            className="border-b border-border px-3 py-2"
            style={{ background: 'color-mix(in srgb, var(--muted) 50%, transparent)' }}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-bold tracking-[0] text-muted-foreground uppercase">
                {getDropdownTitle(mentionType)}
              </span>
              <span className="text-xs text-muted-foreground">
                {filteredMentions.length}
              </span>
            </div>
          </div>
          <div className="max-h-[312px] overflow-y-auto">
            <div className="flex flex-col items-stretch">
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
                  <MentionRow
                    key={uniqueKey}
                    mention={mention}
                    index={index}
                    isSelected={index === selectedIndex}
                    selectedItemRef={selectedItemRef}
                    isUserSkillHeader={isUserSkillHeader}
                    isSystemSkillHeader={isSystemSkillHeader}
                    onHover={(hoverIndex) => { setSelectedIndex(hoverIndex); setInSubmenu(false); }}
                    onSelect={(selectedMention) => {
                      if (mentionType === 'commands' && isSlashCommand(selectedMention)) {
                        if (!selectedMention.disabled && onCommandExecute) {
                          editor.update(() => {
                            const root = $getRoot();
                            root.clear();
                            root.append($createParagraphNode());
                          });
                          setShowDropdown(false);
                          setQuery('');
                          onCommandExecute(selectedMention);
                        }
                        return;
                      }
                      const triggerLength = (mentionType === 'questions' ? 2 : 1) + query.length;
                      insertMention(selectedMention, triggerLength);
                    }}
                  />
                );
              })}
            </div>
          </div>
        </div>

        {/* Column drill-down submenu for the highlighted table */}
        {showSubmenu && activeTable && (
          <MentionSubmenu
            table={activeTable}
            items={activeColumns}
            inSubmenu={inSubmenu}
            columnIndex={columnIndex}
            onHoverItem={(i) => { setInSubmenu(true); setColumnIndex(i); }}
            onSelectItem={(column) => {
              const triggerLength = (mentionType === 'questions' ? 2 : 1) + query.length;
              insertColumn(column, activeTable, triggerLength);
            }}
          />
        )}
        </div>,
        document.body,
      )}
    </>
  );
}
