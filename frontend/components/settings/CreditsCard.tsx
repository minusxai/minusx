'use client';

import { useCallback, useEffect, useState } from 'react';
import { Box, VStack, HStack, Text, Icon, IconButton, Progress, ProgressCircle, AbsoluteCenter, Table, Spinner } from '@chakra-ui/react';
import { LuZap, LuRefreshCw } from 'react-icons/lu';
import { useAppSelector } from '@/store/hooks';
import type { CreditBreakdownRow, CreditScope, CreditUsageResponse, CreditWindow } from '@/lib/analytics/credits.types';

const nf = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

/** Fetch the current user's (and, for admins, the org's) credit usage. */
function useCreditUsage() {
  const [data, setData] = useState<CreditUsageResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/credits/usage');
      if (!res.ok) throw new Error(`Failed to load usage (${res.status})`);
      const body = await res.json();
      setData(body.data as CreditUsageResponse);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load usage');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refetch(); }, [refetch]);

  return { data, loading, error, refetch };
}

/**
 * Format an ISO reset timestamp as a short local date (day-granular). We show
 * the date only — the boundary is computed at the DB day boundary (UTC), so
 * rendering the exact instant in the browser's local time is off-by-tz-offset
 * and reads confusingly (e.g. 1:00 AM). The date is unambiguous for day+ cycles.
 */
