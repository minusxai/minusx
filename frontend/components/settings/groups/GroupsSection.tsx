'use client';

/**
 * Access V2 (M3) — Groups admin. A group = capability preset + folder scopes +
 * members; effective access is the union of a user's groups on top of their
 * role + home folder. Admin-only; talks to /api/groups.
 *
 * Functional first pass — reuses Chakra primitives and aria-labels for
 * testability. Visual polish is expected to be iterated.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge, Box, Button, Flex, HStack, Input, Text, VStack } from '@chakra-ui/react';
import { LuCirclePlus, LuTrash2, LuX } from 'react-icons/lu';
import SimpleSelect from '@/components/evals/SimpleSelect';
import { toaster } from '@/components/ui/toaster';
import { useUsers } from '@/lib/hooks/useUsers';
import type { FileType } from '@/lib/types';

type TypeSet = '*' | FileType[];
interface Group {
  id: number; name: string; kind: string;
  allowedTypes: TypeSet; viewTypes: TypeSet; createTypes: TypeSet;
  locked: boolean; scopes: string[]; memberIds: number[];
}

const VIEW_TYPES: FileType[] = ['question', 'dashboard', 'story', 'notebook', 'folder', 'report', 'alert', 'conversation', 'context'];
const BUILD_CREATE: FileType[] = ['question', 'dashboard', 'story', 'notebook', 'folder', 'alert', 'report', 'conversation'];

const PRESETS = {
  view: { label: 'Can view', allowedTypes: VIEW_TYPES as TypeSet, viewTypes: VIEW_TYPES as TypeSet, createTypes: [] as TypeSet },
  build: { label: 'Can build', allowedTypes: VIEW_TYPES as TypeSet, viewTypes: VIEW_TYPES as TypeSet, createTypes: BUILD_CREATE as TypeSet },
  full: { label: 'Full access', allowedTypes: '*' as TypeSet, viewTypes: '*' as TypeSet, createTypes: '*' as TypeSet },
} as const;
type PresetKey = keyof typeof PRESETS;

function presetOf(g: Pick<Group, 'allowedTypes' | 'createTypes'>): PresetKey {
  if (g.allowedTypes === '*') return 'full';
  return Array.isArray(g.createTypes) && g.createTypes.length > 0 ? 'build' : 'view';
}

interface Draft { id?: number; name: string; preset: PresetKey; scopes: string[]; memberIds: number[]; locked: boolean }

function toDraft(g: Group): Draft {
  return { id: g.id, name: g.name, preset: presetOf(g), scopes: g.scopes, memberIds: g.memberIds, locked: g.locked };
}
function emptyDraft(): Draft {
  return { name: '', preset: 'view', scopes: [], memberIds: [], locked: false };
}

export function GroupsSection() {
  const { users } = useUsers();
  const [groups, setGroups] = useState<Group[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [scopeInput, setScopeInput] = useState('');

  const reload = useCallback(async () => {
    const res = await fetch('/api/groups', { credentials: 'include' });
    const body = await res.json().catch(() => null);
    if (body?.data?.groups) setGroups(body.data.groups);
  }, []);
  useEffect(() => { reload(); }, [reload]);

  // Only users with a persisted id can be group members.
  const roster = useMemo(() => users.filter((u): u is typeof u & { id: number } => typeof u.id === 'number'), [users]);

  const save = async () => {
    if (!draft || !draft.name.trim()) { toaster.create({ title: 'Group name is required', type: 'error' }); return; }
    setSaving(true);
    try {
      const preset = PRESETS[draft.preset];
      const payload = { name: draft.name.trim(), allowedTypes: preset.allowedTypes, viewTypes: preset.viewTypes, createTypes: preset.createTypes, scopes: draft.scopes, memberIds: draft.memberIds };
      const res = draft.id
        ? await fetch(`/api/groups/${draft.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(payload) })
        : await fetch('/api/groups', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(payload) });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error?.message ?? 'Save failed');
      toaster.create({ title: draft.id ? 'Group updated' : 'Group created', type: 'success' });
      setDraft(null); setScopeInput('');
      await reload();
    } catch (e) {
      toaster.create({ title: e instanceof Error ? e.message : 'Save failed', type: 'error' });
    } finally { setSaving(false); }
  };

  const remove = async (g: Group) => {
    const res = await fetch(`/api/groups/${g.id}`, { method: 'DELETE', credentials: 'include' });
    if (res.ok) { toaster.create({ title: 'Group deleted', type: 'success' }); await reload(); }
    else { const b = await res.json().catch(() => null); toaster.create({ title: b?.error?.message ?? 'Delete failed', type: 'error' }); }
  };

  const addScope = () => {
    const f = scopeInput.trim().replace(/^\/+|\/+$/g, '');
    if (f && draft && !draft.scopes.includes(f)) setDraft({ ...draft, scopes: [...draft.scopes, f] });
    setScopeInput('');
  };
  const toggleMember = (id: number) => {
    if (!draft) return;
    setDraft({ ...draft, memberIds: draft.memberIds.includes(id) ? draft.memberIds.filter(x => x !== id) : [...draft.memberIds, id] });
  };

  return (
    <VStack align="stretch" gap={5} aria-label="Groups settings">
      <Box>
        <Text fontSize="sm" fontWeight="semibold" fontFamily="mono" mb={1}>Groups</Text>
        <Text fontSize="xs" color="fg.muted" fontFamily="mono">
          Grant folders to a set of people at a capability level. Access is added on top of each member&apos;s role and home folder.
        </Text>
      </Box>

      <VStack align="stretch" gap={2}>
        {groups.map(g => (
          <Flex key={g.id} align="center" justify="space-between" p={3} borderWidth="1px" borderColor="border.default" borderRadius="md" aria-label={`Group ${g.name}`}>
            <Box>
              <HStack gap={2}>
                <Text fontWeight="600" fontFamily="mono">{g.name}</Text>
                <Badge size="sm" colorPalette="gray">{PRESETS[presetOf(g)].label}</Badge>
                {g.locked && <Badge size="sm" colorPalette="orange">locked</Badge>}
              </HStack>
              <Text fontSize="xs" color="fg.muted" fontFamily="mono" mt={1}>
                {g.scopes.length ? g.scopes.map(s => `/${s || ''}`).join(', ') : 'no folders'} · {g.memberIds.length} member{g.memberIds.length === 1 ? '' : 's'}
              </Text>
            </Box>
            {!g.locked && (
              <HStack gap={1}>
                <Button size="xs" variant="outline" aria-label={`Edit group ${g.name}`} onClick={() => { setDraft(toDraft(g)); setScopeInput(''); }}>Edit</Button>
                <Button size="xs" variant="ghost" aria-label={`Delete group ${g.name}`} onClick={() => remove(g)}><LuTrash2 /></Button>
              </HStack>
            )}
          </Flex>
        ))}
        {groups.length === 0 && <Text fontSize="xs" color="fg.muted" fontFamily="mono">No groups yet.</Text>}
      </VStack>

      {draft ? (
        <Box p={4} borderWidth="1px" borderColor="accent.primary/40" borderRadius="md" aria-label="Group editor">
          <VStack align="stretch" gap={3}>
            <Box>
              <Text fontSize="xs" fontWeight="600" mb={1}>Name</Text>
              <Input aria-label="Group name" value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} placeholder="Finance viewers" fontFamily="mono" />
            </Box>
            <Box>
              <Text fontSize="xs" fontWeight="600" mb={1}>They can</Text>
              <SimpleSelect
                aria-label="Group capability preset"
                value={draft.preset}
                onChange={(v: string) => setDraft({ ...draft, preset: v as PresetKey })}
                options={(Object.keys(PRESETS) as PresetKey[]).map(k => ({ value: k, label: PRESETS[k].label }))}
              />
            </Box>
            <Box>
              <Text fontSize="xs" fontWeight="600" mb={1}>Folders</Text>
              <HStack gap={1} mb={2} flexWrap="wrap">
                {draft.scopes.map(s => (
                  <Badge key={s} colorPalette="blue" aria-label={`Scope ${s}`}>
                    /{s}
                    <Box as="button" ml={1} aria-label={`Remove scope ${s}`} onClick={() => setDraft({ ...draft, scopes: draft.scopes.filter(x => x !== s) })}><LuX size={11} /></Box>
                  </Badge>
                ))}
              </HStack>
              <HStack gap={2}>
                <Input aria-label="Add folder" value={scopeInput} onChange={e => setScopeInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addScope(); } }} placeholder="finance  (mode-relative; blank = whole workspace)" fontFamily="mono" size="sm" />
                <Button size="sm" variant="outline" aria-label="Add folder button" onClick={addScope}><LuCirclePlus /></Button>
              </HStack>
            </Box>
            <Box>
              <Text fontSize="xs" fontWeight="600" mb={1}>Members</Text>
              <VStack align="stretch" gap={1} maxH="200px" overflowY="auto">
                {roster.map(u => (
                  <HStack key={u.id} as="button" aria-label={`Member ${u.email}`} onClick={() => toggleMember(u.id)} justify="space-between" px={2} py={1} borderRadius="sm" bg={draft.memberIds.includes(u.id) ? 'accent.primary/10' : 'transparent'} cursor="pointer">
                    <Text fontSize="xs" fontFamily="mono">{u.email}</Text>
                    {draft.memberIds.includes(u.id) && <Badge size="sm" colorPalette="blue">member</Badge>}
                  </HStack>
                ))}
                {roster.length === 0 && <Text fontSize="xs" color="fg.muted">No users found.</Text>}
              </VStack>
            </Box>
            <HStack justify="flex-end" gap={2}>
              <Button size="sm" variant="ghost" aria-label="Cancel group edit" onClick={() => { setDraft(null); setScopeInput(''); }}>Cancel</Button>
              <Button size="sm" colorPalette="blue" aria-label="Save group" loading={saving} onClick={save}>Save group</Button>
            </HStack>
          </VStack>
        </Box>
      ) : (
        <Button size="sm" variant="outline" alignSelf="flex-start" fontFamily="mono" aria-label="Add group" onClick={() => setDraft(emptyDraft())}>
          <LuCirclePlus /> Add group
        </Button>
      )}
    </VStack>
  );
}
