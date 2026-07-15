'use client';

/**
 * Databases settings — DB connections managed in the org config's `databases`
 * section (Settings → Databases), exactly like LLM providers in the Models tab.
 *
 * Field specs come from the shared compatibility.json contract (the same file
 * the connection form, setup.sh and the docs consume), so this tab never
 * drifts from what the product supports. Static sources (CSV / XLSX / Sheets)
 * are deliberately NOT offered here: they are DATASETS — files in folders any
 * editor can add — not infrastructure.
 *
 * Secrets: saved credentials arrive as `@SECRETS/…` refs. The editor never
 * shows a ref; the field renders empty with a "saved" placeholder, and typing
 * a new value replaces the secret server-side on save (extractConfigSecrets).
 */

import { useMemo, useState } from 'react';
import { Box, VStack, HStack, Text, Button, Input, NativeSelect } from '@chakra-ui/react';
import { LuDatabase, LuPlus, LuTrash2, LuPencil, LuSave } from 'react-icons/lu';
import { useConfigs, updateConfig } from '@/lib/hooks/useConfigs';
import { isSecretRef } from '@/lib/secrets/config-secret-specs';
import compatibility from '@/compatibility.json';
import type { DatabaseConfigEntry } from '@/lib/config/database-config-types';

interface FieldSpec {
  key: string; label: string; kind: string;
  required?: boolean; secret?: boolean; default?: string | number; note?: string; options?: string[];
}
interface TypeSpec { type: string; name: string; fields: FieldSpec[] }

/** Connection types this tab offers: everything with a field spec (static
 *  sources have none — they're datasets, not connections). */
const DB_TYPES: TypeSpec[] = (compatibility.connections.types as TypeSpec[]).filter((t) => t.fields.length > 0);

const specFor = (type: string): TypeSpec | undefined => DB_TYPES.find((t) => t.type === type);

export function DatabasesSection() {
  const { config } = useConfigs();
  const saved = useMemo<DatabaseConfigEntry[]>(
    () => ((config as { databases?: { connections?: DatabaseConfigEntry[] } }).databases?.connections ?? []),
    [config],
  );

  const [entries, setEntries] = useState<DatabaseConfigEntry[]>(saved);
  const [editing, setEditing] = useState<string | null>(null); // entry name or '' for new
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState(DB_TYPES[0]?.type ?? 'postgresql');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);

  const patchEntry = (name: string, field: string, value: string) => {
    setEntries((prev) => prev.map((e) => (e.name === name ? { ...e, config: { ...e.config, [field]: value } } : e)));
  };

  const addEntry = () => {
    const name = newName.trim();
    if (!name) { setError('Give the connection a name'); return; }
    if (entries.some((e) => e.name === name)) { setError(`'${name}' already exists`); return; }
    const spec = specFor(newType);
    const defaults: Record<string, unknown> = {};
    for (const f of spec?.fields ?? []) if (f.default !== undefined) defaults[f.key] = f.default;
    setEntries((prev) => [...prev, { name, type: newType, config: defaults }]);
    setEditing(name);
    setNewName('');
    setError(null);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await updateConfig({ databases: { connections: entries } } as never);
      setEditing(null);
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  const fieldValue = (entry: DatabaseConfigEntry, key: string): string => {
    const v = entry.config[key];
    if (v === undefined || v === null || isSecretRef(v)) return '';
    return String(v);
  };

  return (
    <VStack align="stretch" gap={4} aria-label="Databases settings">
      <HStack justify="space-between">
        <HStack gap={2}>
          <LuDatabase size={16} />
          <Text fontWeight="700" fontSize="sm">Database connections</Text>
        </HStack>
        <Button aria-label="Save database connections" size="xs" bg="accent.teal" color="white" onClick={save} loading={saving}>
          <LuSave size={12} /> <Text ml={1}>{savedFlash ? 'Saved' : 'Save'}</Text>
        </Button>
      </HStack>
      <Text fontSize="xs" color="fg.muted" fontFamily="mono">
        Warehouse connections are infrastructure, managed here in config. CSV / Excel / Google Sheets are
        datasets — add those as files in any folder instead.
      </Text>

      {entries.map((entry) => {
        const spec = specFor(entry.type);
        const isOpen = editing === entry.name;
        return (
          <Box key={entry.name} aria-label={`Database connection ${entry.name}`} border="1px solid" borderColor="border.muted" borderRadius="md" p={3}>
            <HStack justify="space-between">
              <HStack gap={2} minW={0}>
                <Text fontSize="sm" fontWeight="600" fontFamily="mono" truncate>{entry.name}</Text>
                <Text fontSize="10px" fontFamily="mono" color="fg.subtle" bg="bg.muted" px={1.5} py={0.5} borderRadius="sm">
                  {entry.type}
                </Text>
              </HStack>
              <HStack gap={1}>
                <Button aria-label={`Edit connection ${entry.name}`} size="2xs" variant="ghost" onClick={() => setEditing(isOpen ? null : entry.name)}>
                  <LuPencil size={11} />
                </Button>
                <Button aria-label={`Delete connection ${entry.name}`} size="2xs" variant="ghost" colorPalette="red"
                  onClick={() => setEntries((prev) => prev.filter((e) => e.name !== entry.name))}>
                  <LuTrash2 size={11} />
                </Button>
              </HStack>
            </HStack>

            {isOpen && (
              <VStack align="stretch" gap={2} mt={3}>
                {(spec?.fields ?? []).map((f) => {
                  const savedSecret = f.secret && isSecretRef(entry.config[f.key]);
                  return (
                    <HStack key={f.key} gap={2}>
                      <Text w="160px" flexShrink={0} fontSize="xs" fontFamily="mono" color="fg.muted">
                        {f.label}{f.required ? ' *' : ''}
                      </Text>
                      <Input
                        aria-label={`${entry.name} ${f.label}`}
                        size="xs" fontFamily="mono"
                        type={f.secret ? 'password' : 'text'}
                        value={fieldValue(entry, f.key)}
                        placeholder={savedSecret ? '•••• (saved — type to replace)' : (f.note ?? (f.default !== undefined ? String(f.default) : ''))}
                        onChange={(e) => patchEntry(entry.name, f.key, e.target.value)}
                      />
                    </HStack>
                  );
                })}
              </VStack>
            )}
          </Box>
        );
      })}

      <Box border="1px dashed" borderColor="border.muted" borderRadius="md" p={3}>
        <HStack gap={2}>
          <NativeSelect.Root size="xs" w="180px">
            <NativeSelect.Field aria-label="New connection type" value={newType} onChange={(e) => setNewType(e.target.value)}>
              {DB_TYPES.map((t) => <option key={t.type} value={t.type}>{t.name}</option>)}
            </NativeSelect.Field>
            <NativeSelect.Indicator />
          </NativeSelect.Root>
          <Input aria-label="New connection name" size="xs" fontFamily="mono" maxW="220px"
            placeholder="connection_name" value={newName} onChange={(e) => setNewName(e.target.value)} />
          <Button aria-label="Add database connection" size="xs" variant="outline" onClick={addEntry}>
            <LuPlus size={12} /> <Text ml={1}>Add</Text>
          </Button>
        </HStack>
      </Box>

      {error && <Text aria-label="Databases settings error" fontSize="xs" color="accent.danger" fontFamily="mono">{error}</Text>}
    </VStack>
  );
}
