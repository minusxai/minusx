'use client';

import type { ComponentProps } from 'react';
import { Box, VStack, HStack, Text, Icon, IconButton, Spinner, Grid, GridItem } from '@chakra-ui/react';
import { LuX } from 'react-icons/lu';
import type { ContextSizeEstimate, ContextSizeSection } from '@/lib/chat/context-size-estimate';
import { cachedTokensPerSection } from '@/lib/chat/context-size-estimate';

const CONTEXT_SIZE_LIMIT_TOKENS = 100_000;
const CONTEXT_SIZE_SQUARES = 100;

// Named color per section key — keeps a section's color stable regardless of its
// position/order in the breakdown (and regardless of which sections are zero).
const SECTION_COLORS: Record<string, string> = {
  system_prompt: 'accent.teal',
  tool_definitions: 'accent.danger',
  tool_call_history: 'accent.success',
  conversation_history: 'accent.warning',
  app_state: 'accent.secondary',
  file_markup: 'accent.primary',
  text_attachments: 'accent.muted',
  image_attachments: 'accent.cyan',
  current_date: 'accent.muted',
  next_user_message: 'accent.teal',
  misc_other: 'fg.default',
};
const FALLBACK_SECTION_COLOR = 'fg.muted';

function sectionColor(key: string): string {
  return SECTION_COLORS[key] ?? FALLBACK_SECTION_COLOR;
}

function squareColorForIndex(
  index: number,
  sections: ContextSizeSection[],
  limitTokens: number,
): string | null {
  const tokenPosition = ((index + 0.5) / CONTEXT_SIZE_SQUARES) * limitTokens;
  let cumulative = 0;
  for (const section of sections) {
    cumulative += section.tokens;
    if (tokenPosition <= cumulative) return sectionColor(section.key);
  }
  return null;
}

export type ContextSizePanelState =
  | { status: 'loading' }
  // `cachedTokens` = tokens the provider served from cache on the LAST turn (usage.cacheRead).
  // Shown as black-bordered squares over the prefix so we can see how much of the context is
  // actually being cached (cache effectiveness) vs re-billed each turn.
  | { status: 'ready'; estimate: ContextSizeEstimate; cachedTokens?: number }
  | { status: 'error'; error: string };

