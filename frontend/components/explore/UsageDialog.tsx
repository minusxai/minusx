'use client';

import { useEffect, useState } from 'react';
import { Dialog, Portal, VStack, HStack, Text, Box, Progress, Spinner, CloseButton } from '@chakra-ui/react';
import { LuZap } from 'react-icons/lu';
import type { CreditUsageResponse, CreditWindow } from '@/lib/analytics/credits.types';

const nf = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

function fmtReset(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** One window row: label, used/allowance, % bar, next-reset caption. */
function WindowRow({ label, window }: { label: string; window: CreditWindow }) {
  const pct = window.allowance > 0 ? Math.min(100, (window.used / window.allowance) * 100) : 0;
  const over = window.used > window.allowance;
  return (
    <VStack align="stretch" gap={1}>
      <HStack justify="space-between">
        <Text fontSize="sm" fontFamily="mono">{label}</Text>
        <Text fontSize="sm" fontFamily="mono" color={over ? 'accent.danger' : 'fg.muted'}>
          {nf.format(window.used)} / {nf.format(window.allowance)} · {Math.round(pct)}%
        </Text>
      </HStack>
      <Progress.Root value={pct} size="sm" colorPalette={over ? 'red' : 'teal'}>
        <Progress.Track><Progress.Range /></Progress.Track>
      </Progress.Root>
      <Text fontSize="xs" color="fg.muted" fontFamily="mono">Resets {fmtReset(window.resetsAt)}</Text>
    </VStack>
  );
}

/**
 * `/usage` command surface: this conversation's credit spend + the signed-in
 * user's daily (reset) and weekly/monthly (billing) windows with % used and next
 * reset. Reads GET /api/credits/usage?conversationId=…, scoped to the user.
 */
export default function UsageDialog({ conversationID, onClose }: { conversationID: number; onClose: () => void }) {
  const [data, setData] = useState<CreditUsageResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/credits/usage?conversationId=${conversationID}`);
        if (!res.ok) throw new Error(`Failed to load usage (${res.status})`);
        const body = await res.json();
        if (!cancelled) setData(body.data as CreditUsageResponse);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load usage');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [conversationID]);

  return (
    <Dialog.Root open onOpenChange={(e) => { if (!e.open) onClose(); }} size="sm">
      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content aria-label="Usage">
            <Dialog.Header>
              <HStack gap={2}><LuZap /><Dialog.Title fontFamily="mono">Usage</Dialog.Title></HStack>
              <Dialog.CloseTrigger asChild><CloseButton aria-label="Close usage" size="sm" /></Dialog.CloseTrigger>
            </Dialog.Header>
            <Dialog.Body>
              {loading ? <HStack justify="center" py={8}><Spinner /></HStack>
                : error ? <Text color="accent.danger" fontFamily="mono" fontSize="sm">{error}</Text>
                : data ? (
                  <VStack align="stretch" gap={5}>
                    <Box p={3} borderWidth="1px" borderColor="border.default" borderRadius="md" bg="bg.surface">
                      <Text fontSize="xs" color="fg.muted" fontFamily="mono" textTransform="uppercase" letterSpacing="0.05em">This conversation</Text>
                      <Text fontSize="xl" fontWeight="semibold" fontFamily="mono">{nf.format(data.conversation?.credits ?? 0)} credits</Text>
                    </Box>
                    <WindowRow label={data.individual.reset.label} window={data.individual.reset} />
                    <WindowRow label={data.individual.billing.label} window={data.individual.billing} />
                    {!data.enforced && (
                      <Text fontSize="xs" color="fg.muted" fontFamily="mono">Limits are tracked, not enforced.</Text>
                    )}
                  </VStack>
                ) : null}
            </Dialog.Body>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}
