'use client';

import { useCallback, useEffect, useState } from 'react';
import { Box, VStack, HStack, Text, SimpleGrid, Spinner, Table, IconButton, Input, Button } from '@chakra-ui/react';
import { LuRefreshCw } from 'react-icons/lu';
import { toaster } from '@/components/ui/toaster';
import type { AdminUsageBreakdown, UsageBreakdownEntry, UsageTimePoint, CreditEvent } from '@/lib/analytics/admin-usage.server';

const nf = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

/** Fetch the org-wide admin usage breakdown. */
function useAdminUsage() {
  const [data, setData] = useState<AdminUsageBreakdown | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/credits/admin-usage');
      if (!res.ok) throw new Error(`Failed to load usage (${res.status})`);
      const body = await res.json();
      setData(body.data as AdminUsageBreakdown);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load usage');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refetch(); }, [refetch]);
  return { data, loading, error, refetch };
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <VStack align="start" gap={0.5} p={4} borderWidth="1px" borderColor="border.default" borderRadius="md" bg="bg.surface">
      <Text fontSize="xs" color="fg.muted" fontFamily="mono" textTransform="uppercase" letterSpacing="0.05em">{label}</Text>
      <Text fontSize="2xl" fontWeight="semibold" fontFamily="mono">{value}</Text>
    </VStack>
  );
}

/**
 * Credits-per-day trend as a self-contained responsive SVG bar chart. Hand-rolled
 * (not the question Vega bridge) so a small ad-hoc dashboard series renders reliably;
 * theme-aware via the design chart token, with a hover tooltip per bar.
 */
function DailyTrendChart({ points }: { points: UsageTimePoint[] }) {
  const W = 900;
  const H = 200;
  const pad = { top: 12, right: 8, bottom: 22, left: 8 };
  const plotW = W - pad.left - pad.right;
  const plotH = H - pad.top - pad.bottom;
  const max = Math.max(1, ...points.map((p) => p.credits));
  const n = points.length;
  const slot = plotW / Math.max(1, n);
  const barW = Math.max(1, Math.min(28, slot * 0.7));
  const fmt = (d: string) => d.slice(5); // MM-DD

  return (
    <Box color="accent.success" w="100%">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="200" preserveAspectRatio="none" role="img" aria-label="Credits per day">
        {points.map((p, i) => {
          const h = (p.credits / max) * plotH;
          const x = pad.left + i * slot + (slot - barW) / 2;
          const y = pad.top + (plotH - h);
          return (
            <g key={p.date}>
              <rect x={x} y={y} width={barW} height={Math.max(0, h)} rx={2} fill="currentColor" opacity={0.85}>
                <title>{`${p.date}: ${nf.format(p.credits)} credits`}</title>
              </rect>
              {(n <= 14 || i === 0 || i === n - 1 || i % Math.ceil(n / 10) === 0) && (
                <text x={pad.left + i * slot + slot / 2} y={H - 6} fontSize="10" textAnchor="middle" fill="var(--chakra-colors-fg-muted, #888)" fontFamily="monospace">{fmt(p.date)}</text>
              )}
            </g>
          );
        })}
      </svg>
    </Box>
  );
}

