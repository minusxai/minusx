'use client';

/**
 * StoryEmbeds — the live React content of a story, rendered into a NESTED React root that lives
 * INSIDE the story iframe (see AgentHtml). It re-provides the app contexts the embeds need
 * (Redux store, Chakra system, ark-ui environment) because a nested root has its own provider tree,
 * then portals each embed (chart / inline question / inline number / param control) into its authored
 * placeholder element in the iframe document.
 *
 * Why a nested root (vs. portaling from the main root like the old shadow-DOM version did): iframe
 * DOM events do NOT bubble into the parent document, so React's event delegation — attached to the
 * MAIN root — would never see clicks/changes inside the iframe. A root mounted in the iframe delegates
 * to the iframe document, so all interactivity (param filters re-running queries, inline-number
 * editing, chart-card clicks) works. The single top-level EnvironmentProvider flows through every
 * portal (React context crosses portals), so popovers/menus position against the iframe document.
 */
import { createPortal } from 'react-dom';
import { useState } from 'react';
import { Provider as ReduxStoreProvider } from 'react-redux';
import { Box, ChakraProvider, EnvironmentProvider } from '@chakra-ui/react';

import { getOrCreateStore } from '@/store/store';
import { system } from '@/lib/ui/theme';
import SmartEmbeddedQuestionContainer from '@/components/containers/SmartEmbeddedQuestionContainer';
import EmbeddedQuestionContainer from '@/components/containers/EmbeddedQuestionContainer';
import StoryParamControl from '@/components/views/story/StoryParamControl';
import InlineNumber from '@/components/views/story/InlineNumber';
import { storyParamToQuestionParameter, type StoryParam } from '@/lib/data/story-params';
import type { InlineNumberEmbed } from '@/lib/data/story-number';
import type { QuestionContent } from '@/lib/types';
import type { NumberQueryEditRequest } from '@/components/views/shared/AgentHtml';

export interface ChartTarget { el: HTMLElement; questionId: number; }
export interface NumberTarget { el: HTMLElement; embed: InlineNumberEmbed; }
export interface InlineChartTarget { el: HTMLElement; content: QuestionContent; bare?: boolean; }
export interface ParamTarget { el: HTMLElement; param: StoryParam; }

export interface StoryEmbedsProps {
  /** The iframe's document — portal targets live here; ark-ui floats against it. */
  doc: Document;
  targets: ChartTarget[];
  inlineTargets: InlineChartTarget[];
  numberTargets: NumberTarget[];
  paramTargets: ParamTarget[];
  readOnly: boolean;
  editable: boolean;
  /** Default/current shared param values (keyed by `<Param name>`); seeded once. */
  paramValues?: Record<string, unknown>;
  onParamValuesChange?: (values: Record<string, unknown>) => void;
  onEditNumber?: (req: NumberQueryEditRequest) => void;
  /** Path of the hosting story — forwarded to embeds' /api/query so guests pass the embed allowlist. */
  storyPath?: string;
}

export default function StoryEmbeds({
  doc, targets, inlineTargets, numberTargets, paramTargets, readOnly, editable, paramValues, onParamValuesChange, onEditNumber, storyPath,
}: StoryEmbedsProps) {
  // Shared param context (reader's current values), seeded once from the story defaults. StoryEmbeds
  // remounts (with the iframe) when the story content changes, re-seeding.
  const [values, setValues] = useState<Record<string, unknown>>(paramValues ?? {});
  const setParamValue = (name: string, v: unknown) => setValues(prev => {
    const next = { ...prev, [name]: v };
    onParamValuesChange?.(next);
    return next;
  });
  const externalParameters = paramTargets.map(t => storyParamToQuestionParameter(t.param));
  const extParams = externalParameters.length ? externalParameters : undefined;
  const extValues = externalParameters.length ? values : undefined;

  return (
    <ReduxStoreProvider store={getOrCreateStore()}>
      <ChakraProvider value={system}>
        {/* Float ark-ui popovers/menus against the iframe document (not the top document). Context
            flows through every createPortal below. */}
        <EnvironmentProvider value={() => doc}>
          {targets.map((t, i) => createPortal(
            <Box className="mx-chart-fill" bg="bg.subtle" borderWidth="1px" borderColor="border.default" borderRadius="md" overflow="hidden" display="flex" flexDirection="column">
              <SmartEmbeddedQuestionContainer
                questionId={t.questionId}
                showTitle={true}
                index={i}
                readOnly={readOnly}
                enableDrilldown={false}
                externalParameters={extParams}
                externalParamValues={extValues}
              />
            </Box>,
            t.el,
            `${i}-${t.questionId}`,
          ))}
          {inlineTargets.map((t, i) => createPortal(
            <Box
              className="mx-chart-fill"
              {...(t.bare ? {} : { bg: 'bg.subtle', borderWidth: '1px', borderColor: 'border.default', borderRadius: 'md' })}
              overflow="hidden"
              display="flex"
              flexDirection="column"
            >
              <EmbeddedQuestionContainer
                question={t.content}
                questionId={0}
                externalParameters={extParams}
                externalParamValues={extValues}
                enableDrilldown={false}
                filePath={storyPath}
              />
            </Box>,
            t.el,
            `inline-${i}`,
          ))}
          {numberTargets.map((t, i) => createPortal(
            <InlineNumber
              embed={t.embed}
              externalParamValues={extValues}
              editable={editable}
              filePath={storyPath}
              onRequestEdit={(editable && onEditNumber && t.embed.query) ? () => onEditNumber({
                query: t.embed.query ?? '',
                connection: t.embed.connection,
                apply: (newQuery) => {
                  const next = { ...t.embed, query: newQuery };
                  t.el.setAttribute('data-number-inline', JSON.stringify(next));
                },
              }) : undefined}
            />,
            t.el,
            `number-${i}`,
          ))}
          {paramTargets.map((t, i) => createPortal(
            <StoryParamControl param={t.param} value={values[t.param.name]} onChange={(v) => setParamValue(t.param.name, v)} />,
            t.el,
            `param-${i}-${t.param.name}`,
          ))}
        </EnvironmentProvider>
      </ChakraProvider>
    </ReduxStoreProvider>
  );
}
