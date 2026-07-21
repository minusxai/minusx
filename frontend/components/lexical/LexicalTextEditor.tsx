'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import { createPortal } from 'react-dom';
import { Box, HStack, IconButton, Icon, Text } from '@chakra-ui/react';
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
  LuImage,
  LuSquareFunction,
  LuLightbulb,
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

import { $createHeadingNode, $createQuoteNode } from '@lexical/rich-text';
import { INSERT_HORIZONTAL_RULE_COMMAND } from '@lexical/react/LexicalHorizontalRuleNode';
import { HorizontalRulePlugin } from '@lexical/react/LexicalHorizontalRulePlugin';

import {
  $convertFromMarkdownString,
  $convertToMarkdownString,
} from '@lexical/markdown';

import {
  $getRoot,
  $getSelection,
  $isRangeSelection,
  $insertNodes,
  FORMAT_TEXT_COMMAND,
  EditorState,
  type LexicalEditor,
} from 'lexical';

import {
  INSERT_ORDERED_LIST_COMMAND,
  INSERT_UNORDERED_LIST_COMMAND,
  INSERT_CHECK_LIST_COMMAND,
} from '@lexical/list';

import { $setBlocksType } from '@lexical/selection';

import { useAppSelector } from '@/store/hooks';
import type { DatabaseWithSchema } from '@/lib/types';
import { $createImageNode } from './ImageNode';
import { $createMetricNode } from './MetricNode';
import { MentionsPlugin } from './MentionsPlugin';
import { DOCS_TRANSFORMERS, DOCS_NODES } from './docs-transformers';
import { InsertMenuPlugin } from './InsertMenuPlugin';
import { EditSelectionPlugin } from './EditSelectionPlugin';
import type { EditWithAgentSource } from '@/lib/chat/edit-with-agent';

/** Config for the optional @ / @@ mention typeahead (tables, questions, dashboards). */
export interface MentionsConfig {
  databaseName?: string;
  whitelistedSchemas?: DatabaseWithSchema[];
}

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
  image: 'lexical-image',
  metric: 'lexical-metric',
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

  // Image
  '& .lexical-image': {
    display: 'inline-block',
    maxWidth: '100%',
    margin: '0.5em 0',
  },

  // Table — matches Markdown.tsx table styles. `display: block` + `overflowX: auto`
  // makes a wide table scroll horizontally instead of being clipped (a plain
  // `<table>` doesn't form a reliable scroll container); `width: max-content` keeps
  // short tables compact, `maxWidth: 100%` caps wide ones to the container so they scroll.
  '& .lexical-table': {
    display: 'block',
    width: 'max-content',
    maxWidth: '100%',
    overflowX: 'auto',
    borderCollapse: 'collapse',
    border: '1px solid var(--chakra-colors-border-default)',
    borderRadius: '6px',
    margin: '0.5em 0',
    fontSize: 'inherit',
  },
  '& .lexical-table-row': {},
  '& .lexical-table-cell, & .lexical-table-cell-header': {
    padding: '0.5rem 0.75rem',
    textAlign: 'left',
    verticalAlign: 'top',
    lineHeight: 1.6,
    // Let a column grow to fit its content up to a cap, then wrap on spaces.
    // `wordBreak: normal` never splits inside a word; `overflowWrap: break-word`
    // breaks a single over-long word only as a last resort (so it can't force a
    // mid-word wrap like "BusinessNameCo / mpany" just because the column is
    // slightly narrow). The table itself scrolls horizontally (overflow-x above)
    // when the sum of columns exceeds the container.
    minWidth: '72px',
    maxWidth: '320px',
    whiteSpace: 'normal',
    wordBreak: 'normal',
    overflowWrap: 'break-word',
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

/**
 * Shared, tight content padding for the editor + viewer. Both modes use this so
 * a text block looks IDENTICAL whether it's being edited or rendered (true
 * WYSIWYG) — there's no toolbar taking space, because formatting is a floating
 * selection bubble (see FloatingSelectionToolbar). Kept small so single-height
 * heading / section-description blocks look tight and clean.
 */
export const SHARED_TEXT_PADDING = '24px 24px';

/** Hands the underlying editor instance to the parent (for imperative focus, etc.). */
function EditorRefPlugin({ onReady }: { onReady?: (editor: LexicalEditor) => void }) {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    onReady?.(editor);
  }, [editor, onReady]);
  return null;
}

