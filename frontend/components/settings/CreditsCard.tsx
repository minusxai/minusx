'use client';

import { useEffect, useState } from 'react';
import { Box, VStack, HStack, Text, Icon, Progress, Table, Spinner } from '@chakra-ui/react';
import { LuCoins } from 'react-icons/lu';
import type { CreditScope, CreditUsageResponse } from '@/lib/analytics/credits.types';

const nf = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const tokenFmt = new Intl.NumberFormat('en-US');

function CreditScopeCard({ title, scope }: { title: string; scope: CreditScope }) {
  const pct = scope.allowance > 0 ? Math.min(100, (scope.used / scope.allowance) * 100) : 0;
  const overLimit = scope.used > scope.allowance;

  return (
    <Box bg="bg.surface" borderRadius="xl" shadow="sm" borderWidth="1px" borderColor="border" px={6} py={4} aria-label={title}>
      <VStack align="stretch" gap={3}>
        <HStack gap={3} justify="space-between">
          <HStack gap={2}>
            <Icon as={LuCoins} boxSize={4} color="fg.muted" flexShrink={0} />
            <Text fontSize="sm" fontWeight="medium" fontFamily="mono">{title}</Text>
          </HStack>
          <Text fontSize="xs" color="fg.muted" fontFamily="mono">this month</Text>
        </HStack>

        <VStack align="stretch" gap={1}>
          <HStack justify="space-between">
            <Text fontSize="sm" fontFamily="mono" fontWeight="semibold">
              {nf.format(Math.round(scope.used))} <Text as="span" color="fg.muted" fontWeight="normal">/ {nf.format(scope.allowance)} credits</Text>
            </Text>
            <Text fontSize="xs" fontFamily="mono" color={overLimit ? 'accent.danger' : 'fg.muted'}>
              {pct.toFixed(0)}%
            </Text>
          </HStack>
          <Progress.Root size="sm" value={pct} colorPalette={overLimit ? 'red' : 'teal'}>
            <Progress.Track borderRadius="full" overflow="hidden">
              <Progress.Range />
            </Progress.Track>
          </Progress.Root>
        </VStack>

        {scope.rows.length === 0 ? (
          <Text fontSize="xs" color="fg.muted" fontFamily="mono">No usage yet this month.</Text>
        ) : (
          <Table.Root size="sm">
            <Table.Header>
              <Table.Row bg="bg.muted">
                <Table.ColumnHeader fontFamily="mono" fontWeight="600">Provider</Table.ColumnHeader>
                <Table.ColumnHeader fontFamily="mono" fontWeight="600">Model</Table.ColumnHeader>
                <Table.ColumnHeader fontFamily="mono" fontWeight="600" textAlign="right">Input</Table.ColumnHeader>
                <Table.ColumnHeader fontFamily="mono" fontWeight="600" textAlign="right">Cached</Table.ColumnHeader>
                <Table.ColumnHeader fontFamily="mono" fontWeight="600" textAlign="right">Output</Table.ColumnHeader>
                <Table.ColumnHeader fontFamily="mono" fontWeight="600" textAlign="right">Credits</Table.ColumnHeader>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {scope.rows.map((row) => (
                <Table.Row key={`${row.provider}|${row.model}`} _hover={{ bg: 'bg.muted' }}>
                  <Table.Cell fontFamily="mono" fontSize="xs">{row.provider || '—'}</Table.Cell>
                  <Table.Cell fontFamily="mono" fontSize="xs">{row.model}</Table.Cell>
                  <Table.Cell fontFamily="mono" fontSize="xs" textAlign="right">{tokenFmt.format(row.nonCachedInputTokens)}</Table.Cell>
                  <Table.Cell fontFamily="mono" fontSize="xs" textAlign="right">{tokenFmt.format(row.cachedTokens)}</Table.Cell>
                  <Table.Cell fontFamily="mono" fontSize="xs" textAlign="right">{tokenFmt.format(row.outputTokens)}</Table.Cell>
                  <Table.Cell fontFamily="mono" fontSize="xs" textAlign="right" fontWeight="600">{nf.format(Math.round(row.credits))}</Table.Cell>
                </Table.Row>
              ))}
              <Table.Row bg="bg.muted">
                <Table.Cell fontFamily="mono" fontSize="xs" fontWeight="600">Total</Table.Cell>
                <Table.Cell />
                <Table.Cell />
                <Table.Cell />
                <Table.Cell />
                <Table.Cell fontFamily="mono" fontSize="xs" fontWeight="700" textAlign="right">{nf.format(Math.round(scope.used))}</Table.Cell>
              </Table.Row>
            </Table.Body>
          </Table.Root>
        )}
      </VStack>
    </Box>
  );
}

/**
 * Credit usage cards for the Settings → General tab. Fetches pre-aggregated,
 * current-month usage from the server. Non-admins see only their own scope;
 * admins additionally see org-wide totals (the server decides — `org` is null
 * for non-admins).
 */
export function CreditsUsageCards() {
  const [data, setData] = useState<CreditUsageResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/credits/usage');
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
  }, []);

  if (loading) {
    return (
      <Box bg="bg.surface" borderRadius="xl" shadow="sm" borderWidth="1px" borderColor="border" px={6} py={4} aria-label="Credits usage loading">
        <HStack gap={2}>
          <Spinner size="sm" />
          <Text fontSize="sm" color="fg.muted" fontFamily="mono">Loading credit usage…</Text>
        </HStack>
      </Box>
    );
  }

  if (error || !data) {
    return (
      <Box bg="bg.surface" borderRadius="xl" shadow="sm" borderWidth="1px" borderColor="border" px={6} py={4} aria-label="Credits usage error">
        <Text fontSize="sm" color="accent.danger" fontFamily="mono">{error ?? 'Failed to load credit usage'}</Text>
      </Box>
    );
  }

  return (
    <>
      <CreditScopeCard title="Your usage" scope={data.individual} />
      {data.org && <CreditScopeCard title="Organization usage" scope={data.org} />}
    </>
  );
}
