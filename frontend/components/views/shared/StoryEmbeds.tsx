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
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Provider as ReduxStoreProvider } from 'react-redux';
import { Box, ChakraProvider, EnvironmentProvider } from '@chakra-ui/react';

import { getOrCreateStore } from '@/store/store';
import { withColorModeOverride } from '@/store/color-mode-override';
import { system } from '@/lib/ui/theme';
import SmartEmbeddedQuestionContainer from '@/components/containers/SmartEmbeddedQuestionContainer';
import EmbeddedQuestionContainer from '@/components/containers/EmbeddedQuestionContainer';
import StoryParamControl from '@/components/views/story/StoryParamControl';
import InlineNumber from '@/components/views/story/InlineNumber';
import { HStack, Icon, IconButton, Menu, Portal } from '@chakra-ui/react';
import { LuEllipsis, LuExternalLink } from 'react-icons/lu';
import { storyParamToQuestionParameter, type StoryParam } from '@/lib/data/story/story-params';
import type { InlineNumberEmbed } from '@/lib/data/story/story-number';
import type { InlineQuestionEmbed } from '@/lib/data/story/story-question';
import type { QuestionContent } from '@/lib/types';
import type { VizEnvelope } from '@/lib/validation/atlas-schemas';
import type { NumberQueryEditRequest } from '@/components/views/shared/AgentHtml';

export interface ChartTarget {
  el: HTMLElement;
  questionId: number;
  /** Story-level FULL viz replace for this embed (data-question-viz) — the saved file is untouched. */
  vizOverride?: VizEnvelope | null;
}
export interface NumberTarget { el: HTMLElement; embed: InlineNumberEmbed; }
export interface InlineChartTarget {
  el: HTMLElement;
  content: QuestionContent;
  bare?: boolean;
  /** The raw inline embed (for the edit modal's round-trip back into the story body). */
  embed?: InlineQuestionEmbed;
}
export interface ParamTarget { el: HTMLElement; param: StoryParam; }

/** A request to edit a question embed in the story-level modal (see StoryQuestionEditor). */
export type StoryQuestionEditRequest =
  | { kind: 'saved'; questionId: number; occurrence: number; vizOverride: VizEnvelope | null }
  | { kind: 'inline'; index: number; embed: InlineQuestionEmbed };

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
  /** Story edit mode: opens the question-embed modal (saved / override / ephemeral). */
  onEditQuestion?: (req: StoryQuestionEditRequest) => void;
  /** Path of the hosting story — forwarded to embeds' /api/query so guests pass the embed allowlist. */
  storyPath?: string;
  /**
   * The story surface's color mode (AgentHtml's — the story's declared mode when it has one).
   * Pins `ui.colorMode` for the whole embedded chart stack via a store override, so charts can
   * never theme dark on a light-designed story (or vice versa) when the app mode differs.
   */
  colorMode?: 'light' | 'dark';
}

/**
 * The provider stack every nested-in-iframe story root needs — Redux store re-provider
 * (color-mode pinned to the story's declared mode), Chakra system, and ark-ui environment
 * pinned to the IFRAME document so floating content positions against it. Shared by the
 * legacy placeholder path (StoryEmbeds below) and the JSX interpreter path (StoryJsxBody).
 */
export function StoryEmbedProviders({ doc, colorMode, children }: {
  doc: Document;
  colorMode?: 'light' | 'dark';
  children: ReactNode;
}) {
  // eslint-disable-next-line react-hooks/exhaustive-deps -- getOrCreateStore is a stable singleton
  const store = useMemo(() => withColorModeOverride(getOrCreateStore(), colorMode), [colorMode]);
  return (
    <ReduxStoreProvider store={store}>
      <ChakraProvider value={system}>
        {/* Float ark-ui popovers/menus against the iframe document (not the top document). Context
            flows through every createPortal in the children. */}
        <EnvironmentProvider value={() => doc}>
          {children}
        </EnvironmentProvider>
      </ChakraProvider>
    </ReduxStoreProvider>
  );
}

