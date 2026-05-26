'use client';

import { useEffect, useRef, useCallback } from 'react';
import { Box, HStack, IconButton } from '@chakra-ui/react';
import {
  LuBold,
  LuItalic,
  LuStrikethrough,
  LuHeading1,
  LuHeading2,
  LuHeading3,
  LuList,
  LuListOrdered,
  LuCode,
  LuQuote,
  LuMinus,
  LuListChecks,
} from 'react-icons/lu';

import { LexicalComposer } from '@lexical/react/LexicalComposer';
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin';
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin';
import { ListPlugin } from '@lexical/react/LexicalListPlugin';
import { CheckListPlugin } from '@lexical/react/LexicalCheckListPlugin';
import { TabIndentationPlugin } from '@lexical/react/LexicalTabIndentationPlugin';
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary';
import { MarkdownShortcutPlugin } from '@lexical/react/LexicalMarkdownShortcutPlugin';
import { TablePlugin } from '@lexical/react/LexicalTablePlugin';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';

import { HeadingNode, QuoteNode, $createHeadingNode, $createQuoteNode } from '@lexical/rich-text';
import { ListNode, ListItemNode } from '@lexical/list';
import { CodeNode } from '@lexical/code';
import { LinkNode } from '@lexical/link';
import { TableNode, TableRowNode, TableCellNode } from '@lexical/table';
import { HorizontalRuleNode, INSERT_HORIZONTAL_RULE_COMMAND } from '@lexical/react/LexicalHorizontalRuleNode';
import { HorizontalRulePlugin } from '@lexical/react/LexicalHorizontalRulePlugin';

import {
  $convertFromMarkdownString,
  $convertToMarkdownString,
} from '@lexical/markdown';

import {
  $getRoot,
  $getSelection,
  $isRangeSelection,
  FORMAT_TEXT_COMMAND,
  EditorState,
} from 'lexical';

import {
  INSERT_ORDERED_LIST_COMMAND,
  INSERT_UNORDERED_LIST_COMMAND,
  INSERT_CHECK_LIST_COMMAND,
} from '@lexical/list';

import { $setBlocksType } from '@lexical/selection';

import { useAppSelector } from '@/store/hooks';
import { ALL_TRANSFORMERS } from './markdown-transformers';
// TODO: CollapsibleHeadingPlugin removed — DOM manipulation inside contentEditable
// interferes with editing. Needs a decorator-node approach instead.

// --- Shared config ---
const EDITOR_NODES = [
  HeadingNode,
  QuoteNode,
  ListNode,
  ListItemNode,
  CodeNode,
  LinkNode,
  TableNode,
  TableRowNode,
  TableCellNode,
  HorizontalRuleNode,
];

// --- Theme ---
const editorTheme = {
  heading: {
    h1: 'lexical-h1',
    h2: 'lexical-h2',
    h3: 'lexical-h3',
  },
  text: {
    bold: 'lexical-bold',
    italic: 'lexical-italic',
    strikethrough: 'lexical-strikethrough',
    code: 'lexical-inline-code',
  },
  list: {
    ul: 'lexical-ul',
    ol: 'lexical-ol',
    listitem: 'lexical-li',
    listitemChecked: 'lexical-li-checked',
    listitemUnchecked: 'lexical-li-unchecked',
    nested: {
      listitem: 'lexical-nested-li',
    },
  },
  quote: 'lexical-quote',
  code: 'lexical-code-block',
  link: 'lexical-link',
  horizontalRule: 'lexical-hr',
  table: 'lexical-table',
  tableRow: 'lexical-table-row',
  tableCell: 'lexical-table-cell',
  tableCellHeader: 'lexical-table-cell-header',
};

