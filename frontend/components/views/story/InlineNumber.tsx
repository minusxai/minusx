'use client';

/**
 * InlineNumber — renders a story `<Number/>` embed as a LIVE figure inside the prose (a styled
 * <span>, not a chart card). Polymorphic: a saved question (`id`) or an inline query (`query`).
 * The agent styles it freely via `style` (no opinionated default decoration). It stays traceable:
 * click it to reveal the source question's chart in a popover (footnote-style).
 */
import { useState } from 'react';
import { Box, Button, Popover, Portal } from '@chakra-ui/react';
import { LuPencil } from 'react-icons/lu';
import type { CSSProperties } from 'react';
import { useFile, useQueryResult } from '@/lib/hooks/file-state-hooks';
import { useAppSelector } from '@/store/hooks';
import { selectMergedContent } from '@/store/filesSlice';
import { formatLargeNumber } from '@/lib/chart/chart-utils';
import { buildQueryParamValues, bindReferencedParams } from '@/lib/sql/sql-params';
import type { InlineNumberEmbed } from '@/lib/data/story-number';
import type { QuestionContent } from '@/lib/types';
import SmartEmbeddedQuestionContainer from '@/components/containers/SmartEmbeddedQuestionContainer';
import EmbeddedQuestionContainer from '@/components/containers/EmbeddedQuestionContainer';

function formatCell(v: unknown): string {
  if (v == null) return '—';
  if (typeof v === 'number') return formatLargeNumber(v);
  return String(v);
}

/**
 * The footnote's query panel: shows the SQL the figure runs (read-only, for tracing). Editing the
 * inline query opens the FULL SqlEditor (with autocomplete) in a light-DOM drawer at the StoryView
 * level — Monaco's floating widgets (suggest/hover) mis-anchor inside the story shadow root, so the
 * editor must live outside it. In edit mode this panel just offers the "Edit query" trigger.
 */
function QueryPanel({ query, editable, onEdit }: { query: string; editable?: boolean; onEdit?: () => void }) {
  const wrap: CSSProperties = { padding: '10px 12px', borderBottom: '1px solid #e5e7eb', background: '#fafafa' };
  const label: CSSProperties = { fontSize: '10px', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#6b7280', marginBottom: '4px' };
  const mono: CSSProperties = { fontFamily: 'ui-monospace, Menlo, monospace', fontSize: '11px', color: '#111827', whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0, maxHeight: '120px', overflow: 'auto' };
  return (
    <div style={wrap}>
      <div style={label}>Source query</div>
      <pre aria-label="inline number query" style={mono}>{query}</pre>
      {editable && onEdit && (
        <Button size="xs" mt={2} variant="outline" aria-label="edit inline number query" onClick={onEdit}>
          <LuPencil /> Edit query
        </Button>
      )}
    </div>
  );
}

/** The clickable figure + footnote popover. `source` is the source-question chart. `onEditQuery`
 *  (inline numbers, edit mode) opens the full SqlEditor drawer at the StoryView level. */
function NumberSpan({ embed, text, source, query, editable, onEditQuery }: {
  embed: InlineNumberEmbed; text: string; source: React.ReactNode;
  query?: string; editable?: boolean; onEditQuery?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const display = `${embed.prefix ?? ''}${text}${embed.suffix ?? ''}`;
  return (
    <Popover.Root open={open} onOpenChange={(e) => setOpen(e.open)} positioning={{ placement: 'top' }}>
      <Popover.Trigger asChild>
        <span
          role="button"
          aria-label={`live number ${display}`}
          // No default decoration — the agent styles the figure via `style` (add an underline
          // only if it wants one). cursor:pointer hints it's clickable → reveals the source.
          style={{ cursor: 'pointer', ...(embed.style as CSSProperties) }}
        >
          {display}
        </span>
      </Popover.Trigger>
      <Portal>
        <Popover.Positioner>
          <Popover.Content width="420px" maxW="90vw">
            <Popover.Arrow />
            <Popover.Body p={0}>
              {query != null && query !== '' && (
                <QueryPanel key={query} query={query} editable={editable} onEdit={onEditQuery} />
              )}
              <Box height="260px" overflow="hidden" borderRadius="md">{source}</Box>
            </Popover.Body>
          </Popover.Content>
        </Popover.Positioner>
      </Portal>
    </Popover.Root>
  );
}

/** Saved-question figure: load the question, read its value, show the chart in the footnote. The
 *  query is shown READ-ONLY — editing a saved question's SQL belongs on the question file, not here. */
function SavedNumber({ id, embed, externalParamValues }: { id: number; embed: InlineNumberEmbed; externalParamValues?: Record<string, unknown> }) {
  useFile(id);
  const content = useAppSelector((s) => selectMergedContent(s, id)) as QuestionContent | undefined;
  const params = buildQueryParamValues(content?.parameters ?? [], content?.parameterValues ?? {}, externalParamValues);
  const { data } = useQueryResult(content?.query ?? '', params, content?.connection_name ?? '', content?.references ?? undefined, {
    skip: !content?.query || !content?.connection_name,
  });
  const col = embed.col ?? data?.columns?.[0];
  const text = formatCell(data?.rows?.[0] && col ? data.rows[0][col] : null);
  return <NumberSpan embed={embed} text={text} query={content?.query ?? undefined}
    source={<SmartEmbeddedQuestionContainer questionId={id} showTitle enableDrilldown={false} />} />;
}

/** Inline-query figure: run the query, read its value, show the result chart in the footnote. In
 *  edit mode the popover offers "Edit query", which opens the full SqlEditor drawer (onRequestEdit). */
function InlineQueryNumber({ embed, externalParamValues, editable, onRequestEdit }: {
  embed: InlineNumberEmbed; externalParamValues?: Record<string, unknown>;
  editable?: boolean; onRequestEdit?: () => void;
}) {
  // Bind the story <Param> values this number's SQL references (`:name`) so a reader's slider /
  // the story's default params drive the figure live. Same helper the augmentation uses → the
  // rendered number and the agent-seen number share a cache key.
  const params = bindReferencedParams(embed.query, externalParamValues);
  const { data } = useQueryResult(embed.query ?? '', params, embed.connection ?? '', undefined, {
    skip: !embed.query || !embed.connection,
  });
  const col = embed.col ?? data?.columns?.[0];
  const text = formatCell(data?.rows?.[0] && col ? data.rows[0][col] : null);
  const previewContent: QuestionContent = {
    description: null, query: embed.query ?? '', connection_name: embed.connection ?? '',
    vizSettings: { type: 'single_value', yCols: col ? [col] : null } as QuestionContent['vizSettings'],
    parameters: [], parameterValues: null, references: null,
  };
  return <NumberSpan embed={embed} text={text} query={embed.query} editable={editable}
    onEditQuery={onRequestEdit}
    source={<EmbeddedQuestionContainer question={previewContent} questionId={0} enableDrilldown={false} />} />;
}

export default function InlineNumber({ embed, externalParamValues, editable, onRequestEdit }: {
  embed: InlineNumberEmbed; externalParamValues?: Record<string, unknown>;
  editable?: boolean; onRequestEdit?: () => void;
}) {
  // Conditional RENDER (not conditional hooks) so each path calls its hooks unconditionally.
  return embed.id != null
    ? <SavedNumber id={embed.id} embed={embed} externalParamValues={externalParamValues} />
    : <InlineQueryNumber embed={embed} externalParamValues={externalParamValues} editable={editable} onRequestEdit={onRequestEdit} />;
}
