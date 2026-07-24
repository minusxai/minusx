'use client';

import { useCallback, useEffect, useState } from 'react';
import { VStack, HStack, Text, SimpleGrid, Table, IconButton, Input, Button, Link } from '@chakra-ui/react';
import { LuX, LuExternalLink } from 'react-icons/lu';
import { toaster } from '@/components/ui/toaster';
import type { CreditEvent } from '@/lib/analytics/credits.types';

// The seeded internals-mode "Credit Usage" dashboard (workspace-template.json id 61) —
// the reusable Question stack over llm_call_events for slicing/charting credit usage.
const CREDIT_DASHBOARD_HREF = '/f/61?mode=internals';

type Limits = { daily?: number; weekly?: number };
type CreditsCfg = {
  enabled?: boolean;
  limits?: { company?: Limits; roles?: Record<string, Limits>; users?: Record<string, Limits> };
};
const ROLES = ['admin', 'editor', 'viewer'] as const;

/** Admin editor for the credit levers: on/off + daily/weekly limits by company, role, and user. */
function LimitsEditor() {
  const [cfg, setCfg] = useState<CreditsCfg | null>(null);
  const [busy, setBusy] = useState(false);
  const [newUser, setNewUser] = useState('');

  useEffect(() => {
    void fetch('/api/configs').then((r) => r.json()).then((b) => setCfg((b?.data?.config?.credits as CreditsCfg) ?? {}));
  }, []);

  const num = (v: string): number | undefined => (v.trim() === '' ? undefined : Number(v));
  const setCompany = (k: keyof Limits, v: string) =>
    setCfg((c) => ({ ...c, limits: { ...c?.limits, company: { ...c?.limits?.company, [k]: num(v) } } }));
  const setRole = (role: string, k: keyof Limits, v: string) =>
    setCfg((c) => ({ ...c, limits: { ...c?.limits, roles: { ...c?.limits?.roles, [role]: { ...c?.limits?.roles?.[role], [k]: num(v) } } } }));
  const setUser = (key: string, k: keyof Limits, v: string) =>
    setCfg((c) => ({ ...c, limits: { ...c?.limits, users: { ...c?.limits?.users, [key]: { ...c?.limits?.users?.[key], [k]: num(v) } } } }));
  const removeUser = (key: string) =>
    setCfg((c) => { const users = { ...c?.limits?.users }; delete users[key]; return { ...c, limits: { ...c?.limits, users } }; });
  const addUser = () => {
    const key = newUser.trim();
    if (!key) return;
    setCfg((c) => ({ ...c, limits: { ...c?.limits, users: { ...c?.limits?.users, [key]: c?.limits?.users?.[key] ?? {} } } }));
    setNewUser('');
  };

  const save = useCallback(async () => {
    if (!cfg) return;
    setBusy(true);
    try {
      const res = await fetch('/api/configs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ credits: cfg }) });
      if (!res.ok) throw new Error(`Save failed (${res.status})`);
      toaster.create({ title: 'Limits saved', type: 'success' });
    } catch (e) {
      toaster.create({ title: e instanceof Error ? e.message : 'Save failed', type: 'error' });
    } finally { setBusy(false); }
  }, [cfg]);

  if (!cfg) return null;
  const numCell = (val: number | undefined, onCh: (v: string) => void, ph: string) => (
    <Input aria-label={ph} type="number" size="xs" maxW="90px" fontFamily="mono" placeholder="—" value={val ?? ''} onChange={(e) => onCh(e.target.value)} />
  );

  return (
    <VStack align="stretch" gap={3} p={4} borderWidth="1px" borderColor="border.default" borderRadius="md" bg="bg.surface">
      <HStack justify="space-between">
        <Text fontSize="sm" fontWeight="medium" fontFamily="mono">Credit limits</Text>
        <Button aria-label="Save limits" size="xs" colorPalette="teal" loading={busy} onClick={save}>Save</Button>
      </HStack>
      <HStack gap={4} flexWrap="wrap">
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontFamily: 'monospace', fontSize: '0.8rem' }}>
          <input aria-label="Credits enabled" type="checkbox" checked={cfg.enabled ?? false} onChange={(e) => setCfg((c) => ({ ...c, enabled: e.target.checked }))} /> enabled (tracks + enforces)
        </label>
      </HStack>
      <Table.Root size="sm" variant="line">
        <Table.Header>
          <Table.Row>
            <Table.ColumnHeader fontFamily="mono" fontSize="xs">Scope</Table.ColumnHeader>
            <Table.ColumnHeader fontFamily="mono" fontSize="xs">Daily</Table.ColumnHeader>
            <Table.ColumnHeader fontFamily="mono" fontSize="xs">Weekly</Table.ColumnHeader>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          <Table.Row>
            <Table.Cell fontFamily="mono" fontSize="xs">Company</Table.Cell>
            <Table.Cell>{numCell(cfg.limits?.company?.daily, (v) => setCompany('daily', v), 'Company daily limit')}</Table.Cell>
            <Table.Cell>{numCell(cfg.limits?.company?.weekly, (v) => setCompany('weekly', v), 'Company weekly limit')}</Table.Cell>
          </Table.Row>
          {ROLES.map((role) => (
            <Table.Row key={role}>
              <Table.Cell fontFamily="mono" fontSize="xs">{role}</Table.Cell>
              <Table.Cell>{numCell(cfg.limits?.roles?.[role]?.daily, (v) => setRole(role, 'daily', v), `${role} daily limit`)}</Table.Cell>
              <Table.Cell>{numCell(cfg.limits?.roles?.[role]?.weekly, (v) => setRole(role, 'weekly', v), `${role} weekly limit`)}</Table.Cell>
            </Table.Row>
          ))}
          {Object.keys(cfg.limits?.users ?? {}).map((key) => (
            <Table.Row key={`u:${key}`}>
              <Table.Cell fontFamily="mono" fontSize="xs">
                <HStack gap={1} justify="space-between">
                  <Text truncate maxW="120px">{key}</Text>
                  <IconButton aria-label={`Remove ${key}`} size="2xs" variant="ghost" onClick={() => removeUser(key)}><LuX /></IconButton>
                </HStack>
              </Table.Cell>
              <Table.Cell>{numCell(cfg.limits?.users?.[key]?.daily, (v) => setUser(key, 'daily', v), `${key} daily limit`)}</Table.Cell>
              <Table.Cell>{numCell(cfg.limits?.users?.[key]?.weekly, (v) => setUser(key, 'weekly', v), `${key} weekly limit`)}</Table.Cell>
            </Table.Row>
          ))}
          <Table.Row>
            <Table.Cell colSpan={3}>
              <HStack gap={2}>
                <Input aria-label="Add user for limit" size="xs" maxW="200px" fontFamily="mono" placeholder="user id or email"
                  value={newUser} onChange={(e) => setNewUser(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') addUser(); }} />
                <Button aria-label="Add user limit" size="xs" variant="outline" onClick={addUser} disabled={!newUser.trim()}>Add user</Button>
              </HStack>
            </Table.Cell>
          </Table.Row>
        </Table.Body>
      </Table.Root>
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
 * Admin credit controls (Settings → Usage): the LEVERS — configure limits by
 * company/role/user, reset windows, and see the rate-limit/reset audit feed.
 * Analytics live in the reusable Question stack: the seeded internals-mode
 * "Credit Usage" dashboard (linked below), which admins can slice/re-chart
 * over `llm_call_events` — no bespoke breakdown UI.
 */
export default function AdminUsageDashboard() {
  const [events, setEvents] = useState<CreditEvent[]>([]);
  const refetch = useCallback(() => {
    void fetch('/api/credits/events').then((r) => r.json()).then((b) => setEvents((b?.data?.events as CreditEvent[]) ?? []));
  }, []);
  useEffect(() => { refetch(); }, [refetch]);

  return (
    <VStack align="stretch" gap={5} aria-label="Credit controls">
      <HStack justify="space-between">
        <Text fontSize="sm" color="fg.muted" fontFamily="mono">Credit controls</Text>
        <Link href={CREDIT_DASHBOARD_HREF} aria-label="Open credit analytics" fontSize="sm" fontFamily="mono" color="accent.teal">
          <HStack gap={1}><Text>Credit analytics</Text><LuExternalLink /></HStack>
        </Link>
      </HStack>
      <SimpleGrid columns={{ base: 1, lg: 2 }} gap={3}>
        <LimitsEditor />
        <VStack align="stretch" gap={3}>
          <ResetControls onDone={refetch} />
          <EventsFeed events={events} />
        </VStack>
      </SimpleGrid>
    </VStack>
  );
}