/** Shared CSS for the Lexical editor content — used in both edit and read-only modes. */
const LEXICAL_CONTENT_CSS = {
  // Paragraphs
  '& p': { marginBottom: '1em', lineHeight: 1.8 },
  '& p:last-child': { marginBottom: 0 },

  // Headings
  '& .lexical-h1': { fontSize: '1.5em', fontWeight: 700, lineHeight: 1.3, marginTop: '1.2em', marginBottom: '0.6em' },
  '& .lexical-h2': { fontSize: '1.25em', fontWeight: 600, lineHeight: 1.4, marginTop: '1em', marginBottom: '0.5em' },
  '& .lexical-h3': { fontSize: '1.1em', fontWeight: 600, lineHeight: 1.4, marginTop: '0.8em', marginBottom: '0.4em' },
  '& .lexical-h1:first-child, & .lexical-h2:first-child, & .lexical-h3:first-child': { marginTop: 0 },

  // Inline formatting
  '& .lexical-bold': { fontWeight: 700 },
  '& .lexical-italic': { fontStyle: 'italic' },
  '& .lexical-strikethrough': { textDecoration: 'line-through' },
  '& .lexical-inline-code': {
    fontFamily: 'var(--font-jetbrains-mono), monospace',
    fontSize: '0.85em',
    padding: '2px 5px',
    borderRadius: '4px',
    backgroundColor: 'var(--chakra-colors-bg-emphasized)',
  },

  // Lists
  '& .lexical-ul': { listStyleType: 'disc', paddingLeft: '1.5em', margin: '0.5em 0', lineHeight: 1.7 },
  '& .lexical-ol': { listStyleType: 'decimal', paddingLeft: '1.5em', margin: '0.5em 0', lineHeight: 1.7 },
  '& .lexical-li': { marginBottom: '0.25em' },
  '& .lexical-li-checked, & .lexical-li-unchecked': {
    listStyleType: 'none',
    position: 'relative',
    paddingLeft: '1.5em',
    marginLeft: '-1.5em',
  },
  '& .lexical-li-checked::before': {
    content: '"☑"',
    position: 'absolute',
    left: 0,
  },
  '& .lexical-li-unchecked::before': {
    content: '"☐"',
    position: 'absolute',
    left: 0,
  },

  // Block quote
  '& .lexical-quote': {
    borderLeft: '3px solid var(--chakra-colors-border-default)',
    paddingLeft: '1em',
    margin: '0.6em 0',
    color: 'var(--chakra-colors-fg-muted)',
    fontStyle: 'italic',
  },

  // Code block
  '& .lexical-code-block': {
    fontFamily: 'var(--font-jetbrains-mono), monospace',
    fontSize: '0.85em',
    padding: '0.75em 1em',
    borderRadius: '6px',
    backgroundColor: 'var(--chakra-colors-bg-emphasized)',
    margin: '0.6em 0',
    whiteSpace: 'pre-wrap',
    overflowX: 'auto',
  },

  // Link
  '& .lexical-link': {
    color: 'var(--chakra-colors-accent-primary)',
    textDecoration: 'underline',
  },

  // Horizontal rule
  '& .lexical-hr': {
    border: 'none',
    borderTop: '1px solid var(--chakra-colors-border-default)',
    margin: '1em 0',
  },

  // Table — matches Markdown.tsx table styles
  '& .lexical-table': {
    width: 'max-content',
    minWidth: '100%',
    borderCollapse: 'collapse',
    border: '1px solid var(--chakra-colors-border-default)',
    borderRadius: '6px',
    overflow: 'hidden',
    margin: '0.5em 0',
    fontSize: 'inherit',
  },
  '& .lexical-table-row': {},
  '& .lexical-table-cell, & .lexical-table-cell-header': {
    padding: '0.5rem 0.75rem',
    textAlign: 'left',
    verticalAlign: 'top',
    lineHeight: 1.6,
    borderBottom: '1px solid var(--chakra-colors-border-emphasized)',
    borderRight: '1px solid var(--chakra-colors-border-emphasized)',
  },
  '& .lexical-table-cell:last-child, & .lexical-table-cell-header:last-child': {
    borderRight: 'none',
  },
  '& .lexical-table-cell-header': {
    fontWeight: 700,
    color: 'var(--chakra-colors-fg-emphasized)',
    backgroundColor: 'var(--chakra-colors-bg-muted)',
    borderBottom: '1px solid var(--chakra-colors-border-emphasized)',
    lineHeight: 1.5,
  },
  '& .lexical-table-row:last-child .lexical-table-cell': {
    borderBottom: 'none',
  },
  '& .lexical-table-row:hover .lexical-table-cell': {
    backgroundColor: 'var(--chakra-colors-bg-subtle)',
  },
  // Remove default paragraph margins inside table cells for compact layout
  '& .lexical-table-cell p, & .lexical-table-cell-header p': {
    margin: 0,
  },
} as const;