/**
 * Notion/Medium-style floating formatting toolbar. Renders `children` (the
 * button set) in a bubble above the current text selection, portaled to
 * <body> so it's never clipped by the block/grid overflow. Shows only while a
 * non-empty range is selected inside this editor — so the resting editor has NO
 * chrome and looks pixel-identical to the read-only view.
 */
function FloatingSelectionToolbar({ children }: { children: React.ReactNode }) {
  const [editor] = useLexicalComposerContext();
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    let raf = 0;

    // Cheap: reads the NATIVE selection only (no Lexical editor-state read) and
    // bails on the very first check for typing (collapsed selection). Runs at
    // most once per animation frame.
    const update = () => {
      const native = typeof window !== 'undefined' ? window.getSelection() : null;
      const root = editor.getRootElement();
      if (!native || native.rangeCount === 0 || native.isCollapsed || !root) {
        setPos(null);
        return;
      }
      const range = native.getRangeAt(0);
      if (!root.contains(range.commonAncestorContainer)) {
        setPos(null);
        return;
      }
      const rect = range.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) {
        setPos(null);
        return;
      }
      const left = Math.min(Math.max(rect.left + rect.width / 2, 170), window.innerWidth - 170);
      setPos({ top: rect.top, left });
    };

    const schedule = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(update);
    };

    // Only the FOCUSED editor does any work — the other text blocks on the page
    // bail here with a single `contains` check, so a keystroke doesn't fan out
    // across every mounted editor.
    const onSelectionChange = () => {
      const root = editor.getRootElement();
      const active = document.activeElement;
      if (!root || !active || !root.contains(active)) return;
      schedule();
    };
    // Reposition on scroll/resize; `update` bails instantly when there's no
    // selection, so this is cheap even during fast scrolling.
    document.addEventListener('selectionchange', onSelectionChange);
    window.addEventListener('resize', schedule, true);
    window.addEventListener('scroll', schedule, true);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('selectionchange', onSelectionChange);
      window.removeEventListener('resize', schedule, true);
      window.removeEventListener('scroll', schedule, true);
    };
  }, [editor]);

  if (!pos) return null;

  return createPortal(
    <Box
      position="fixed"
      top={`${pos.top - 10}px`}
      left={`${pos.left}px`}
      transform="translate(-50%, -100%)"
      zIndex={1500}
      bg="bg.panel"
      borderWidth="1px"
      borderColor="border.emphasized"
      borderRadius="lg"
      boxShadow="lg"
      // Keep the selection alive when clicking a button (don't steal focus).
      onMouseDown={(e) => e.preventDefault()}
    >
      {children}
    </Box>,
    document.body,
  );
}

// --- Toolbar Plugin ---
function ToolbarPlugin({ onImageUpload, enableMetric }: { onImageUpload?: (file: File) => Promise<string>; enableMetric?: boolean }) {
  const [editor] = useLexicalComposerContext();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const formatHeading = useCallback((level: 'h1' | 'h2' | 'h3') => {
    editor.update(() => {
      const selection = $getSelection();
      if ($isRangeSelection(selection)) {
        $setBlocksType(selection, () => $createHeadingNode(level));
      }
    });
  }, [editor]);

  const insertMetric = useCallback(() => {
    editor.update(() => { $insertNodes([$createMetricNode({ name: '' })]); });
  }, [editor]);

  const openImagePicker = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleImageFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !onImageUpload) return;
    const src = await onImageUpload(file);
    if (!src) return;
    editor.update(() => {
      $insertNodes([$createImageNode({ src, altText: file.name })]);
    });
  }, [editor, onImageUpload]);

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

      {(onImageUpload || enableMetric) && <Box w="1px" h="16px" bg="border.muted" mx={0.5} />}

      {enableMetric && btn('Insert metric', <LuSquareFunction size={13} />, insertMetric)}

      {onImageUpload && (
        <>
          <IconButton
            aria-label="Insert image"
            size="2xs"
            variant="ghost"
            onClick={openImagePicker}
            cursor="pointer"
            color="fg.muted"
            _hover={{ color: 'fg.default', bg: 'bg.emphasized' }}
            minW="24px"
            h="24px"
          >
            <LuImage size={13} />
          </IconButton>
          <input
            aria-label="Upload image to insert"
            type="file"
            accept="image/*"
            ref={fileInputRef}
            style={{ display: 'none' }}
            onChange={handleImageFile}
          />
        </>
      )}
    </HStack>
  );
}

