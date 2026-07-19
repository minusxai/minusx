'use client';

/**
 * The /debug full-screen visualization (VIEW — no Redux; the container owns
 * data fetching and toggle state). One stacked bar per turn, color-coded by
 * component; two toggles (logs source: projected|raw, cost mode:
 * expected|actual); a totals footer that ALWAYS shows expected AND actual
 * side-by-side (plus Expected Next Cost); click a segment → read-only
 * inspector.
 */
import { useMemo, useState } from 'react';
import { Dialog, Portal, Button, HStack, VStack, Text, Badge, Box, Spinner, SimpleGrid } from '@chakra-ui/react';
import type { ConvoDebugModel } from '@/lib/convo-debug/types';
import type { CostMode } from '@/lib/convo-debug';
import ConvoDebugChart from './ConvoDebugChart';
import ConvoDebugInspectModal from './ConvoDebugInspectModal';

export type LogSource = 'projected' | 'raw';

export type ConvoDebugViewState =
  | { status: 'loading' }
  | { status: 'error'; error: string }
  | { status: 'ready'; model: ConvoDebugModel };

interface ConvoDebugModalProps {
  state: ConvoDebugViewState;
  logSource: LogSource;
  costMode: CostMode;
  colorMode?: 'light' | 'dark';
  onLogSourceChange: (source: LogSource) => void;
  onCostModeChange: (mode: CostMode) => void;
  onClose: () => void;
}

function usd(v: number | null | undefined): string {
  return v == null ? '—' : `$${v.toFixed(4)}`;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <VStack gap={0} align="start">
      <Text fontSize="xs" color="fg.muted">{label}</Text>
      <Text fontSize="sm" fontWeight="bold" aria-label={label.toLowerCase()}>{value}</Text>
    </VStack>
  );
}

/** Segmented two-option control: the selected option is visibly filled and
 *  exposed via aria-pressed. */
function Toggle({ group, options, value, onChange }: {
  group: string;
  options: [string, string];
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <HStack gap={0} borderWidth="1px" borderColor="border.default" borderRadius="md" overflow="hidden">
      {options.map((opt) => (
        <Button
          key={opt}
          size="xs"
          borderRadius={0}
          variant={value === opt ? 'solid' : 'ghost'}
          colorPalette={value === opt ? 'teal' : 'gray'}
          aria-label={`${group}: ${opt}`}
          aria-pressed={value === opt}
          onClick={() => onChange(opt)}
          textTransform="capitalize"
          fontFamily="mono"
        >
          {opt}
        </Button>
      ))}
    </HStack>
  );
}

export default function ConvoDebugModal({
  state,
  logSource,
  costMode,
  colorMode = 'dark',
  onLogSourceChange,
  onCostModeChange,
  onClose,
}: ConvoDebugModalProps) {
  const [inspect, setInspect] = useState<{ barIndex: number; componentIndex: number } | null>(null);

  const model = state.status === 'ready' ? state.model : null;
  const inspected = useMemo(() => {
    if (!model || !inspect) return null;
    const bar = model.bars[inspect.barIndex];
    const component = bar?.components[inspect.componentIndex];
    return bar && component ? { bar, component } : null;
  }, [model, inspect]);

  return (
    <Dialog.Root open onOpenChange={(e) => !e.open && onClose()} size="full">
      <Portal>
        <Dialog.Backdrop zIndex={100000} />
        <Dialog.Positioner zIndex={100000}>
          <Dialog.Content aria-label="conversation debug modal" bg="bg.surface" display="flex" flexDirection="column" h="100vh">
            <Dialog.Header px={5} py={3} borderBottom="1px solid" borderColor="border.default">
              <HStack gap={4} justify="space-between" w="100%">
                <HStack gap={3}>
                  <Text fontWeight="bold" fontSize="md">Conversation debug</Text>
                  {model && <Badge colorPalette="gray" size="sm">{model.bars.length} turns · {model.calls.length} LLM calls</Badge>}
                </HStack>
                <HStack gap={6}>
                  <Toggle
                    group="logs source"
                    options={['projected', 'raw']}
                    value={logSource}
                    onChange={(v) => onLogSourceChange(v as LogSource)}
                  />
                  <Toggle
                    group="cost mode"
                    options={['expected', 'actual']}
                    value={costMode}
                    onChange={(v) => onCostModeChange(v as CostMode)}
                  />
                  <Button variant="ghost" size="sm" onClick={onClose} aria-label="close debug modal">Close</Button>
                </HStack>
              </HStack>
            </Dialog.Header>

            <Dialog.Body p={5} flex="1" display="flex" flexDirection="column" overflow="hidden">
              {state.status === 'loading' && (
                <VStack flex="1" justify="center" aria-label="debug loading">
                  <Spinner size="lg" />
                  <Text fontSize="sm" color="fg.muted">Building conversation model…</Text>
                </VStack>
              )}
              {state.status === 'error' && (
                <VStack flex="1" justify="center" aria-label="debug error">
                  <Text fontSize="sm" color="fg.error">{state.error}</Text>
                </VStack>
              )}
              {state.status === 'ready' && (
                <Box flex="1" display="flex" minH={0}>
                  <ConvoDebugChart
                    bars={state.model.bars}
                    costMode={costMode}
                    colorMode={colorMode}
                    onInspect={(barIndex, componentIndex) => setInspect({ barIndex, componentIndex })}
                  />
                </Box>
              )}
            </Dialog.Body>

            {model && (
              <Box px={5} py={4} borderTop="1px solid" borderColor="border.default">
                <SimpleGrid columns={{ base: 4, md: 8 }} gap={4}>
                  <Stat label="Expected total cost" value={usd(model.totals.expectedTotalUsd)} />
                  <Stat label="Actual total cost" value={usd(model.totals.actualTotalUsd)} />
                  <Stat label="Expected next cost" value={usd(model.totals.expectedNextUsd)} />
                  <Stat label="Total cached input tokens" value={model.totals.cachedInputTokens.toLocaleString()} />
                  <Stat label="Total uncached input tokens" value={model.totals.uncachedInputTokens.toLocaleString()} />
                  <Stat label="Total output tokens" value={model.totals.outputTokens.toLocaleString()} />
                  <Stat label="Text tokens" value={`~${model.totals.expectedTextTokens.toLocaleString()}`} />
                  <Stat label="Image tokens" value={`~${model.totals.expectedImageTokens.toLocaleString()}`} />
                </SimpleGrid>
              </Box>
            )}

            {inspected && inspect && (
              <ConvoDebugInspectModal
                bar={inspected.bar}
                selectedIndex={inspect.componentIndex}
                onClose={() => setInspect(null)}
              />
            )}
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}