// --- Toolbar Plugin ---
function ToolbarPlugin() {
  const [editor] = useLexicalComposerContext();

  const formatHeading = useCallback((level: 'h1' | 'h2' | 'h3') => {
    editor.update(() => {
      const selection = $getSelection();
      if ($isRangeSelection(selection)) {
        $setBlocksType(selection, () => $createHeadingNode(level));
      }
    });
  }, [editor]);

  const btn = (label: string, icon: React.ReactElement, onClick: () => void) => (
    <IconButton
      aria-label={label}
      size="2xs"
      variant="ghost"
      onClick={onClick}
      cursor="pointer"
      color="fg.muted"
      _hover={{ color: 'fg.default', bg: 'bg.emphasized' }}
      minW="24px"
      h="24px"
    >
      {icon}
    </IconButton>
  );

  return (
    <HStack gap={0} flexWrap="wrap" px={1} py={0.5}>
      {btn('Bold', <LuBold size={13} />, () => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'bold'))}
      {btn('Italic', <LuItalic size={13} />, () => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'italic'))}
      {btn('Strikethrough', <LuStrikethrough size={13} />, () => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'strikethrough'))}
      {btn('Inline code', <LuCode size={13} />, () => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'code'))}

      <Box w="1px" h="16px" bg="border.muted" mx={0.5} />

      {btn('Heading 1', <LuHeading1 size={13} />, () => formatHeading('h1'))}
      {btn('Heading 2', <LuHeading2 size={13} />, () => formatHeading('h2'))}
      {btn('Heading 3', <LuHeading3 size={13} />, () => formatHeading('h3'))}

      <Box w="1px" h="16px" bg="border.muted" mx={0.5} />

      {btn('Bullet list', <LuList size={13} />, () => editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined))}
      {btn('Numbered list', <LuListOrdered size={13} />, () => editor.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined))}
      {btn('Checklist', <LuListChecks size={13} />, () => editor.dispatchCommand(INSERT_CHECK_LIST_COMMAND, undefined))}

      <Box w="1px" h="16px" bg="border.muted" mx={0.5} />

      {btn('Quote', <LuQuote size={13} />, () => {
        editor.update(() => {
          const selection = $getSelection();
          if ($isRangeSelection(selection)) {
            $setBlocksType(selection, () => $createQuoteNode());
          }
        });
      })}
      {btn('Horizontal rule', <LuMinus size={13} />, () => editor.dispatchCommand(INSERT_HORIZONTAL_RULE_COMMAND, undefined))}
    </HStack>
  );
}

/** Returns an editorState initializer that parses markdown into Lexical nodes. */
function makeEditorStateInit(markdown: string) {
  return () => {
    const root = $getRoot();
    root.clear();
    if (markdown) {
      $convertFromMarkdownString(markdown, ALL_TRANSFORMERS, root, true);
    }
  };
}

// --- Editable Editor ---
interface LexicalTextEditorProps {
  initialMarkdown: string;
  onChange: (markdown: string) => void;
  /** If provided, the toolbar is passed to this render prop instead of being rendered inline. */
  renderToolbar?: (toolbar: React.ReactNode) => React.ReactNode;
}

