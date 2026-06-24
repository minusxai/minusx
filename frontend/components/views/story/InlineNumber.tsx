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
import { buildQueryParamValues } from '@/lib/sql/sql-params';
import type { InlineNumberEmbed } from '@/lib/data/story-number';
import type { QuestionContent } from '@/lib/types';
import SmartEmbeddedQuestionContainer from '@/components/containers/SmartEmbeddedQuestionContainer';
import EmbeddedQuestionContainer from '@/components/containers/EmbeddedQuestionContainer';

function formatCell(v: unknown): string {
  if (v == null) return '—';
  if (typeof v === 'number') return formatLargeNumber(v);
  return String(v);
}

/** The clickable figure + footnote popover. `children` is the source-question chart. */
function NumberSpan({ embed, text, source }: { embed: InlineNumberEmbed; text: string; source: React.ReactNode }) {
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
              <Box height="300px" overflow="hidden" borderRadius="md">{source}</Box>
            </Popover.Body>
          </Popover.Content>
        </Popover.Positioner>
      </Portal>
    </Popover.Root>
  );
}

/** Saved-question figure: load the question, read its value, show the chart in the footnote. */
function SavedNumber({ id, embed, externalParamValues }: { id: number; embed: InlineNumberEmbed; externalParamValues?: Record<string, unknown> }) {
  useFile(id);
  const content = useAppSelector((s) => selectMergedContent(s, id)) as QuestionContent | undefined;
  const params = buildQueryParamValues(content?.parameters ?? [], content?.parameterValues ?? {}, externalParamValues);
  const { data } = useQueryResult(content?.query ?? '', params, content?.connection_name ?? '', content?.references ?? undefined, {
    skip: !content?.query || !content?.connection_name,
  });
  const col = embed.col ?? data?.columns?.[0];
  const text = formatCell(data?.rows?.[0] && col ? data.rows[0][col] : null);
  return <NumberSpan embed={embed} text={text} source={<SmartEmbeddedQuestionContainer questionId={id} showTitle enableDrilldown={false} />} />;
}

/** Inline-query figure: run the query, read its value, show the result chart in the footnote. */
function InlineQueryNumber({ embed, externalParamValues }: { embed: InlineNumberEmbed; externalParamValues?: Record<string, unknown> }) {
  const params = buildQueryParamValues([], {}, externalParamValues);
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
  return <NumberSpan embed={embed} text={text} source={<EmbeddedQuestionContainer question={previewContent} questionId={0} enableDrilldown={false} />} />;
}

export default function InlineNumber({ embed, externalParamValues }: { embed: InlineNumberEmbed; externalParamValues?: Record<string, unknown> }) {
  // Conditional RENDER (not conditional hooks) so each path calls its hooks unconditionally.
  return embed.id != null
    ? <SavedNumber id={embed.id} embed={embed} externalParamValues={externalParamValues} />
    : <InlineQueryNumber embed={embed} externalParamValues={externalParamValues} />;
}
