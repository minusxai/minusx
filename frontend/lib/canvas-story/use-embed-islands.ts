'use client';

import { useMemo, useState } from 'react';
import type { ChartTarget, InlineChartTarget, NumberTarget, ParamTarget } from '@/components/views/shared/StoryEmbeds';
import type { StoryEmbedBox, StoryRasterResult } from '@/lib/canvas-story/types';
import { inlineQuestionFromEl, inlineEmbedToQuestionContent, savedQuestionVizFromEl } from '@/lib/data/story/story-question';
import { envelopeVizType } from '@/lib/viz/viz-templates';
import { numberFromEl } from '@/lib/data/story/story-number';
import { paramFromPlaceholderEl } from '@/lib/data/story/story-params';

/**
 * Live embed islands over the raster: turns the raster's embed boxes into mounted
 * host elements + StoryEmbeds targets.
 *
 * Owns the host-element registry (identity-stable ref callbacks — a fresh callback
 * per render makes React detach/reattach every ref, and the resulting setState
 * ping-pong loops) and the translation from placeholder attributes to the exact
 * target shapes the production StoryEmbeds component consumes. The attribute maps
 * are adapted through a getAttribute shim so the DOM-path parsers are reused as-is.
 */
export interface EmbedIslands {
  embeds: StoryEmbedBox[];
  /** Live host element per embed index (set as islands mount). */
  islandEls: Record<number, HTMLElement | null>;
  /** Stable ref callback per embed index — attach to the island host element. */
  islandRefs: Map<number, (el: HTMLElement | null) => void>;
  targets: {
    charts: ChartTarget[];
    inline: InlineChartTarget[];
    numbers: NumberTarget[];
    params: ParamTarget[];
    count: number;
  };
}

const attrShim = (e: StoryEmbedBox) => ({ getAttribute: (name: string) => e.attributes[name] ?? null });

export function useEmbedIslands(result: StoryRasterResult | null): EmbedIslands {
  const [islandEls, setIslandEls] = useState<Record<number, HTMLElement | null>>({});
  const embeds = useMemo(() => result?.embeds ?? [], [result]);

  const islandRefs = useMemo(() => {
    const map = new Map<number, (el: HTMLElement | null) => void>();
    for (const e of embeds) {
      map.set(e.index, (el: HTMLElement | null) => {
        setIslandEls(prev => (prev[e.index] === el ? prev : { ...prev, [e.index]: el }));
      });
    }
    return map;
  }, [embeds]);

  const targets = useMemo(() => {
    const charts: ChartTarget[] = [];
    const inline: InlineChartTarget[] = [];
    const numbers: NumberTarget[] = [];
    const params: ParamTarget[] = [];
    for (const e of embeds) {
      const el = islandEls[e.index];
      if (!el) continue;
      if (e.kind === 'question') {
        const questionId = parseInt(e.ref, 10);
        if (!Number.isNaN(questionId)) charts.push({ el, questionId, vizOverride: savedQuestionVizFromEl(attrShim(e)) });
      } else if (e.kind === 'question-inline') {
        const embed = inlineQuestionFromEl(attrShim(e));
        if (embed) inline.push({ el, content: inlineEmbedToQuestionContent(embed), bare: envelopeVizType(embed.viz) === 'single_value', embed });
      } else if (e.kind === 'number-inline') {
        const embed = numberFromEl(attrShim(e));
        if (embed) numbers.push({ el, embed });
      } else {
        const param = paramFromPlaceholderEl(attrShim(e));
        if (param) params.push({ el, param });
      }
    }
    return { charts, inline, numbers, params, count: charts.length + inline.length + numbers.length + params.length };
  }, [embeds, islandEls]);

  return { embeds, islandEls, islandRefs, targets };
}