export default function LexicalTextEditor({ initialMarkdown, onChange, renderToolbar }: LexicalTextEditorProps) {
  const colorMode = useAppSelector((state) => state.ui.colorMode);

  // Debounce onChange to avoid dispatching on every keystroke
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const handleChange = useCallback((editorState: EditorState) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      editorState.read(() => {
        const markdown = $convertToMarkdownString(ALL_TRANSFORMERS, undefined, true);
        onChangeRef.current(markdown);
      });
    }, 300);
  }, []);

  const initialConfig = {
    namespace: 'TextBlockEditor',
    theme: editorTheme,
    onError: (error: Error) => console.error('Lexical error:', error),
    nodes: EDITOR_NODES,
    editorState: makeEditorStateInit(initialMarkdown),
  };

  return (
    <Box
      height="100%"
      display="flex"
      flexDirection="column"
      className={colorMode === 'dark' ? 'lexical-dark' : 'lexical-light'}
      css={LEXICAL_CONTENT_CSS}
    >
      <LexicalComposer initialConfig={initialConfig}>
        {renderToolbar ? (
          renderToolbar(<ToolbarPlugin />)
        ) : (
          <Box
            borderBottomWidth="1px"
            borderColor="border.default"
            bg="bg.muted"
            flexShrink={0}
          >
            <ToolbarPlugin />
          </Box>
        )}

        <Box flex={1} minH={0} overflow="auto" position="relative">
          <RichTextPlugin
            contentEditable={
              <ContentEditable
                style={{
                  outline: 'none',
                  padding: '32px 32px',
                  minHeight: '100%',
                  fontSize: '14px',
                  lineHeight: 1.6,
                  fontFamily: 'var(--font-jetbrains-mono), monospace',
                }}
              />
            }
            placeholder={
              <Box
                position="absolute"
                top="12px"
                left="16px"
                color="fg.muted"
                fontSize="sm"
                pointerEvents="none"
              >
                Start writing...
              </Box>
            }
            ErrorBoundary={LexicalErrorBoundary}
          />
        </Box>

        <HistoryPlugin />
        <ListPlugin />
        <CheckListPlugin />
        <TabIndentationPlugin />
        <TablePlugin />
        <HorizontalRulePlugin />
        <MarkdownShortcutPlugin transformers={ALL_TRANSFORMERS} />
        <OnChangePlugin onChange={handleChange} />
      </LexicalComposer>
    </Box>
  );
}

// --- Read-only Viewer ---
interface LexicalTextViewerProps {
  markdown: string;
}

export function LexicalTextViewer({ markdown }: LexicalTextViewerProps) {
  const colorMode = useAppSelector((state) => state.ui.colorMode);

  const initialConfig = {
    namespace: 'TextBlockViewer',
    theme: editorTheme,
    onError: (error: Error) => console.error('Lexical error:', error),
    nodes: EDITOR_NODES,
    editable: false,
    editorState: makeEditorStateInit(markdown),
  };

  return (
    <Box
      height="100%"
      className={colorMode === 'dark' ? 'lexical-dark' : 'lexical-light'}
      css={LEXICAL_CONTENT_CSS}
    >
      <LexicalComposer initialConfig={initialConfig}>
        <RichTextPlugin
          contentEditable={
            <ContentEditable
              style={{
                outline: 'none',
                padding: '40px 32px',
                minHeight: '100%',
                fontSize: '14px',
                lineHeight: 1.6,
                fontFamily: 'var(--font-jetbrains-mono), monospace',
              }}
            />
          }
          placeholder={null}
          ErrorBoundary={LexicalErrorBoundary}
        />
        <ListPlugin />
        <TablePlugin />
        <HorizontalRulePlugin />
      </LexicalComposer>
    </Box>
  );
}
