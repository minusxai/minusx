'use client';

import { useCallback, useEffect, useState } from 'react';
import { Box, VStack, HStack, Text, Icon, IconButton, Progress, Table, Spinner } from '@chakra-ui/react';
import { LuZap, LuRefreshCw } from 'react-icons/lu';
import { useAppSelector } from '@/store/hooks';
import type { CreditScope, CreditUsageResponse } from '@/lib/analytics/credits.types';

const nf = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

/** Fetch the current user's (and, for admins, the org's) credit usage for this month. */
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

/** Labeled progress bar: used / allowance credits for one scope. */
function UsageBar({ label, scope }: { label: string; scope: CreditScope }) {
  const pct = scope.allowance > 0 ? Math.min(100, (scope.used / scope.allowance) * 100) : 0;
  const overLimit = scope.used > scope.allowance;
  return (
    <VStack align="stretch" gap={1} aria-label={label}>
      <HStack justify="space-between">
        <Text fontSize="xs" color="fg.muted" fontFamily="mono">{label}</Text>
        <Text fontSize="xs" fontFamily="mono" color={overLimit ? 'accent.danger' : 'fg.muted'}>
          {nf.format(Math.round(scope.used))} / {nf.format(scope.allowance)} credits
        </Text>
      </HStack>
      <Progress.Root size="sm" value={pct} colorPalette={overLimit ? 'red' : 'teal'}>
        <Progress.Track borderRadius="full" overflow="hidden">
          <Progress.Range />
        </Progress.Track>
      </Progress.Root>
    </VStack>
  );
}

/** Per (provider, model, trigger) breakdown table — shown only in dev mode. */
function BreakdownTable({ scope }: { scope: CreditScope }) {
  if (scope.rows.length === 0) {
    return <Text fontSize="xs" color="fg.muted" fontFamily="mono">No usage yet this month.</Text>;
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
        {scope.rows.map((row) => (
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
          <Table.Cell fontFamily="mono" fontSize="xs" fontWeight="700" textAlign="right">{nf.format(Math.round(scope.used))}</Table.Cell>
        </Table.Row>
      </Table.Body>
    </Table.Root>
  );
}

/**
 * Settings → General credits card. One card with a bar per scope (yours + org
 * for admins). The full per-(provider, model, trigger) breakdown table is shown
 * only when dev mode is on.
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
          <HStack gap={2}>
            <Text fontSize="xs" color="fg.muted" fontFamily="mono">this month</Text>
            <IconButton
              aria-label="Refresh credit usage"
              size="2xs"
              variant="ghost"
              onClick={() => void refetch()}
              loading={loading}
            >
              <LuRefreshCw />
            </IconButton>
          </HStack>
        </HStack>

        {loading && (
          <HStack gap={2}><Spinner size="sm" /><Text fontSize="sm" color="fg.muted" fontFamily="mono">Loading…</Text></HStack>
        )}
        {(error || (!loading && !data)) && (
          <Text fontSize="sm" color="accent.danger" fontFamily="mono">{error ?? 'Failed to load credit usage'}</Text>
        )}

        {data && (
          <>
            <VStack align="stretch" gap={3}>
              <UsageBar label="Your usage" scope={data.individual} />
              {data.org && <UsageBar label="Organization usage" scope={data.org} />}
            </VStack>
            {devMode && (
              <VStack align="stretch" gap={4}>
                <Box>
                  <Text fontSize="xs" color="fg.subtle" fontFamily="mono" textTransform="uppercase" letterSpacing="wider" mb={2}>Your breakdown</Text>
                  <BreakdownTable scope={data.individual} />
                </Box>
                {data.org && (
                  <Box>
                    <Text fontSize="xs" color="fg.subtle" fontFamily="mono" textTransform="uppercase" letterSpacing="wider" mb={2}>Organization breakdown</Text>
                    <BreakdownTable scope={data.org} />
                  </Box>
                )}
              </VStack>
            )}
          </>
        )}
      </VStack>
    </Box>
  );
}

/**
 * Compact credit bars for the sidebar user menu (under "Signed in as"). Bars
 * only — no card chrome, no breakdown table.
 */
export function CreditsUsageBars() {
  const { data, loading } = useCreditUsage();
  if (loading || !data) return null;
  return (
    <VStack align="stretch" gap={2} aria-label="Credits usage bars">
      <UsageBar label="Your usage" scope={data.individual} />
      {data.org && <UsageBar label="Organization usage" scope={data.org} />}
    </VStack>
  );
}
