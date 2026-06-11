'use client';

import { useEffect, useRef, useCallback, useMemo, useState } from 'react';
import { Box, HStack } from '@chakra-ui/react';

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
import { HorizontalRulePlugin } from '@lexical/react/LexicalHorizontalRulePlugin';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { $insertNodeToNearestRoot } from '@lexical/utils';
import { $convertFromMarkdownString, $convertToMarkdownString } from '@lexical/markdown';
import { $getRoot, type EditorState } from 'lexical';

import { editorTheme, EDITOR_NODES, LEXICAL_CONTENT_CSS, ToolbarPlugin } from '../lexical/LexicalTextEditor';
import { REPORT_TRANSFORMERS } from '../lexical/report-transformers';
import { QuestionNode, $createQuestionNode } from '../lexical/QuestionNode';
import ChartPicker from './ChartPicker';
import { AssetReference } from '@/lib/types';
import { useAppSelector } from '@/store/hooks';

const REPORT_NODES = [...EDITOR_NODES, QuestionNode];

interface ReportQuestion {
  id: number;
  name: string;
}

interface ReportDocViewProps {
  /** Report markdown (rich text + `:::chart{id=N}` embeds), or null/empty for a blank report. */
  report?: string | null;
  editMode: boolean;
  /** Questions available to insert (the document's asset pool). */
  assets: AssetReference[];
  onChange: (markdown: string) => void;
}

export default function ReportDocView({ report, editMode, assets, onChange }: ReportDocViewProps) {
  const colorMode = useAppSelector(state => state.ui.colorMode);
  const filesBag = useAppSelector(state => state.files.files);

  const questions: ReportQuestion[] = useMemo(
    () => assets
      .filter(a => a.type === 'question')
      .map(a => {
        const id = (a as { id: number }).id;
        return { id, name: filesBag[id]?.name || 'Untitled Question' };
      }),
    [assets, filesBag],
  );

  // Remount the editor when toggling edit/view so it reloads the latest saved state.
  const editorKey = editMode ? 'edit' : 'view';

  // Fill from the report's top to the viewport bottom, so the toolbar stays
  // pinned and only the document scrolls (no scrolling the whole page).
  const rootRef = useRef<HTMLDivElement>(null);
  const [containerHeight, setContainerHeight] = useState('100%');
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const compute = () => {
      const top = el.getBoundingClientRect().top;
      // Fill exactly to the viewport bottom — no gap, so no gray canvas peeks through.
      setContainerHeight(`${Math.max(360, window.innerHeight - top)}px`);
    };
    compute();
    const raf = requestAnimationFrame(compute);
    window.addEventListener('resize', compute);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', compute); };
  }, [editMode]);

  const initialConfig = {
    namespace: 'ReportDocEditor',
    theme: editorTheme,
    onError: (error: Error) => console.error('Lexical (report) error:', error),
    nodes: REPORT_NODES,
    editable: editMode,
    editorState: () => {
      const root = $getRoot();
      root.clear();
      if (report) {
        $convertFromMarkdownString(report, REPORT_TRANSFORMERS, root, true);
      }
    },
  };

  return (
    <Box
      ref={rootRef}
      bg="bg.surface"
      height={containerHeight}
      overflow="auto"
      className={colorMode === 'dark' ? 'lexical-dark' : 'lexical-light'}
    >
      <LexicalComposer key={editorKey} initialConfig={initialConfig}>
        {/* Sticky formatting toolbar (edit mode only) — centered Google-Docs-style pill */}
        {editMode && (
          <Box
            position="sticky"
            top={0}
            zIndex={2}
            display="flex"
            justifyContent="center"
            py={3}
            bg="bg.surface"
          >
            <HStack
              gap={0.5}
              bg="bg.muted"
              borderWidth="1px"
              borderColor="border.default"
              borderRadius="full"
              boxShadow="0 2px 10px rgba(0,0,0,0.06), 0 1px 3px rgba(0,0,0,0.05)"
              px={1.5}
              py={1}
            >
              <ToolbarPlugin />
              <ToolbarDivider />
              <InsertChartControl questions={questions} />
            </HStack>
          </Box>
        )}

        {/* The document — pageless: no page border/shadow, just a clean centered column. */}
        <Box
          maxW="760px"
          mx="auto"
          mt={editMode ? 2 : 10}
          minH="900px"
          css={LEXICAL_CONTENT_CSS}
          position="relative"
        >
          <RichTextPlugin
            contentEditable={
              <ContentEditable
                style={{
                  outline: 'none',
                  padding: '24px 16px 200px',
                  minHeight: '900px',
                  fontSize: '16px',
                  lineHeight: 1.8,
                }}
              />
            }
            placeholder={
              <Box position="absolute" top="24px" left="16px" color="fg.subtle" fontSize="md" pointerEvents="none">
                {editMode ? 'Write your report… use the toolbar to format, or insert a chart.' : 'This report is empty.'}
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
        <MarkdownShortcutPlugin transformers={REPORT_TRANSFORMERS} />
        {editMode && <ReportOnChange onChange={onChange} />}
      </LexicalComposer>
    </Box>
  );
}

/** Debounced serialize-to-markdown on change. */
function ReportOnChange({ onChange }: { onChange: (markdown: string) => void }) {
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const onChangeRef = useRef(onChange);
  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);

  const handleChange = useCallback((editorState: EditorState) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      editorState.read(() => {
        onChangeRef.current($convertToMarkdownString(REPORT_TRANSFORMERS, undefined, true));
      });
    }, 400);
  }, []);

  return <OnChangePlugin onChange={handleChange} ignoreSelectionChange />;
}

/** Thin vertical divider between toolbar groups. */
function ToolbarDivider() {
  return <Box w="1px" h="18px" bg="border.default" mx={1} flexShrink={0} />;
}

/** Insert-chart control: inserts the picked question as a chart node at the cursor. */
function InsertChartControl({ questions }: { questions: ReportQuestion[] }) {
  const [editor] = useLexicalComposerContext();
  const insert = (questionId: number) => {
    editor.update(() => {
      $insertNodeToNearestRoot($createQuestionNode(questionId));
    });
  };
  return <ChartPicker questions={questions} onPick={insert} />;
}