export default function StoryEmbeds({
  doc, targets, inlineTargets, numberTargets, paramTargets, readOnly, editable, paramValues, onParamValuesChange, onEditNumber, onEditQuestion, storyPath, colorMode,
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

  // Clear the discovery busy stamps (AgentHtml marks every emptied placeholder `data-mx-busy` so
  // the screenshot readiness wait doesn't capture the pre-hydration blank boxes). This effect runs
  // AFTER the portals below commit, so each placeholder already holds its embed's real DOM — and a
  // still-loading embed shows its own busy marker (query spinner / InlineNumber), which readiness
  // keeps waiting on.
  useEffect(() => {
    for (const t of [...targets, ...inlineTargets, ...numberTargets, ...paramTargets]) {
      t.el.removeAttribute('data-mx-busy');
    }
  }, [targets, inlineTargets, numberTargets, paramTargets]);

  return (
    <StoryEmbedProviders doc={doc} colorMode={colorMode}>
          {targets.map((t, i) => createPortal(
            <Box className="mx-chart-fill" bg="bg.subtle" borderWidth="1px" borderColor="border.default" borderRadius="md" overflow="hidden" display="flex" flexDirection="column">
              <SmartEmbeddedQuestionContainer
                questionId={t.questionId}
                vizOverride={t.vizOverride}
                showTitle={true}
                index={i}
                readOnly={readOnly}
                showActionsMenu={editable}
                enableDrilldown={false}
                externalParameters={extParams}
                externalParamValues={extValues}
                onEdit={onEditQuestion ? () => onEditQuestion({
                  kind: 'saved',
                  questionId: t.questionId,
                  // nth placeholder with this id in document order — the write-back transform
                  // (updateSavedQuestionVizInHtml) targets the same occurrence.
                  occurrence: targets.slice(0, i).filter(x => x.questionId === t.questionId).length,
                  vizOverride: t.vizOverride ?? null,
                }) : undefined}
              />
            </Box>,
            t.el,
            `${i}-${t.questionId}`,
          ))}
          {inlineTargets.map((t, i) => createPortal(
            <Box
              className="mx-chart-fill"
              position="relative"
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
              {/* Same "Card actions" menu the saved cards get (SmartEmbeddedQuestionContainer) —
                  inline cards have no title bar, so it floats top-right. */}
              {editable && onEditQuestion && t.embed && (
                <Box position="absolute" top={2} right={2} zIndex={2}>
                  <Menu.Root>
                    <Menu.Trigger asChild>
                      <IconButton
                        variant="ghost"
                        size="xs"
                        aria-label="Card actions"
                        color="fg.muted"
                        _hover={{ color: 'fg.default' }}
                        _focusVisible={{ outline: 'none', boxShadow: 'none' }}
                      >
                        <LuEllipsis />
                      </IconButton>
                    </Menu.Trigger>
                    <Portal>
                      <Menu.Positioner>
                        <Menu.Content
                          minW="180px"
                          bg="bg.surface"
                          borderColor="border.default"
                          shadow="lg"
                          p={1}
                        >
                          <Menu.Item
                            value="edit"
                            cursor="pointer"
                            borderRadius="sm"
                            px={3}
                            py={2}
                            _hover={{ bg: 'bg.muted' }}
                            onClick={() => onEditQuestion({ kind: 'inline', index: i, embed: t.embed! })}
                            aria-label="Edit question"
                          >
                            <HStack gap={2}>
                              <Icon as={LuExternalLink} boxSize={4} />
                              <span>Edit question</span>
                            </HStack>
                          </Menu.Item>
                        </Menu.Content>
                      </Menu.Positioner>
                    </Portal>
                  </Menu.Root>
                </Box>
              )}
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
    </StoryEmbedProviders>
  );
}
