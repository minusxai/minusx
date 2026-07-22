'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import { createPortal } from 'react-dom';
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

/**
 * Shared CSS for the Lexical editor content — used in both edit and read-only
 * modes. Scoped under `.mx-lexical-content` and injected via a `<style>` tag
 * (the Chakra `css` prop is gone — Renderer_v2 Phase 5 Chakra exit). Colors
 * come from the Tailwind theme tokens (`--muted`, `--border`, ...).
 */
const LEXICAL_CONTENT_CSS = `
.mx-lexical-content p { margin-bottom: 1em; line-height: 1.8; }
.mx-lexical-content p:last-child { margin-bottom: 0; }

.mx-lexical-content .lexical-h1 { font-size: 1.5em; font-weight: 700; line-height: 1.3; margin-top: 1.2em; margin-bottom: 0.6em; }
.mx-lexical-content .lexical-h2 { font-size: 1.25em; font-weight: 600; line-height: 1.4; margin-top: 1em; margin-bottom: 0.5em; }
.mx-lexical-content .lexical-h3 { font-size: 1.1em; font-weight: 600; line-height: 1.4; margin-top: 0.8em; margin-bottom: 0.4em; }
.mx-lexical-content .lexical-h1:first-child, .mx-lexical-content .lexical-h2:first-child, .mx-lexical-content .lexical-h3:first-child { margin-top: 0; }

.mx-lexical-content .lexical-bold { font-weight: 700; }
.mx-lexical-content .lexical-italic { font-style: italic; }
.mx-lexical-content .lexical-strikethrough { text-decoration: line-through; }
.mx-lexical-content .lexical-inline-code {
  font-family: var(--font-jetbrains-mono), monospace;
  font-size: 0.85em;
  padding: 2px 5px;
  border-radius: 4px;
  background-color: var(--accent);
}

.mx-lexical-content .lexical-ul { list-style-type: disc; padding-left: 1.5em; margin: 0.5em 0; line-height: 1.7; }
.mx-lexical-content .lexical-ol { list-style-type: decimal; padding-left: 1.5em; margin: 0.5em 0; line-height: 1.7; }
.mx-lexical-content .lexical-li { margin-bottom: 0.25em; }
.mx-lexical-content .lexical-li-checked, .mx-lexical-content .lexical-li-unchecked {
  list-style-type: none;
  position: relative;
  padding-left: 1.5em;
  margin-left: -1.5em;
}
.mx-lexical-content .lexical-li-checked::before { content: "☑"; position: absolute; left: 0; }
.mx-lexical-content .lexical-li-unchecked::before { content: "☐"; position: absolute; left: 0; }

.mx-lexical-content .lexical-quote {
  border-left: 3px solid var(--border);
  padding-left: 1em;
  margin: 0.6em 0;
  color: var(--muted-foreground);
  font-style: italic;
}

.mx-lexical-content .lexical-code-block {
  font-family: var(--font-jetbrains-mono), monospace;
  font-size: 0.85em;
  padding: 0.75em 1em;
  border-radius: 6px;
  background-color: var(--accent);
  margin: 0.6em 0;
  white-space: pre-wrap;
  overflow-x: auto;
}

.mx-lexical-content .lexical-link { color: #2980b9; text-decoration: underline; }

.mx-lexical-content .lexical-hr { border: none; border-top: 1px solid var(--border); margin: 1em 0; }

.mx-lexical-content .lexical-image { display: inline-block; max-width: 100%; margin: 0.5em 0; }

/* Table — matches Markdown.tsx table styles. \`display: block\` + \`overflow-x: auto\`
   makes a wide table scroll horizontally instead of being clipped (a plain
   <table> doesn't form a reliable scroll container); \`width: max-content\` keeps
   short tables compact, \`max-width: 100%\` caps wide ones to the container so they scroll. */
.mx-lexical-content .lexical-table {
  display: block;
  width: max-content;
  max-width: 100%;
  overflow-x: auto;
  border-collapse: collapse;
  border: 1px solid var(--border);
  border-radius: 6px;
  margin: 0.5em 0;
  font-size: inherit;
}
.mx-lexical-content .lexical-table-cell, .mx-lexical-content .lexical-table-cell-header {
  padding: 0.5rem 0.75rem;
  text-align: left;
  vertical-align: top;
  line-height: 1.6;
  /* Let a column grow to fit its content up to a cap, then wrap on spaces.
     \`word-break: normal\` never splits inside a word; \`overflow-wrap: break-word\`
     breaks a single over-long word only as a last resort (so it can't force a
     mid-word wrap like "BusinessNameCo / mpany" just because the column is
     slightly narrow). The table itself scrolls horizontally (overflow-x above)
     when the sum of columns exceeds the container. */
  min-width: 72px;
  max-width: 320px;
  white-space: normal;
  word-break: normal;
  overflow-wrap: break-word;
  border-bottom: 1px solid var(--border);
  border-right: 1px solid var(--border);
}
.mx-lexical-content .lexical-table-cell:last-child, .mx-lexical-content .lexical-table-cell-header:last-child { border-right: none; }
.mx-lexical-content .lexical-table-cell-header {
  font-weight: 700;
  color: var(--foreground);
  background-color: var(--muted);
  border-bottom: 1px solid var(--border);
  line-height: 1.5;
}
.mx-lexical-content .lexical-table-row:last-child .lexical-table-cell { border-bottom: none; }
.mx-lexical-content .lexical-table-row:hover .lexical-table-cell { background-color: color-mix(in srgb, var(--muted) 50%, transparent); }
/* Remove default paragraph margins inside table cells for compact layout */
.mx-lexical-content .lexical-table-cell p, .mx-lexical-content .lexical-table-cell-header p { margin: 0; }
`;

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
    <div
      data-mx-theme-host=""
      className="fixed z-[1500] rounded-lg border border-border bg-popover shadow-lg"
      style={{ top: `${pos.top - 10}px`, left: `${pos.left}px`, transform: 'translate(-50%, -100%)' }}
      // Keep the selection alive when clicking a button (don't steal focus).
      onMouseDown={(e) => e.preventDefault()}
    >
      {children}
    </div>,
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

  const btnClass = 'inline-flex h-6 min-w-6 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground';

  const btn = (label: string, icon: React.ReactElement, onClick: () => void) => (
    <button type="button" aria-label={label} onClick={onClick} className={btnClass}>
      {icon}
    </button>
  );

  const divider = <div className="mx-0.5 h-4 w-px shrink-0 bg-border" />;

  return (
    <div className="flex flex-wrap items-center px-1 py-0.5">
      {btn('Bold', <LuBold size={13} />, () => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'bold'))}
      {btn('Italic', <LuItalic size={13} />, () => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'italic'))}
      {btn('Strikethrough', <LuStrikethrough size={13} />, () => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'strikethrough'))}
      {btn('Inline code', <LuCode size={13} />, () => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'code'))}

      {divider}

      {btn('Heading 1', <LuHeading1 size={13} />, () => formatHeading('h1'))}
      {btn('Heading 2', <LuHeading2 size={13} />, () => formatHeading('h2'))}
      {btn('Heading 3', <LuHeading3 size={13} />, () => formatHeading('h3'))}

      {divider}

      {btn('Bullet list', <LuList size={13} />, () => editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined))}
      {btn('Numbered list', <LuListOrdered size={13} />, () => editor.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined))}
      {btn('Checklist', <LuListChecks size={13} />, () => editor.dispatchCommand(INSERT_CHECK_LIST_COMMAND, undefined))}

      {divider}

      {btn('Quote', <LuQuote size={13} />, () => {
        editor.update(() => {
          const selection = $getSelection();
          if ($isRangeSelection(selection)) {
            $setBlocksType(selection, () => $createQuoteNode());
          }
        });
      })}
      {btn('Horizontal rule', <LuMinus size={13} />, () => editor.dispatchCommand(INSERT_HORIZONTAL_RULE_COMMAND, undefined))}

      {(onImageUpload || enableMetric) && divider}

      {enableMetric && btn('Insert metric', <LuSquareFunction size={13} />, insertMetric)}

      {onImageUpload && (
        <>
          <button type="button" aria-label="Insert image" onClick={openImagePicker} className={btnClass}>
            <LuImage size={13} />
          </button>
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
    </div>
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

/** The "+ to insert images … @ for tables…" hint line. Rendered by the default
 * inline toolbar; exported so callers that take over the toolbar chrome via
 * `renderToolbar` (e.g. the context docs Diff wrapper) can keep it visible. */
export function EditorProTip({ mentions, insertMetric }: { mentions?: boolean; insertMetric?: boolean }) {
  return (
    <div
      aria-label="Editor pro tip"
      className="flex shrink-0 items-center gap-1.5 border-b border-border px-4 py-1 text-xs text-muted-foreground"
      style={{ background: 'color-mix(in srgb, var(--muted) 50%, transparent)' }}
    >
      <LuLightbulb size={12} className="shrink-0" />
      <span>
        Pro tip: type <span className="font-bold" style={{ fontFamily: 'var(--font-jetbrains-mono), monospace' }}>+</span> to insert images{insertMetric && ' or metrics'}
        {mentions && <> · <span className="font-bold" style={{ fontFamily: 'var(--font-jetbrains-mono), monospace' }}>@</span> for tables, columns or saved questions</>}
      </span>
    </div>
  );
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
    <div className={`mx-lexical-content flex h-full flex-col ${colorMode === 'dark' ? 'lexical-dark' : 'lexical-light'}`}>
      <style>{LEXICAL_CONTENT_CSS}</style>
      <LexicalComposer initialConfig={initialConfig}>
        {floatingToolbar ? (
          <FloatingSelectionToolbar>
            <ToolbarPlugin onImageUpload={onImageUpload} />
          </FloatingSelectionToolbar>
        ) : renderToolbar ? (
          renderToolbar(<ToolbarPlugin onImageUpload={onImageUpload} />)
        ) : (
          <div className="shrink-0 border-b border-border bg-muted">
            <ToolbarPlugin onImageUpload={onImageUpload} />
          </div>
        )}

        {/* The inline hint only renders for the DEFAULT inline toolbar. A caller that
            supplies its own `renderToolbar` owns all chrome — it can opt back in by
            rendering <EditorProTip> itself (the context docs Diff wrapper does). The
            floating selection toolbar (dashboard text blocks) never shows it — a
            permanent hint line would break WYSIWYG. */}
        {!renderToolbar && !floatingToolbar && (insertMenu || mentions) && (
          <EditorProTip mentions={!!mentions} insertMetric={insertMetric} />
        )}

        <div
          className="relative min-h-0 flex-1 overflow-auto"
          // `safe center` vertically centers short content (equal top/bottom
          // space — great for one-line headings) but falls back to top-aligned
          // when content overflows, so scrolling/read-more still work.
          style={verticalCenter ? { display: 'flex', flexDirection: 'column', justifyContent: 'safe center' } : undefined}
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
              <div className="pointer-events-none absolute top-[24px] left-[24px] text-sm text-muted-foreground">
                Start writing...
              </div>
            }
            ErrorBoundary={LexicalErrorBoundary}
          />
        </div>

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
    </div>
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
    <div
      className={`mx-lexical-content h-full ${colorMode === 'dark' ? 'lexical-dark' : 'lexical-light'}`}
      style={verticalCenter ? { display: 'flex', flexDirection: 'column', justifyContent: 'safe center' } : undefined}
    >
      <style>{LEXICAL_CONTENT_CSS}</style>
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
    </div>
  );
}
