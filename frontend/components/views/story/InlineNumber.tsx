'use client';

/**
 * InlineNumber — renders a story `<Number/>` embed as a LIVE figure inside the prose (a styled
 * <span>, not a chart card). Polymorphic: a saved question (`id`) or an inline query (`query`).
 * The agent styles it freely via `style`. A subtle dotted underline marks it as traceable: click
 * it to reveal the source question's chart in a popover (footnote-style).
 */
import { useState } from 'react';
import { Box, Popover, Portal } from '@chakra-ui/react';
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
 * The footnote's query panel: shows the SQL the figure runs (so it's auditable). For an inline
 * `<Number query>` in the story's EDIT mode it becomes editable — Apply writes the new query back
 * to the body. Native <textarea>/<pre> with inline styles (shadow-boundary safe, like the param
 * controls). `key`-resetting the textarea on a new `query` keeps the draft in sync after Apply.
 */
function QueryPanel({ query, editable, onApply }: { query: string; editable?: boolean; onApply?: (q: string) => void }) {
  const [draft, setDraft] = useState(query);
  const wrap: CSSProperties = { padding: '10px 12px', borderBottom: '1px solid #e5e7eb', background: '#fff' };
  const label: CSSProperties = { fontSize: '10px', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#6b7280', marginBottom: '4px' };
  const mono: CSSProperties = { fontFamily: 'ui-monospace, Menlo, monospace', fontSize: '11px', color: '#111827', whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0, maxHeight: '120px', overflow: 'auto' };
  if (editable && onApply) {
    return (
      <div style={wrap}>
        <div style={label}>Inline query — edit &amp; apply</div>
        <textarea
          aria-label="inline number query"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={5}
          style={{ ...mono, width: '100%', boxSizing: 'border-box', border: '1px solid #d1d5db', borderRadius: '6px', padding: '6px', resize: 'vertical' }}
        />
        <button
          type="button"
          aria-label="apply inline number query"
          disabled={draft === query}
          onClick={() => onApply(draft)}
          style={{ marginTop: '6px', fontSize: '11px', fontWeight: 600, padding: '4px 10px', borderRadius: '6px', border: '1px solid #d1d5db', background: draft === query ? '#f3f4f6' : '#c8781a', color: draft === query ? '#9ca3af' : '#fff', cursor: draft === query ? 'default' : 'pointer' }}
        >
          Apply
        </button>
      </div>
    );
  }
  return (
    <div style={wrap}>
      <div style={label}>Source query</div>
      <pre aria-label="inline number query" style={mono}>{query}</pre>
    </div>
  );
}

/** The clickable figure + footnote popover. `source` is the source-question chart. */
function NumberSpan({ embed, text, source, query, editable, onEditQuery }: {
  embed: InlineNumberEmbed; text: string; source: React.ReactNode;
  query?: string; editable?: boolean; onEditQuery?: (q: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const display = `${embed.prefix ?? ''}${text}${embed.suffix ?? ''}`;
  return (
    <Popover.Root open={open} onOpenChange={(e) => setOpen(e.open)} positioning={{ placement: 'top' }}>
      <Popover.Trigger asChild>
        <span
          role="button"
          aria-label={`live number ${display}`}
          // dotted underline = "traceable to a question"; the agent's style still wins.
          style={{ cursor: 'pointer', textDecoration: 'underline dotted', textUnderlineOffset: '3px', ...(embed.style as CSSProperties) }}
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
                <QueryPanel key={query} query={query} editable={editable} onApply={onEditQuery} />
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
 *  edit mode the query is editable (onEditQuery writes it back to the story body). */
function InlineQueryNumber({ embed, externalParamValues, editable, onEmbedChange }: {
  embed: InlineNumberEmbed; externalParamValues?: Record<string, unknown>;
  editable?: boolean; onEmbedChange?: (next: InlineNumberEmbed) => void;
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
    onEditQuery={onEmbedChange ? (q) => onEmbedChange({ ...embed, query: q }) : undefined}
    source={<EmbeddedQuestionContainer question={previewContent} questionId={0} enableDrilldown={false} />} />;
}

export default function InlineNumber({ embed, externalParamValues, editable, onEmbedChange }: {
  embed: InlineNumberEmbed; externalParamValues?: Record<string, unknown>;
  editable?: boolean; onEmbedChange?: (next: InlineNumberEmbed) => void;
}) {
  // Conditional RENDER (not conditional hooks) so each path calls its hooks unconditionally.
  return embed.id != null
    ? <SavedNumber id={embed.id} embed={embed} externalParamValues={externalParamValues} />
    : <InlineQueryNumber embed={embed} externalParamValues={externalParamValues} editable={editable} onEmbedChange={onEmbedChange} />;
}
