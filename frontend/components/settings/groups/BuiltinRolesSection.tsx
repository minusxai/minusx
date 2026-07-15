'use client';

/**
 * Built-in roles (Access V2) — every user has exactly one role; it sets their
 * base file-type capabilities (applied to their home folder). Admin is locked.
 * Editing editor/viewer writes the org config's `accessRules` override — the
 * UI equivalent of hand-editing that JSON, kept SQL-compilable by construction
 * (it's still just type sets feeding the same predicate).
 */
import { useCallback, useEffect, useState } from 'react';
import { Badge, Box, Button, Flex, HStack, Text, VStack } from '@chakra-ui/react';
import { toaster } from '@/components/ui/toaster';
import type { FileType } from '@/lib/types';

type TypeSet = '*' | FileType[];
interface RoleRule { role: string; locked: boolean; overridden: boolean; allowedTypes: TypeSet; createTypes: TypeSet; viewTypes: TypeSet }

/** The user-facing types worth toggling (system types stay rule-file-managed). */
const EDITABLE_TYPES: FileType[] = ['question', 'dashboard', 'story', 'notebook', 'report', 'alert', 'folder', 'context', 'connection'];

const summarize = (s: TypeSet) => (s === '*' ? 'all types' : s.length === 0 ? 'none' : `${s.length} types`);

export function BuiltinRolesSection() {
  const [roles, setRoles] = useState<RoleRule[]>([]);
  const [editing, setEditing] = useState<RoleRule | null>(null);
  const [saving, setSaving] = useState(false);

  const reload = useCallback(async () => {
    const res = await fetch('/api/access-rules', { credentials: 'include' });
    const body = await res.json().catch(() => null);
    if (body?.data?.roles) setRoles(body.data.roles);
  }, []);
  useEffect(() => { reload(); }, [reload]);

  const toggle = (field: 'allowedTypes' | 'createTypes' | 'viewTypes', t: FileType) => {
    if (!editing) return;
    const cur = editing[field];
    const arr = cur === '*' ? [...EDITABLE_TYPES] : [...cur];
    const next = arr.includes(t) ? arr.filter(x => x !== t) : [...arr, t];
    setEditing({ ...editing, [field]: next });
  };

  const save = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      const res = await fetch('/api/access-rules', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ accessRules: { [editing.role]: { allowedTypes: editing.allowedTypes, createTypes: editing.createTypes, viewTypes: editing.viewTypes } } }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error?.message ?? 'Save failed');
      toaster.create({ title: `${editing.role} capabilities updated`, type: 'success' });
      setEditing(null);
      await reload();
    } catch (e) {
      toaster.create({ title: e instanceof Error ? e.message : 'Save failed', type: 'error' });
    } finally { setSaving(false); }
  };

  const has = (s: TypeSet, t: FileType) => s === '*' || s.includes(t);

  return (
    <VStack align="stretch" gap={3} aria-label="Built-in roles">
      <Box>
        <Text fontSize="sm" fontWeight="semibold" fontFamily="mono" mb={1}>Built-in roles</Text>
        <Text fontSize="xs" color="fg.muted" fontFamily="mono">
          Every user has one role — it sets their base capabilities (applied to their home folder). Groups add on top.
        </Text>
      </Box>
      {roles.map(r => (
        <Flex key={r.role} align="center" justify="space-between" p={3} borderWidth="1px" borderColor="border.default" borderRadius="md" aria-label={`Role ${r.role}`}>
          <Box>
            <HStack gap={2}>
              <Text fontWeight="600" fontFamily="mono">{r.role}</Text>
              {r.locked && <Badge size="sm" colorPalette="orange">locked</Badge>}
              {r.overridden && <Badge size="sm" colorPalette="blue">customized</Badge>}
            </HStack>
            <Text fontSize="xs" color="fg.muted" fontFamily="mono" mt={1}>
              access: {summarize(r.allowedTypes)} · view: {summarize(r.viewTypes)} · build: {summarize(r.createTypes)}
            </Text>
          </Box>
          {!r.locked && (
            <Button size="xs" variant="outline" aria-label={`Edit role ${r.role}`} onClick={() => setEditing(r)}>Edit</Button>
          )}
        </Flex>
      ))}

      {editing && (
        <Box p={4} borderWidth="1px" borderColor="accent.primary/40" borderRadius="md" aria-label="Role capability editor">
          <Text fontSize="sm" fontWeight="600" fontFamily="mono" mb={3}>Capabilities for {editing.role}</Text>
          <Box overflowX="auto">
            <VStack align="stretch" gap={1}>
              <HStack gap={0} fontSize="xs" fontWeight="600" color="fg.muted">
                <Box w="140px">type</Box><Box w="70px">view</Box><Box w="70px">access</Box><Box w="70px">build</Box>
              </HStack>
              {EDITABLE_TYPES.map(t => (
                <HStack key={t} gap={0} fontSize="xs" fontFamily="mono">
                  <Box w="140px">{t}</Box>
                  {(['viewTypes', 'allowedTypes', 'createTypes'] as const).map(field => (
                    <Box key={field} w="70px">
                      <input
                        type="checkbox"
                        aria-label={`${editing.role} ${field} ${t}`}
                        checked={has(editing[field], t)}
                        onChange={() => toggle(field, t)}
                      />
                    </Box>
                  ))}
                </HStack>
              ))}
            </VStack>
          </Box>
          <HStack justify="flex-end" gap={2} mt={3}>
            <Button size="sm" variant="ghost" aria-label="Cancel role edit" onClick={() => setEditing(null)}>Cancel</Button>
            <Button size="sm" colorPalette="blue" aria-label="Save role capabilities" loading={saving} onClick={save}>Save</Button>
          </HStack>
        </Box>
      )}
    </VStack>
  );
}