function formatResetsAt(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** One window bar (half width): label + used/allowance + colored progress + optional caption. */
function UsageBar({ window, label, color }: { window: CreditWindow; label: string; color: string }) {
  const pct = window.allowance > 0 ? Math.min(100, (window.used / window.allowance) * 100) : 0;
  const overLimit = window.used > window.allowance;
  const barColor = overLimit ? 'accent.danger' : color;
  return (
    <VStack align="stretch" gap={1} flex={1} minW={0}>
      <HStack justify="space-between" gap={2}>
        <Text fontSize="xs" color="fg.muted" fontFamily="mono" truncate>{label}</Text>
        <Text fontSize="xs" fontFamily="mono" whiteSpace="nowrap" color={overLimit ? 'accent.danger' : 'fg.muted'}>
          {nf.format(Math.round(window.used))} / {nf.format(window.allowance)}
        </Text>
      </HStack>
      <Progress.Root size="sm" value={pct}>
        <Progress.Track borderRadius="full" overflow="hidden" bg="bg.muted">
          <Progress.Range bg={barColor} />
        </Progress.Track>
      </Progress.Root>
      {window.resetsAt && (
        <Text fontSize="2xs" color="fg.subtle" fontFamily="mono">resets {formatResetsAt(window.resetsAt)}</Text>
      )}
    </VStack>
  );
}

/** A scope (yours / org): credit-window + billing-cycle bars side by side (50% each). */
function ScopeBars({ title, scope }: { title: string; scope: CreditScope }) {
  return (
    <VStack align="stretch" gap={2} aria-label={title}>
      <Text fontSize="xs" fontWeight="600" fontFamily="mono" color="fg.subtle">{title}</Text>
      <HStack align="start" gap={4}>
        <UsageBar window={scope.reset} label="this credit window" color="accent.primary" />
        <UsageBar window={scope.billing} label="this billing cycle" color="accent.teal" />
      </HStack>
    </VStack>
  );
}

/** A tiny donut for the compact sidebar: % used inside the ring, with a small caption. */
function TinyDonut({ window, color, caption }: { window: CreditWindow; color: string; caption: string }) {
  const pct = window.allowance > 0 ? Math.min(100, (window.used / window.allowance) * 100) : 0;
  const overLimit = window.used > window.allowance;
  return (
    <VStack gap={1} align="center" minW={0}>
      <ProgressCircle.Root value={pct} size="md">
        <ProgressCircle.Circle>
          <ProgressCircle.Track stroke="bg.muted" />
          <ProgressCircle.Range stroke={overLimit ? 'accent.danger' : color} />
        </ProgressCircle.Circle>
        <AbsoluteCenter>
          <ProgressCircle.ValueText fontSize="2xs" fontFamily="mono" color={overLimit ? 'accent.danger' : 'fg.muted'} />
        </AbsoluteCenter>
      </ProgressCircle.Root>
      <VStack gap={0} align="center">
        <Text fontSize="2xs" color="fg.muted" fontFamily="mono">{caption}</Text>
        <Text fontSize="2xs" color="fg.subtle" fontFamily="mono">{nf.format(Math.round(window.used))}/{nf.format(window.allowance)}</Text>
      </VStack>
    </VStack>
  );
}

/** Footer note shown when credit limits are tracked but not enforced. */
function NotEnforcedNote() {
  return (
    <Text fontSize="xs" color="fg.subtle" fontFamily="mono">
      Credit limits are not enforced — usage is tracked but not blocked.
    </Text>
  );
}

/** Per (provider, model, trigger) breakdown table — shown only in dev mode. */
function BreakdownTable({ rows, total }: { rows: CreditBreakdownRow[]; total: number }) {
  if (rows.length === 0) {
    return <Text fontSize="xs" color="fg.muted" fontFamily="mono">No usage yet.</Text>;
  }
  return (
    <Table.Root size="sm">
      <Table.Header>
        <Table.Row bg="bg.muted">
          <Table.ColumnHeader fontFamily="mono" fontWeight="600">Provider</Table.ColumnHeader>
          <Table.ColumnHeader fontFamily="mono" fontWeight="600">Model</Table.ColumnHeader>
          <Table.ColumnHeader fontFamily="mono" fontWeight="600">Trigger</Table.ColumnHeader>
          <Table.ColumnHeader fontFamily="mono" fontWeight="600" textAlign="right">Input</Table.ColumnHeader>
          <Table.ColumnHeader fontFamily="mono" fontWeight="600" textAlign="right">Cached</Table.ColumnHeader>
          <Table.ColumnHeader fontFamily="mono" fontWeight="600" textAlign="right">Output</Table.ColumnHeader>
          <Table.ColumnHeader fontFamily="mono" fontWeight="600" textAlign="right">Credits</Table.ColumnHeader>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {rows.map((row) => (
          <Table.Row key={`${row.provider}|${row.model}|${row.trigger}`} _hover={{ bg: 'bg.muted' }}>
            <Table.Cell fontFamily="mono" fontSize="xs">{row.provider || '—'}</Table.Cell>
            <Table.Cell fontFamily="mono" fontSize="xs">{row.model}</Table.Cell>
            <Table.Cell fontFamily="mono" fontSize="xs">{row.trigger || '—'}</Table.Cell>
            <Table.Cell fontFamily="mono" fontSize="xs" textAlign="right">{nf.format(row.nonCachedInputTokens)}</Table.Cell>
            <Table.Cell fontFamily="mono" fontSize="xs" textAlign="right">{nf.format(row.cachedTokens)}</Table.Cell>
            <Table.Cell fontFamily="mono" fontSize="xs" textAlign="right">{nf.format(row.outputTokens)}</Table.Cell>
            <Table.Cell fontFamily="mono" fontSize="xs" textAlign="right" fontWeight="600">{nf.format(Math.round(row.credits))}</Table.Cell>
          </Table.Row>
        ))}
        <Table.Row bg="bg.muted">
          <Table.Cell fontFamily="mono" fontSize="xs" fontWeight="600">Total</Table.Cell>
          <Table.Cell /><Table.Cell /><Table.Cell /><Table.Cell /><Table.Cell />
          <Table.Cell fontFamily="mono" fontSize="xs" fontWeight="700" textAlign="right">{nf.format(Math.round(total))}</Table.Cell>
        </Table.Row>
      </Table.Body>
    </Table.Root>
  );
}

/**
 * Settings → General credits card. One card with reset + billing bars per scope
 * (yours + org for admins). The full per-(provider, model, trigger) breakdown
 * table is shown only when dev mode is on.
 */
export function CreditsUsageCards() {
  const { data, loading, error, refetch } = useCreditUsage();
  const devMode = useAppSelector((s) => s.ui.devMode);

  return (
    <Box bg="bg.surface" borderRadius="xl" shadow="sm" borderWidth="1px" borderColor="border" px={6} py={4} aria-label="Credits usage">
      <VStack align="stretch" gap={4}>
        <HStack gap={2} justify="space-between">
          <HStack gap={2}>
            <Icon as={LuZap} boxSize={4} color="fg.muted" flexShrink={0} />
            <Text fontSize="sm" fontWeight="medium" fontFamily="mono">Credits</Text>
          </HStack>
          <IconButton aria-label="Refresh credit usage" size="2xs" variant="ghost" onClick={() => void refetch()} loading={loading}>
            <LuRefreshCw />
          </IconButton>
        </HStack>

        {loading && (
          <HStack gap={2}><Spinner size="sm" /><Text fontSize="sm" color="fg.muted" fontFamily="mono">Loading…</Text></HStack>
        )}
        {(error || (!loading && !data)) && (
          <Text fontSize="sm" color="accent.danger" fontFamily="mono">{error ?? 'Failed to load credit usage'}</Text>
        )}

        {data && (
          <>
            <VStack align="stretch" gap={4}>
              <ScopeBars title="Your usage" scope={data.individual} />
              {data.org && <ScopeBars title="Organization usage" scope={data.org} />}
            </VStack>
            {devMode && (
              <VStack align="stretch" gap={4}>
                <Box>
                  <Text fontSize="xs" color="fg.subtle" fontFamily="mono" textTransform="uppercase" letterSpacing="wider" mb={2}>Your breakdown</Text>
                  <BreakdownTable rows={data.individual.billing.rows} total={data.individual.billing.used} />
                </Box>
                {data.org && (
                  <Box>
                    <Text fontSize="xs" color="fg.subtle" fontFamily="mono" textTransform="uppercase" letterSpacing="wider" mb={2}>Organization breakdown</Text>
                    <BreakdownTable rows={data.org.billing.rows} total={data.org.billing.used} />
                  </Box>
                )}
              </VStack>
            )}
            {!data.enforced && <NotEnforcedNote />}
          </>
        )}
      </VStack>
    </Box>
  );
}

/**
 * Compact credit usage for the sidebar user menu (under "Signed in as"): two
 * tiny donuts for YOUR usage only (credit window + billing cycle). Org usage is
 * intentionally omitted here — it lives in Settings → General.
 */
export function CreditsUsageBars({ onClick }: { onClick?: () => void }) {
  const { data, loading } = useCreditUsage();
  if (loading || !data) return null;
  return (
    <HStack
      gap={3}
      justify="space-around"
      align="start"
      aria-label="Credits usage bars"
      cursor={onClick ? 'pointer' : undefined}
      onClick={onClick}
      _hover={onClick ? { opacity: 0.75 } : undefined}
    >
      <TinyDonut window={data.individual.reset} color="accent.primary" caption="credit window" />
      <TinyDonut window={data.individual.billing} color="accent.teal" caption="billing cycle" />
    </HStack>
  );
}
