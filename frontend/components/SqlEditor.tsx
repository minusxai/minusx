'use client';

import { useAppSelector } from '@/store/hooks';
import Editor, { DiffEditor } from '@monaco-editor/react';
import { Box, IconButton, VStack, HStack } from '@chakra-ui/react';
import { LuAlignLeft, LuPlay } from 'react-icons/lu';
import { Tooltip } from '@/components/ui/tooltip';
import { format } from 'sql-formatter';
import { useRef, useEffect, useState, useMemo } from 'react';
import { DatabaseWithSchema } from '@/lib/types';
import { useConfigs } from '@/lib/hooks/useConfigs';
import { ResolvedReference } from '@/lib/sql/query-composer';
import { CompletionsAPI } from '@/lib/data/completions/completions';
import { debounce } from 'lodash';

/**
 * Promise-aware debounce for async functions
 * Lodash debounce doesn't return Promises, so we wrap it
 * All pending promises resolve with the same result when the debounced function executes
 */
function debouncePromise<T extends (...args: any[]) => Promise<any>>(
  func: T,
  wait: number
): (...args: Parameters<T>) => Promise<ReturnType<T>> {
  let timeout: NodeJS.Timeout | null = null;
  let pendingResolvers: Array<{ resolve: (value: any) => void; reject: (error: any) => void }> = [];

  return function (...args: Parameters<T>) {
    return new Promise<ReturnType<T>>((resolve, reject) => {
      // Add this promise to the pending list
      pendingResolvers.push({ resolve, reject });

      // Clear previous timeout
      if (timeout) {
        clearTimeout(timeout);
      }

      // Set new timeout
      timeout = setTimeout(async () => {

        const currentResolvers = pendingResolvers;
        pendingResolvers = [];

        try {
          const result = await func(...args);
          // Resolve all pending promises with the same result
          currentResolvers.forEach(r => r.resolve(result));
        } catch (error) {
          // Reject all pending promises with the same error
          currentResolvers.forEach(r => r.reject(error));
        }
      }, wait);
    });
  };
}

/**
 * Autocomplete implementation:
 * - @references: Frontend (requires DB query)
 * - Everything else: API-based (backend parses with sqlglot)
 */

// Custom styles for Monaco autocomplete dropdown and @reference highlighting
const monacoSuggestStyles = `
  .monaco-editor .suggest-widget {
    border-radius: 8px !important;
  }
  .monaco-editor .reference-highlight {
    color: #1abc9c !important;
    font-weight: 600;
  }
  .monaco-editor .reference-unresolved {
    text-decoration: underline wavy #e74c3c;
    text-underline-offset: 3px;
  }
  .monaco-editor .schema-table-highlight {
    color: #c0392b !important;
    font-weight: 500;
  }
  .monaco-editor .schema-column-highlight {
    color: #f39c12 !important;
  }
  .monaco-editor .schema-schema-highlight {
    color: #9b59b6 !important;
    font-weight: 500;
  }
`;

/**
 * Reference option for autocomplete
 */
export interface ReferenceOption {
  id: number;
  name: string;
  alias: string;  // Pre-generated alias (e.g., "43_revenue_by_month")
}

interface SqlEditorProps {
  value: string;
  onChange?: (value: string) => void;
  onRun?: () => void;
  readOnly?: boolean;
  showFormatButton?: boolean;
  showRunButton?: boolean;
  isRunning?: boolean;
  proposedValue?: string;  // When set, shows diff editor (current vs proposed)
  availableReferences?: ReferenceOption[];  // Questions available for @reference autocomplete
  validReferenceAliases?: string[];  // Aliases that are currently valid (resolved) - for error squiggles
  schemaData?: DatabaseWithSchema[];  // Database schema for table/column autocomplete
  resolvedReferences?: ResolvedReference[];  // Already loaded references for API autocomplete
  databaseName?: string;  // Database name for API autocomplete
  fillHeight?: boolean;  // When true, fills parent container height instead of fixed pixel height
}