/** Returns an editorState initializer that parses markdown into Lexical nodes. */
function makeEditorStateInit(markdown: string) {
  return () => {
    const root = $getRoot();
    root.clear();
    if (markdown) {
      $convertFromMarkdownString(markdown, DOCS_TRANSFORMERS, root, true);
    }
  };
}

// --- Editable Editor ---
interface LexicalTextEditorProps {
  initialMarkdown: string;
  onChange: (markdown: string) => void;
  /** If provided, the toolbar is passed to this render prop instead of being rendered inline. */
  renderToolbar?: (toolbar: React.ReactNode) => React.ReactNode;
  /** If provided, an image button appears in the toolbar; returns the public URL to embed. */
  onImageUpload?: (file: File) => Promise<string>;
  /** If provided, enables the @ / @@ mention typeahead (tables, questions, dashboards). */
  mentions?: MentionsConfig;
  /** Enables the "+" insert menu (image block). */
  insertMenu?: boolean;
  /** Adds a Metric option (chip with name/description/SQL) to the "+" insert menu. */
  insertMetric?: boolean;
  /** If provided, selecting text shows an "Interact with {agentName}" pill that sends the selection to chat. */
  editWithAgent?: EditWithAgentSource;
  /** Hands back the editor instance so the parent can imperatively focus it (click-to-edit). */
  onEditorReady?: (editor: LexicalEditor) => void;
  /** CSS padding for the editable content (default {@link SHARED_TEXT_PADDING}). */
  contentPadding?: string;
  /** Render the toolbar as a floating bubble over the selection (no in-flow chrome). */
  floatingToolbar?: boolean;
  /** Vertically center short content in the available height (falls back to top-aligned on overflow). */
  verticalCenter?: boolean;
}

