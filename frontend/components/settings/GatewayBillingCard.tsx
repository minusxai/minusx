'use client';

import { useCallback, useEffect, useState } from 'react';
import { Box, HStack, VStack, Text, Progress, Spinner, Badge } from '@chakra-ui/react';
import { LuZap } from 'react-icons/lu';

import type { GatewayOrgStatus } from '@/lib/gateway/gateway-types';
import { microToUsd } from '@/lib/gateway/gateway-types';

/**
 * Plan and balance for a gateway-backed workspace.
 *
 * Renders NOTHING when no gateway is configured. Such a workspace is not in an
 * error state — it simply has no billing — and an empty card would be noise on
 * every one of those settings pages.
 *
 * Balance and plan answer different questions and both are shown: the balance
 * is what remains to spend, the plan is what the workspace is on. Having a
 * balance without an active plan is a normal, working state, so it must not
 * read as an error.
 */

interface BillingPayload {
  enabled: boolean;
  reachable?: boolean;
  status?: GatewayOrgStatus;
}

function usd(micro: number): string {
  return `$${microToUsd(micro).toFixed(2)}`;
}

function useBilling() {
  const [data, setData] = useState<BillingPayload | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/gateway/status');
      const body = await res.json();
      setData((body.data ?? { enabled: false }) as BillingPayload);
    } catch {
      // The panel is informational; a failure to load it must not throw into
      // the settings page. Treat it the same as "gateway unreachable".
      setData({ enabled: true, reachable: false });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  return { data, loading };
}

/** "renews on 1 Sep" vs "ends on 1 Sep" — `subscribed` alone cannot say which. */
function planLine(status: GatewayOrgStatus): string {
  if (!status.subscribed) return 'No active plan';
  const when = status.accessExpiresAt
    ? new Date(status.accessExpiresAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    : null;
  const verb = status.willRenew ? 'renews' : 'ends';
  return when ? `${status.plan} — ${verb} ${when}` : `${status.plan}`;
}

export function GatewayBillingCard() {
  const { data, loading } = useBilling();

  if (loading) {
    return (
      <Box p={4} aria-label="Billing loading">
        <Spinner size="sm" />
      </Box>
    );
  }

  // No gateway on this install: render nothing, not an empty card.
  if (!data?.enabled) return null;

  if (!data.reachable || !data.status) {
    return (
      <Box p={4} borderWidth="1px" borderRadius="md" aria-label="Billing unavailable">
        <Text fontSize="sm" color="fg.muted">
          Billing is temporarily unavailable. Your existing credits are unaffected.
        </Text>
      </Box>
    );
  }

  const s = data.status;
  const showPlanUsage =
    s.percentUsed !== null && s.periodGrantedMicroUsd !== null && s.periodUsedMicroUsd !== null;

  return (
    <Box p={4} borderWidth="1px" borderRadius="md" aria-label="Billing">
      <VStack align="stretch" gap={4}>
        <HStack justify="space-between" align="start">
          <VStack align="start" gap={0}>
            <HStack gap={2}>
              <LuZap aria-hidden />
              {/* NOT "Credits": the credit-limits card directly below is
                  already called that, and two adjacent cards with the same
                  heading showing different numbers is unreadable. */}
              <Text fontWeight="semibold">Plan &amp; balance</Text>
            </HStack>
            <Text fontSize="2xl" fontWeight="bold" aria-label="Credit balance">
              {usd(s.balanceMicroUsd)}
            </Text>
          </VStack>

          <Badge
            aria-label="Subscription status"
            colorPalette={s.subscribed ? 'green' : 'gray'}
          >
            {planLine(s)}
          </Badge>
        </HStack>

        {showPlanUsage && (
          <VStack align="stretch" gap={1} aria-label="Plan usage">
            <HStack justify="space-between">
              <Text fontSize="xs" color="fg.muted">This period</Text>
              <Text fontSize="xs" color="fg.muted">
                {usd(s.periodUsedMicroUsd!)} of {usd(s.periodGrantedMicroUsd!)}
              </Text>
            </HStack>
            <Progress.Root value={Math.round((s.percentUsed ?? 0) * 100)} size="sm">
              <Progress.Track><Progress.Range /></Progress.Track>
            </Progress.Root>
          </VStack>
        )}

        {s.expiringSoonMicroUsd > 0 && (
          <Text fontSize="xs" color="fg.muted" aria-label="Expiring soon">
            {usd(s.expiringSoonMicroUsd)} expires within 7 days.
          </Text>
        )}
      </VStack>
    </Box>
  );
}