export function ContextSizePanel({
  state,
  onClose,
  colSpan,
  colStart,
}: {
  state: ContextSizePanelState;
  onClose: () => void;
  colSpan: ComponentProps<typeof GridItem>['colSpan'];
  colStart: ComponentProps<typeof GridItem>['colStart'];
}) {
  const estimate = state.status === 'ready' ? state.estimate : null;
  const cachedTokens = state.status === 'ready' ? (state.cachedTokens ?? 0) : 0;
  const totalTokens = estimate?.totalTokens ?? 0;
  const percent = estimate ? Math.min(999, Math.round((totalTokens / CONTEXT_SIZE_LIMIT_TOKENS) * 100)) : 0;
  const filledSquares = estimate
    ? Math.min(CONTEXT_SIZE_SQUARES, Math.ceil((totalTokens / CONTEXT_SIZE_LIMIT_TOKENS) * CONTEXT_SIZE_SQUARES))
    : 0;
  // Cached prefix (last turn) — the leading N squares get a black border.
  const cachedSquares = estimate && cachedTokens > 0
    ? Math.min(CONTEXT_SIZE_SQUARES, Math.round((cachedTokens / CONTEXT_SIZE_LIMIT_TOKENS) * CONTEXT_SIZE_SQUARES))
    : 0;
  const displaySections = estimate ? estimate.sections : [];
  // How many tokens of EACH section the provider served from cache last turn (prefix overlap).
  const cachedPerSection = cachedTokensPerSection(displaySections, cachedTokens);

  return (
    <Grid templateColumns={{ base: 'repeat(12, 1fr)', md: 'repeat(12, 1fr)' }} gap={2} w="100%">
      <GridItem colSpan={colSpan} colStart={colStart}>
        <Box
          bg="bg.muted"
          borderWidth="1px"
          borderColor={totalTokens > CONTEXT_SIZE_LIMIT_TOKENS ? 'accent.warning' : 'border.default'}
          borderRadius="md"
          px={3}
          py={2.5}
          mb={3}
          fontFamily="mono"
        >
          <HStack justify="space-between" align="start" gap={3}>
            <VStack align="stretch" gap={2} flex="1" minW={0}>
              <HStack gap={2} justify="space-between" align="center">
                <Text fontSize="xs" fontWeight="700" color="fg.default">
                  Estimated next context
                </Text>
                {estimate && (
                  <Text fontSize="xs" color={totalTokens > CONTEXT_SIZE_LIMIT_TOKENS ? 'accent.warning' : 'fg.muted'}>
                    {totalTokens.toLocaleString()} / {CONTEXT_SIZE_LIMIT_TOKENS.toLocaleString()} tokens ({percent}%)
                  </Text>
                )}
              </HStack>

              {state.status === 'loading' && (
                <HStack gap={2} color="fg.muted">
                  <Spinner size="xs" />
                  <Text fontSize="xs">Estimating context...</Text>
                </HStack>
              )}

              {state.status === 'error' && (
                <Text fontSize="xs" color="accent.danger">{state.error}</Text>
              )}

              {estimate && (
                <>
                  <Box
                    display="grid"
                    gridTemplateColumns="repeat(10, 10px)"
                    gap="3px"
                    justifyContent="center"
                    mx="auto"
                    aria-label="context size squares"
                  >
                    {Array.from({ length: CONTEXT_SIZE_SQUARES }, (_, index) => {
                      const color = index < filledSquares
                        ? squareColorForIndex(index, estimate.sections, CONTEXT_SIZE_LIMIT_TOKENS)
                        : null;
                      // Cached prefix (last turn) → black border so cache coverage is visible.
                      const isCached = index < cachedSquares;
                      return (
                        <Box
                          key={index}
                          w="10px"
                          h="10px"
                          borderRadius="2px"
                          bg={color ?? 'bg.canvas'}
                          border={isCached ? '1.5px solid' : '1px solid'}
                          borderColor={isCached ? 'black' : (color ? color : 'border.muted')}
                        />
                      );
                    })}
                  </Box>

                  <VStack align="stretch" gap={1}>
                    {/* Column header: each row shows how many of its tokens were cached last turn
                        (served from the provider prefix cache) vs the section's total. */}
                    <HStack gap={2} justify="space-between" fontSize="2xs" color="fg.subtle" aria-label="section token columns">
                      <Text truncate minW={0}>Section</Text>
                      <HStack gap={3} flexShrink={0}>
                        <HStack gap={1} flexShrink={0}>
                          <Box w="7px" h="7px" border="1.5px solid" borderColor="black" borderRadius="1px" flexShrink={0} />
                          <Text>cached</Text>
                        </HStack>
                        <Text w="14ch" textAlign="right">cached / total</Text>
                      </HStack>
                    </HStack>
                    {displaySections.map((section, i) => {
                      const cached = cachedPerSection[i] ?? 0;
                      return (
                        <HStack key={section.key} gap={2} justify="space-between" fontSize="2xs" color="fg.muted"
                          aria-label={`section ${section.key} tokens`}>
                          <HStack gap={1.5} minW={0}>
                            <Box w="8px" h="8px" bg={sectionColor(section.key)} borderRadius="1px" flexShrink={0} />
                            <Text truncate>{section.label}</Text>
                          </HStack>
                          <Text flexShrink={0} w="14ch" textAlign="right">
                            <Text as="span" color={cached > 0 ? 'fg.default' : 'fg.subtle'}>{cached.toLocaleString()}</Text>
                            {' / '}
                            {section.tokens.toLocaleString()} tok
                          </Text>
                        </HStack>
                      );
                    })}
                  </VStack>
                </>
              )}
            </VStack>

            <IconButton
              aria-label={state.status === 'loading' ? 'Cancel context size estimate' : 'Close context size estimate'}
              size="2xs"
              variant="ghost"
              color="fg.muted"
              onClick={onClose}
              flexShrink={0}
            >
              <Icon as={LuX} boxSize={3.5} />
            </IconButton>
          </HStack>
        </Box>
      </GridItem>
    </Grid>
  );
}