export default function LexicalTextEditor({ initialMarkdown, onChange, renderToolbar, onImageUpload, mentions, insertMenu, insertMetric, editWithAgent, onEditorReady, contentPadding = '32px 32px', floatingToolbar, verticalCenter }: LexicalTextEditorProps) {
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
        const markdown = $convertToMarkdownString(DOCS_TRANSFORMERS, undefined, true);
        onChangeRef.current(markdown);
      });
    }, 300);
  }, []);

  const initialConfig = {
    namespace: 'TextBlockEditor',
    theme: editorTheme,
    onError: (error: Error) => console.error('Lexical error:', error),
    nodes: DOCS_NODES,
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
        {floatingToolbar ? (
          <FloatingSelectionToolbar>
            <ToolbarPlugin onImageUpload={onImageUpload} />
          </FloatingSelectionToolbar>
        ) : renderToolbar ? (
          renderToolbar(<ToolbarPlugin onImageUpload={onImageUpload} />)
        ) : (
          <Box
            borderBottomWidth="1px"
            borderColor="border.default"
            bg="bg.muted"
            flexShrink={0}
          >
            <ToolbarPlugin onImageUpload={onImageUpload} />
          </Box>
        )}

        {/* The inline hint only renders for the DEFAULT inline toolbar (notebook/context
            docs). When the caller supplies its own `renderToolbar` or uses the floating
            selection toolbar (dashboard text blocks), it owns all chrome — a permanent
            hint line would break WYSIWYG. */}
        {!renderToolbar && !floatingToolbar && (insertMenu || mentions) && (
          <HStack
            gap={1.5}
            px={4}
            py={1}
            flexShrink={0}
            color="fg.subtle"
            fontSize="xs"
            borderBottomWidth="1px"
            borderColor="border.muted"
            bg="bg.subtle"
          >
            <Icon as={LuLightbulb} boxSize={3} />
            <Text>
              Pro tip: type <Box as="span" fontWeight="700" fontFamily="mono">+</Box> to insert images{insertMetric && ' or metrics'}
              {mentions && <> · <Box as="span" fontWeight="700" fontFamily="mono">@</Box> for tables, columns or saved questions</>}
            </Text>
          </HStack>
        )}

        <Box
          flex={1}
          minH={0}
          overflow="auto"
          position="relative"
          display={verticalCenter ? 'flex' : undefined}
          flexDirection={verticalCenter ? 'column' : undefined}
          // `safe center` vertically centers short content (equal top/bottom
          // space — great for one-line headings) but falls back to top-aligned
          // when content overflows, so scrolling/read-more still work.
          justifyContent={verticalCenter ? 'safe center' : undefined}
        >
          <RichTextPlugin
            contentEditable={
              <ContentEditable
                style={{
                  outline: 'none',
                  padding: contentPadding,
                  minHeight: verticalCenter ? undefined : '100%',
                  fontSize: '14px',
                  lineHeight: 1.6,
                  fontFamily: 'var(--font-jetbrains-mono), monospace',
                }}
              />
            }
            placeholder={
              <Box
                position="absolute"
                top="24px"
                left="24px"
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
        <MarkdownShortcutPlugin transformers={DOCS_TRANSFORMERS} />
        <OnChangePlugin onChange={handleChange} />
        {mentions && (
          <MentionsPlugin
            databaseName={mentions.databaseName}
            whitelistedSchemas={mentions.whitelistedSchemas}
            availableSkills={[]}
            availableCommands={[]}
            anchorToCaret
          />
        )}
        {insertMenu && <InsertMenuPlugin onImageUpload={onImageUpload} enableMetric={insertMetric} />}
        {editWithAgent && <EditSelectionPlugin source={editWithAgent} />}
        {onEditorReady && <EditorRefPlugin onReady={onEditorReady} />}
      </LexicalComposer>
    </Box>
  );
}

// --- Read-only Viewer ---
interface LexicalTextViewerProps {
  markdown: string;
  /** CSS padding for the content (default roomy; pass a tighter value for slides). */
  padding?: string;
  /** Base font size (default 14px). */
  fontSize?: string;
  /** Vertically center short content in the available height (falls back to top-aligned on overflow). */
  verticalCenter?: boolean;
}

export function LexicalTextViewer({ markdown, padding = '40px 32px', fontSize = '14px', verticalCenter }: LexicalTextViewerProps) {
  const colorMode = useAppSelector((state) => state.ui.colorMode);

  const initialConfig = {
    namespace: 'TextBlockViewer',
    theme: editorTheme,
    onError: (error: Error) => console.error('Lexical error:', error),
    nodes: DOCS_NODES,
    editable: false,
    editorState: makeEditorStateInit(markdown),
  };

  return (
    <Box
      height="100%"
      className={colorMode === 'dark' ? 'lexical-dark' : 'lexical-light'}
      css={LEXICAL_CONTENT_CSS}
      display={verticalCenter ? 'flex' : undefined}
      flexDirection={verticalCenter ? 'column' : undefined}
      justifyContent={verticalCenter ? 'safe center' : undefined}
    >
      <LexicalComposer initialConfig={initialConfig}>
        <RichTextPlugin
          contentEditable={
            <ContentEditable
              style={{
                outline: 'none',
                padding,
                minHeight: verticalCenter ? undefined : '100%',
                fontSize,
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
