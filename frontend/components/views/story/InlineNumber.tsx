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
import { formatLargeNumber } from '@/lib/chart/chart-format';
import { buildQueryParamValues, bindReferencedParams } from '@/lib/sql/sql-params';
import type { InlineNumberEmbed } from '@/lib/data/story-number';
import type { QuestionContent } from '@/lib/types';
import SmartEmbeddedQuestionContainer from '@/components/containers/SmartEmbeddedQuestionContainer';

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
function NumberSpan({ embed, text, source, query, editable, onEditQuery, loading }: {
  embed: InlineNumberEmbed; text: string; source?: React.ReactNode;
  query?: string; editable?: boolean; onEditQuery?: () => void; loading?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const display = `${embed.prefix ?? ''}${text}${embed.suffix ?? ''}`;
  return (
    // lazyMount + unmountOnExit: mount the popover only while it is open. It portals (below) to the
    // iframe <body> — a sibling of the story content — so an eagerly-mounted closed popover would sit
    // in the serializable body and get baked into content.story on save (the historical bloat bug).
    // Deferring the mount keeps closed popovers out of the DOM entirely; serializeEditedStory also
    // strips any that are open at save time.
    <Popover.Root open={open} onOpenChange={(e) => setOpen(e.open)} positioning={{ placement: 'top' }} lazyMount unmountOnExit>
      <Popover.Trigger asChild>
        <span
          role="button"
          aria-label={`live number ${display}`}
          // Screenshot readiness marker (lib/screenshot/readiness.ts): the capture waits for the
          // figure's query, so it never rasterizes the "—" placeholder as if it were the value.
          {...(loading ? { 'data-mx-busy': 'true' } : {})}
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
              {source != null && (
                <Box height="260px" overflow="hidden" borderRadius="md">{source}</Box>
              )}
            </Popover.Body>
          </Popover.Content>
        </Popover.Positioner>
      </Portal>
    </Popover.Root>
  );
}

/** Saved-question figure: load the question, read its value, show the chart in the footnote. The
 *  query is shown READ-ONLY — editing a saved question's SQL belongs on the question file, not here. */
function SavedNumber({ id, embed, externalParamValues, filePath }: { id: number; embed: InlineNumberEmbed; externalParamValues?: Record<string, unknown>; filePath?: string }) {
  useFile(id);
  const content = useAppSelector((s) => selectMergedContent(s, id)) as QuestionContent | undefined;
  const params = buildQueryParamValues(content?.parameters ?? [], content?.parameterValues ?? {}, externalParamValues);
  const { data, loading } = useQueryResult(content?.query ?? '', params, content?.connection_name ?? '', content?.references ?? undefined, {
    skip: !content?.query || !content?.connection_name, filePath,
  });
  const col = embed.col ?? data?.columns?.[0];
  const text = formatCell(data?.rows?.[0] && col ? data.rows[0][col] : null);
  // Show the saved question's chart in the footnote — but skip a single_value question, whose
  // "chart" is just the figure again (a redundant empty block, like the inline case).
  const showChart = content?.vizSettings?.type !== 'single_value';
  return <NumberSpan embed={embed} text={text} query={content?.query ?? undefined} loading={loading}
    source={showChart ? <SmartEmbeddedQuestionContainer questionId={id} showTitle enableDrilldown={false} /> : undefined} />;
}

/** Inline-query figure: run the query, read its value, show the result chart in the footnote. In
 *  edit mode the popover offers "Edit query", which opens the full SqlEditor drawer (onRequestEdit). */
function InlineQueryNumber({ embed, externalParamValues, editable, onRequestEdit, filePath }: {
  embed: InlineNumberEmbed; externalParamValues?: Record<string, unknown>;
  editable?: boolean; onRequestEdit?: () => void; filePath?: string;
}) {
  // Bind the story <Param> values this number's SQL references (`:name`) so a reader's slider /
  // the story's default params drive the figure live. Same helper the augmentation uses → the
  // rendered number and the agent-seen number share a cache key.
  const params = bindReferencedParams(embed.query, externalParamValues);
  const { data, loading } = useQueryResult(embed.query ?? '', params, embed.connection ?? '', undefined, {
    skip: !embed.query || !embed.connection, filePath,
  });
  const col = embed.col ?? data?.columns?.[0];
  const text = formatCell(data?.rows?.[0] && col ? data.rows[0][col] : null);
  // No source chart in the footnote: an inline number's "chart" is a single_value of the same
  // query — identical to the figure already shown, and it left an empty white block. The popover
  // shows the SQL (the useful trace) instead.
  return <NumberSpan embed={embed} text={text} query={embed.query} editable={editable} onEditQuery={onRequestEdit} loading={loading} />;
}

export default function InlineNumber({ embed, externalParamValues, editable, onRequestEdit, filePath }: {
  embed: InlineNumberEmbed; externalParamValues?: Record<string, unknown>;
  editable?: boolean; onRequestEdit?: () => void;
  /** Path of the page hosting this number — forwarded to /api/query so guests pass the embed allowlist. */
  filePath?: string;
}) {
  // Conditional RENDER (not conditional hooks) so each path calls its hooks unconditionally.
  return embed.id != null
    ? <SavedNumber id={embed.id} embed={embed} externalParamValues={externalParamValues} filePath={filePath} />
    : <InlineQueryNumber embed={embed} externalParamValues={externalParamValues} editable={editable} onRequestEdit={onRequestEdit} filePath={filePath} />;
}