/** A compact top-N table for a dimension breakdown. */
function BreakdownTable({ title, rows }: { title: string; rows: UsageBreakdownEntry[] }) {
  return (
    <VStack align="stretch" gap={2} p={4} borderWidth="1px" borderColor="border.default" borderRadius="md" bg="bg.surface" minW={0}>
      <Text fontSize="sm" fontWeight="medium" fontFamily="mono">{title}</Text>
      {rows.length === 0
        ? <Text fontSize="sm" color="fg.muted">No usage yet</Text>
        : (
          <Table.Root size="sm" variant="line">
            <Table.Header>
              <Table.Row>
                <Table.ColumnHeader fontFamily="mono" fontSize="xs">Name</Table.ColumnHeader>
                <Table.ColumnHeader fontFamily="mono" fontSize="xs" textAlign="end">Credits</Table.ColumnHeader>
                <Table.ColumnHeader fontFamily="mono" fontSize="xs" textAlign="end">Requests</Table.ColumnHeader>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {rows.slice(0, 8).map((r) => (
                <Table.Row key={r.key}>
                  <Table.Cell fontFamily="mono" fontSize="xs" truncate maxW="180px">{r.key}</Table.Cell>
                  <Table.Cell fontFamily="mono" fontSize="xs" textAlign="end">{nf.format(r.credits)}</Table.Cell>
                  <Table.Cell fontFamily="mono" fontSize="xs" textAlign="end">{nf.format(r.requests)}</Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table.Root>
        )}
    </VStack>
  );
}

/** Manual credit reset: pick a scope + target and record a CREDIT_RESET (zeroes usage since). */
function ResetControls({ onDone }: { onDone: () => void }) {
  const [scope, setScope] = useState<'company' | 'role' | 'user'>('company');
  const [target, setTarget] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = useCallback(async () => {
    setBusy(true);
    try {
      const res = await fetch('/api/credits/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(scope === 'company' ? { scope } : { scope, target }),
      });
      if (!res.ok) throw new Error(`Reset failed (${res.status})`);
      toaster.create({ title: `Reset ${scope}${scope === 'company' ? '' : ` "${target}"`}`, type: 'success' });
      setTarget('');
      onDone();
    } catch (e) {
      toaster.create({ title: e instanceof Error ? e.message : 'Reset failed', type: 'error' });
    } finally {
      setBusy(false);
    }
  }, [scope, target, onDone]);

  return (
    <VStack align="stretch" gap={2} p={4} borderWidth="1px" borderColor="border.default" borderRadius="md" bg="bg.surface">
      <Text fontSize="sm" fontWeight="medium" fontFamily="mono">Reset credits</Text>
      <HStack gap={2} flexWrap="wrap">
        <select
          aria-label="Reset scope"
          value={scope}
          onChange={(e) => setScope(e.target.value as 'company' | 'role' | 'user')}
          style={{ fontFamily: 'monospace', fontSize: '0.875rem', padding: '4px 8px', border: '1px solid var(--chakra-colors-border-default)', borderRadius: '6px', background: 'var(--chakra-colors-bg-surface)' }}
        >
          <option value="company">Company</option>
          <option value="role">Role</option>
          <option value="user">User</option>
        </select>
        {scope !== 'company' && (
          <Input
            aria-label="Reset target"
            placeholder={scope === 'role' ? 'admin / editor / viewer' : 'user id or email'}
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            size="sm" maxW="240px" fontFamily="mono"
          />
        )}
        <Button aria-label="Apply reset" size="sm" colorPalette="teal" loading={busy} disabled={scope !== 'company' && !target.trim()} onClick={submit}>
          Reset
        </Button>
      </HStack>
    </VStack>
  );
}

/** Recent rate-limit hits + resets (audit feed from app_events). */
function EventsFeed({ events }: { events: CreditEvent[] }) {
  return (
    <VStack align="stretch" gap={2} p={4} borderWidth="1px" borderColor="border.default" borderRadius="md" bg="bg.surface" aria-label="Credit events feed">
      <Text fontSize="sm" fontWeight="medium" fontFamily="mono">Recent events</Text>
      {events.length === 0
        ? <Text fontSize="sm" color="fg.muted">No rate-limit hits or resets yet</Text>
        : (
          <VStack align="stretch" gap={1}>
            {events.map((ev, i) => (
              <HStack key={i} justify="space-between" fontSize="xs" fontFamily="mono">
                <Text color={ev.type === 'rate_limit_hit' ? 'accent.danger' : 'accent.teal'}>
                  {ev.type === 'rate_limit_hit' ? 'rate-limit hit' : 'reset'}
                  {' · '}
                  {String(ev.detail['userEmail'] ?? ev.detail['target'] ?? ev.detail['scope'] ?? '')}
                </Text>
                <Text color="fg.muted">{new Date(ev.at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</Text>
              </HStack>
            ))}
          </VStack>
        )}
    </VStack>
  );
}

/**
 * Admin org-wide usage dashboard: the "full picture" over the billing window,
 * sliced by grade / provider / agent / model / user / role, with a per-day
 * credits trend. Reads GET /api/credits/admin-usage (admin-gated).
 */
export default function AdminUsageDashboard() {
  const { data, loading, error, refetch } = useAdminUsage();

  if (loading && !data) return <HStack justify="center" py={16}><Spinner /></HStack>;
  if (error) return <Box p={4}><Text color="accent.danger" fontFamily="mono" fontSize="sm">{error}</Text></Box>;
  if (!data) return null;

  return (
    <VStack align="stretch" gap={5} aria-label="Org usage dashboard">
      <HStack justify="space-between">
        <Text fontSize="sm" color="fg.muted" fontFamily="mono">Org usage · {data.windowLabel}</Text>
        <IconButton aria-label="Refresh usage" size="xs" variant="ghost" onClick={() => void refetch()}><LuRefreshCw /></IconButton>
      </HStack>

      <SimpleGrid columns={{ base: 2, md: 4 }} gap={3}>
        <Kpi label="Total credits" value={nf.format(data.totalCredits)} />
        <Kpi label="Requests" value={nf.format(data.totalRequests)} />
        <Kpi label="Active users" value={nf.format(data.activeUsers)} />
        <Kpi label="Window" value={data.windowLabel} />
      </SimpleGrid>

      <VStack align="stretch" gap={2} p={4} borderWidth="1px" borderColor="border.default" borderRadius="md" bg="bg.surface" minW={0}>
        <Text fontSize="sm" fontWeight="medium" fontFamily="mono">Credits per day</Text>
        {data.overTime.length === 0
          ? <HStack h="120px" justify="center"><Text fontSize="sm" color="fg.muted">No usage yet</Text></HStack>
          : <DailyTrendChart points={data.overTime} />}
      </VStack>

      <SimpleGrid columns={{ base: 1, lg: 3 }} gap={3}>
        <BreakdownTable title="By grade" rows={data.byGrade} />
        <BreakdownTable title="By provider" rows={data.byProvider} />
        <BreakdownTable title="By agent" rows={data.byAgent} />
      </SimpleGrid>

      <SimpleGrid columns={{ base: 1, lg: 3 }} gap={3}>
        <BreakdownTable title="Top users" rows={data.byUser} />
        <BreakdownTable title="By model" rows={data.byModel} />
        <BreakdownTable title="By role" rows={data.byRole} />
      </SimpleGrid>

      <SimpleGrid columns={{ base: 1, lg: 2 }} gap={3}>
        <ResetControls onDone={refetch} />
        <EventsFeed events={data.events} />
      </SimpleGrid>
    </VStack>
  );
}