export default function SqlEditor({
  value,
  onChange,
  onRun,
  readOnly = false,
  showFormatButton = true,
  showRunButton = false,
  isRunning = false,
  proposedValue,
  availableReferences = [],
  validReferenceAliases = [],
  schemaData = [],
  resolvedReferences = [],
  databaseName,
  fillHeight = false,
}: SqlEditorProps) {
  const colorMode = useAppSelector((state) => state.ui.colorMode);
  const editorTheme = colorMode === 'dark' ? 'vs-dark' : 'vs-light';
  const onRunRef = useRef(onRun);
  const editorRef = useRef<any>(null);
  const monacoRef = useRef<any>(null);
  const completionProviderRef = useRef<any>(null);
  const availableReferencesRef = useRef(availableReferences);
  const requestIdRef = useRef(0); // Track request IDs to ignore stale responses
  const [height, setHeight] = useState(200); // Height in pixels
  const [isResizing, setIsResizing] = useState(false);
  const startYRef = useRef(0);
  const startHeightRef = useRef(0);
  const { config } = useConfigs();
  const agentName = config.branding.agentName;
  

  // Keep the ref updated with the latest onRun callback
  useEffect(() => {
    onRunRef.current = onRun;
  }, [onRun]);

  // Keep availableReferences ref updated
  useEffect(() => {
    availableReferencesRef.current = availableReferences;
  }, [availableReferences]);

  // Keep validReferenceAliases ref updated for decoration
  const validReferenceAliasesRef = useRef(validReferenceAliases);
  useEffect(() => {
    validReferenceAliasesRef.current = validReferenceAliases;
  }, [validReferenceAliases]);

  // Keep schemaData ref updated for schema completions
  const schemaDataRef = useRef(schemaData);
  useEffect(() => {
    schemaDataRef.current = schemaData;
  }, [schemaData]);

  // Debounced API autocomplete fetch with staleness checking (promise-aware)
  const debouncedFetchCompletions = useMemo(
    () => debouncePromise(async (query: string, cursorOffset: number, context: any, requestId: number) => {
      try {
        const result = await CompletionsAPI.getSqlCompletions({
          query,
          cursorOffset,
          context
        });

        return { ...result, requestId };
      } catch (error) {
        console.error('Autocomplete error:', error);
        return { suggestions: [], requestId };
      }
    }, 100),  // 100ms debounce
    []
  );

  // Map API completion kind to Monaco kind
  const mapKindToMonaco = (kind: string, monaco: any) => {
    const kindMap: Record<string, any> = {
      'column': monaco.languages.CompletionItemKind.Field,
      'table': monaco.languages.CompletionItemKind.Class,
      'schema': monaco.languages.CompletionItemKind.Module,
      'cte': monaco.languages.CompletionItemKind.Variable,
      'keyword': monaco.languages.CompletionItemKind.Keyword,
      'reference': monaco.languages.CompletionItemKind.Reference
    };
    return kindMap[kind] || monaco.languages.CompletionItemKind.Text;
  };

  // Function to register completion provider (called from onMount and when readOnly changes)
  const registerCompletionProvider = (monaco: any) => {
    if (!monaco || readOnly) {
      return;
    }

    // Dispose previous provider if exists
    if (completionProviderRef.current) {
      completionProviderRef.current.dispose();
    }

    // Register completion provider for SQL language
    completionProviderRef.current = monaco.languages.registerCompletionItemProvider('sql', {
      triggerCharacters: ['@', '.', ' ', ','],
      provideCompletionItems: async (model: any, position: any) => {
        // Get text before cursor on current line
        const textUntilPosition = model.getValueInRange({
          startLineNumber: position.lineNumber,
          startColumn: 1,
          endLineNumber: position.lineNumber,
          endColumn: position.column
        });

        // Get full SQL text for alias extraction
        const fullText = model.getValue();
        const currentSchemaData = schemaDataRef.current;
        const currentRefs = availableReferencesRef.current;

        // 1. Check for @reference completion first (always use frontend logic)
        const atMatch = textUntilPosition.match(/@(\w*)$/);
        if (atMatch) {
          const atIndex = textUntilPosition.lastIndexOf('@');
          const range = {
            startLineNumber: position.lineNumber,
            startColumn: atIndex + 1,
            endLineNumber: position.lineNumber,
            endColumn: position.column
          };

          const suggestions = currentRefs.map((ref: ReferenceOption, index: number) => ({
            label: ref.name,
            kind: monaco.languages.CompletionItemKind.Value,
            detail: `@${ref.alias}`,
            documentation: `Insert reference to question #${ref.id}`,
            insertText: `@${ref.alias}`,
            filterText: '@' + ref.name,
            range: range,
            sortText: String(index).padStart(5, '0'),
          }));

          return { suggestions };
        }

        // Skip schema completions if no schema data available
        if (!currentSchemaData || currentSchemaData.length === 0) {
          return { suggestions: [] };
        }

        // API-BASED AUTOCOMPLETE (backend parses with sqlglot)
        try {
          // Increment request ID to track this request
          requestIdRef.current += 1;
          const currentRequestId = requestIdRef.current;

          // Calculate full cursor offset (not just on current line)
          const textUntilCursor = model.getValueInRange({
            startLineNumber: 1,
            startColumn: 1,
            endLineNumber: position.lineNumber,
            endColumn: position.column
          });

          const data = await debouncedFetchCompletions(
            fullText,
            textUntilCursor.length,
            {
              type: 'sql_editor',
              schemaData: currentSchemaData,
              resolvedReferences: resolvedReferences,
              databaseName: databaseName
            },
            currentRequestId
          );

          // Ignore stale responses (user has moved cursor or typed more)
          if (data.requestId !== requestIdRef.current) {
            return { suggestions: [] };
          }

          // Convert API suggestions to Monaco format
          const suggestions = data.suggestions.map((item: any) => {
            const wordMatch = textUntilPosition.match(/(\w*)$/);
            const partial = wordMatch ? wordMatch[1] : '';

            return {
              label: {
                label: item.label,
                detail: item.detail,
                description: item.documentation
              },
              kind: mapKindToMonaco(item.kind, monaco),
              insertText: item.insert_text,
              sortText: item.sort_text,
              range: {
                startLineNumber: position.lineNumber,
                startColumn: position.column - partial.length,
                endLineNumber: position.lineNumber,
                endColumn: position.column
              }
            };
          });

          return { suggestions };
        } catch (error) {
          console.error('API autocomplete error:', error);
          return { suggestions: [] };
        }
      }
    });
  };

  // Re-register when readOnly changes
  useEffect(() => {
    if (monacoRef.current) {
      registerCompletionProvider(monacoRef.current);
    }

    return () => {
      if (completionProviderRef.current) {
        completionProviderRef.current.dispose();
        completionProviderRef.current = null;
      }
    };
  }, [readOnly]);

  const handleChange = (value: string | undefined) => {
    if (onChange && value !== undefined) {
      onChange(value);
    }
  };

  const handleFormat = () => {
    try {
      if (!editorRef.current) return;

      const currentValue = editorRef.current.getValue();
      const formatted = format(currentValue, {
        language: 'sql',
        tabWidth: 2,
        keywordCase: 'upper',
        linesBetweenQueries: 1,
        indentStyle: 'standard',
        logicalOperatorNewline: 'before',
        expressionWidth: 80,
      });

      // Update editor value and trigger onChange
      editorRef.current.setValue(formatted);
      if (onChange) {
        onChange(formatted);
      }
    } catch (error) {
      console.error('Failed to format SQL:', error);
    }
  };

  const handleResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    startYRef.current = e.clientY;
    startHeightRef.current = height;
  };

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      const delta = e.clientY - startYRef.current;
      const newHeight = Math.max(150, Math.min(300, startHeightRef.current + delta));
      setHeight(newHeight);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing]);

  return (
    <>
      {/* Inject Monaco suggest widget styles */}
      <style>{monacoSuggestStyles}</style>
      <Box
        border="1px solid"
        borderColor="border.default"
        borderRadius="md"
        overflow="hidden"
        bg="bg.subtle"
        pr={2}
        position="relative"
        height={fillHeight ? '100%' : undefined}
        display={fillHeight ? 'flex' : undefined}
        flexDirection={fillHeight ? 'column' : undefined}
      >
      <HStack align="stretch" gap={2} flex={fillHeight ? 1 : undefined} height={fillHeight ? '100%' : undefined}>
        <Box
          flex={1}
          borderColor="border.default"
          overflow="hidden"
          height={fillHeight ? '100%' : undefined}
          bg="bg.canvas"
        >
          {proposedValue ? (
            // Diff mode: show current vs proposed
            <DiffEditor
              height={fillHeight ? '100%' : `${height}px`}
              language="sql"
              original={value}
              modified={proposedValue}
              theme={editorTheme}
              keepCurrentOriginalModel
              keepCurrentModifiedModel
              onMount={(_editor, monaco) => {
                // Define custom theme
                monaco.editor.defineTheme('custom-theme', {
                  base: colorMode === 'dark' ? 'vs-dark' : 'vs',
                  inherit: true,
                  rules: [],
                  colors: {
                    'editor.background': colorMode === 'dark' ? '#161b22' : '#ffffff',
                  }
                });
                monaco.editor.setTheme('custom-theme');
              }}
              options={{
                readOnly: true,  // Diff view is always read-only
                fontFamily: 'var(--font-jetbrains-mono)',
                lineNumbers: 'on',
                scrollBeyondLastLine: false,
                wordWrap: 'on',
                automaticLayout: true,
                renderSideBySide: true,  // Side-by-side diff view
                padding: {
                  top: 12,
                  bottom: 12,
                },
              }}
            />
          ) : (
            // Normal edit mode
            <Editor
              height={fillHeight ? '100%' : `${height}px`}
              defaultLanguage="sql"
              value={value}
              onChange={handleChange}
              theme={editorTheme}
              loading={<Box p={4} color="fg.muted" fontFamily="mono" fontSize="sm">Loading editor...</Box>}
              onMount={(editor, monaco) => {
                editorRef.current = editor;
                monacoRef.current = monaco;

                // Register @ completion provider now that Monaco is ready
                registerCompletionProvider(monaco);

                // Manually trigger suggestions when @ is typed
                editor.onKeyUp(() => {
                  // Check if @ was typed by looking at the character before cursor
                  const position = editor.getPosition();
                  if (position) {
                    const lineContent = editor.getModel()?.getLineContent(position.lineNumber) || '';
                    const charBefore = lineContent[position.column - 2];
                    if (charBefore === '@') {
                      setTimeout(() => {
                        editor.trigger('keyboard', 'editor.action.triggerSuggest', {});
                      }, 10);
                    }
                  }
                });

                // Define custom theme
                monaco.editor.defineTheme('custom-theme', {
                  base: colorMode === 'dark' ? 'vs-dark' : 'vs',
                  inherit: true,
                  rules: [],
                  colors: {
                    'editor.background': colorMode === 'dark' ? '#161b22' : '#ffffff',
                  }
                });
                monaco.editor.setTheme('custom-theme');

                // Function to highlight @references and schema elements in the editor
                let decorations: string[] = [];
                const updateDecorations = () => {
                  const model = editor.getModel();
                  if (!model) return;

                  const text = model.getValue();
                  const validAliases = validReferenceAliasesRef.current;
                  const availableRefs = availableReferencesRef.current;
                  const currentSchema = schemaDataRef.current;
                  const newDecorations: any[] = [];

                  // Match all @word patterns (potential references)
                  const refRegex = /@(\w+)/g;
                  let match;

                  while ((match = refRegex.exec(text)) !== null) {
                    const alias = match[1];  // The part after @
                    const startPos = model.getPositionAt(match.index);
                    const endPos = model.getPositionAt(match.index + match[0].length);
                    const range = new monaco.Range(startPos.lineNumber, startPos.column, endPos.lineNumber, endPos.column);

                    // Check if already in valid references (synced)
                    const isValidSynced = validAliases.includes(alias);

                    // Check if alias matches format and ID exists in available questions
                    // This handles the case where user just selected from autocomplete but sync hasn't run yet
                    const idMatch = alias.match(/_(\d+)$/);
                    const isValidPending = idMatch && availableRefs.some(r => r.id === parseInt(idMatch[1], 10));

                    if (isValidSynced || isValidPending) {
                      // Valid reference - teal highlight
                      newDecorations.push({
                        range,
                        options: {
                          inlineClassName: 'reference-highlight'
                        }
                      });
                    } else {
                      // Unresolved reference - red squiggle (CSS only, no tooltip)
                      newDecorations.push({
                        range,
                        options: {
                          inlineClassName: 'reference-unresolved'
                        }
                      });
                    }
                  }

                  // Highlight schema elements (tables, columns, schemas) if schema data available
                  if (currentSchema && currentSchema.length > 0) {
                    // Build sets for quick lookup
                    const tableNames = new Set<string>();
                    const columnNames = new Set<string>();
                    const schemaNames = new Set<string>();

                    for (const db of currentSchema) {
                      for (const schema of db.schemas) {
                        schemaNames.add(schema.schema.toLowerCase());
                        for (const table of schema.tables) {
                          tableNames.add(table.table.toLowerCase());
                          for (const col of table.columns) {
                            columnNames.add(col.name.toLowerCase());
                          }
                        }
                      }
                    }

                    // Match all word tokens (excluding those starting with @)
                    const wordRegex = /\b([a-zA-Z_][a-zA-Z0-9_]*)\b/g;
                    while ((match = wordRegex.exec(text)) !== null) {
                      const word = match[1];
                      const lowerWord = word.toLowerCase();

                      // Skip if it's part of an @reference
                      const charBefore = match.index > 0 ? text[match.index - 1] : '';
                      if (charBefore === '@') continue;

                      // Skip SQL keywords
                      const sqlKeywords = new Set(['select', 'from', 'where', 'join', 'on', 'and', 'or', 'not', 'in', 'as', 'order', 'by', 'group', 'having', 'limit', 'offset', 'inner', 'left', 'right', 'outer', 'cross', 'union', 'all', 'distinct', 'case', 'when', 'then', 'else', 'end', 'null', 'true', 'false', 'is', 'like', 'between', 'exists', 'insert', 'into', 'values', 'update', 'set', 'delete', 'create', 'table', 'drop', 'alter', 'index', 'view', 'with', 'asc', 'desc', 'count', 'sum', 'avg', 'min', 'max', 'coalesce', 'cast', 'nullif']);
                      if (sqlKeywords.has(lowerWord)) continue;

                      const startPos = model.getPositionAt(match.index);
                      const endPos = model.getPositionAt(match.index + word.length);
                      const range = new monaco.Range(startPos.lineNumber, startPos.column, endPos.lineNumber, endPos.column);

                      // Check if it's a schema name (highest priority since it's most specific context)
                      if (schemaNames.has(lowerWord)) {
                        newDecorations.push({
                          range,
                          options: {
                            inlineClassName: 'schema-schema-highlight'
                          }
                        });
                      }
                      // Check if it's a table name
                      else if (tableNames.has(lowerWord)) {
                        newDecorations.push({
                          range,
                          options: {
                            inlineClassName: 'schema-table-highlight'
                          }
                        });
                      }
                      // Check if it's a column name
                      else if (columnNames.has(lowerWord)) {
                        newDecorations.push({
                          range,
                          options: {
                            inlineClassName: 'schema-column-highlight'
                          }
                        });
                      }
                    }
                  }

                  decorations = editor.deltaDecorations(decorations, newDecorations);
                };

                // Update decorations on content change (debounced for performance)
                let decorationTimeout: NodeJS.Timeout | null = null;
                editor.onDidChangeModelContent(() => {
                  if (decorationTimeout) clearTimeout(decorationTimeout);
                  decorationTimeout = setTimeout(updateDecorations, 150);
                });

                // Initial decoration
                updateDecorations();

                if (onRun && !readOnly) {
                  editor.addCommand(
                    monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter,
                    () => {
                      onRunRef.current?.();
                    }
                  );
                }

                // Unbind Cmd+K so it propagates to app's search bar
                // Monaco uses Cmd+K as a chord prefix, which blocks the app shortcut
                monaco.editor.addKeybindingRules([
                  {
                    keybinding: monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyK,
                    command: null,  // Removes the built-in binding
                  }
                ]);
              }}
              options={{
                readOnly,
                fontFamily: 'var(--font-jetbrains-mono)',
                lineNumbers: 'on',
                folding: true,
                lineDecorationsWidth: 10,
                lineNumbersMinChars: 3,
                scrollBeyondLastLine: false,
                wordWrap: 'on',
                wrappingIndent: 'indent',
                automaticLayout: true,
                tabSize: 2,
                // Enable autocomplete suggestions
                suggestOnTriggerCharacters: true,
                quickSuggestions: true,
                suggest: {
                  showReferences: true,
                  filterGraceful: true,
                },
                formatOnPaste: false,
                formatOnType: false,
                padding: {
                  top: 12,
                  bottom: 12,
                },
                placeholder: `Write your SQL query here, or just ask ${agentName}!`,
              }}
            />
          )}
        </Box>

        {!readOnly && (showFormatButton || showRunButton) && (
          <VStack gap={2} justify="space-between" py={2}>
            <VStack flex={1} justify="flex-start" gap={2}>
              {showFormatButton && (
                <Tooltip content="Format SQL" positioning={{ placement: 'left' }}>
                  <IconButton
                    onClick={handleFormat}
                    aria-label="Format SQL"
                    size="sm"
                    variant="ghost"
                    color="accent.teal"
                    _hover={{ bg: 'accent.teal', color: 'white' }}
                  >
                    <LuAlignLeft />
                  </IconButton>
                </Tooltip>
              )}
            </VStack>
            <VStack flex={1} justify="flex-end">
              {showRunButton && onRun && (
                <Tooltip content="Run Query (Cmd+Enter)" positioning={{ placement: 'left' }}>
                  <IconButton
                    onClick={onRun}
                    aria-label="Run query"
                    size="sm"
                    colorPalette="teal"
                    loading={isRunning}
                  >
                    <LuPlay fill="white" />
                  </IconButton>
                </Tooltip>
              )}
            </VStack>
          </VStack>
        )}
      </HStack>

      {/* Resize handle - only show when not in fillHeight mode */}
      {!fillHeight && (
        <Box
          position="absolute"
          bottom="0"
          left="0"
          right="0"
          height="8px"
          cursor="ns-resize"
          onMouseDown={handleResizeStart}
          bg="transparent"
          _hover={{
            bg: isResizing ? 'accent.teal' : 'border.emphasized',
          }}
          transition="background 0.2s"
          zIndex={10}
          display="flex"
          alignItems="center"
          justifyContent="center"
        >
          {/* Resize indicator dots */}
          <Box
            display="flex"
            gap="4px"
            alignItems="center"
            py="2px"
          >
            <Box
              width="3px"
              height="3px"
              borderRadius="full"
              bg={isResizing ? 'white' : 'border.emphasized'}
              transition="background 0.2s"
            />
            <Box
              width="3px"
              height="3px"
              borderRadius="full"
              bg={isResizing ? 'white' : 'border.emphasized'}
              transition="background 0.2s"
            />
            <Box
              width="3px"
              height="3px"
              borderRadius="full"
              bg={isResizing ? 'white' : 'border.emphasized'}
              transition="background 0.2s"
            />
          </Box>
        </Box>
      )}
    </Box>
    </>
  );
}
