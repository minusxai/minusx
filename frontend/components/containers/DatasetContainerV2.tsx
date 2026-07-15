'use client';

/**
 * Dataset container — both halves of static-data-as-files:
 *
 *  CREATE (New → Dataset, virtual negative id): name + schema + either local
 *  file uploads (CSV/XLSX/Parquet) or a link source (Google Sheets). Posts to
 *  /api/datasets — an EDITOR can do this in their own folder, no admin.
 *
 *  VIEW (real id): the dataset's tables with per-table EXPOSE checkboxes
 *  (rendered by the same SchemaColumnRow primitive the whitelist tree uses).
 *  Unchecking hides the table from the query surface (content.hiddenTables) —
 *  exposure, not deletion; the name stays held.
 */

import React, { useMemo, useRef, useState } from 'react';
import { Box, VStack, HStack, Text, Button, Input } from '@chakra-ui/react';
import { LuTable, LuUpload, LuLink, LuSave, LuTrash2, LuRefreshCw, LuPlus } from 'react-icons/lu';
import { useSearchParams } from 'next/navigation';
import { useFile } from '@/lib/hooks/file-state-hooks';
import { reloadFile } from '@/lib/file-state/file-state';
import { editFile, publishFile } from '@/lib/file-state/file-state';
import { useNavigationGuard } from '@/lib/navigation/NavigationGuardProvider';
import SchemaColumnRow from '@/components/schema-browser/SchemaColumnRow';
import { createDatasetFromUploads, createDatasetFromLink, addFilesToDataset, deleteDatasetTable, reimportDatasetGroup } from '@/lib/connections/client/dataset-upload';
import { tableKey, FILES_CONNECTION } from '@/lib/types/datasets';
import type { DatasetContent } from '@/lib/types/datasets';
import type { FileComponentProps } from '@/lib/ui/fileComponents';

export default function DatasetContainerV2({ fileId, mode, defaultFolder }: FileComponentProps) {
  const isCreate = mode === 'create' || (typeof fileId === 'number' && fileId < 0);
  return isCreate ? <DatasetCreate defaultFolder={defaultFolder} /> : <DatasetView fileId={fileId as number} />;
}

function DatasetCreate({ defaultFolder }: { defaultFolder?: string }) {
  const searchParams = useSearchParams();
  const { navigate } = useNavigationGuard();
  const folder = defaultFolder || searchParams?.get('folder') || '/org';
  const [name, setName] = useState('');
  const [schemaName, setSchemaName] = useState('public');
  const [link, setLink] = useState('');
  const [stage, setStage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [picked, setPicked] = useState<File[]>([]);

  const submit = async () => {
    setError(null);
    if (!name.trim()) { setError('Give the dataset a name'); return; }
    if (picked.length === 0 && !link.trim()) { setError('Pick files to upload, or paste a link'); return; }
    setStage('Working…');
    const result = picked.length > 0
      ? await createDatasetFromUploads(folder, name.trim(), schemaName.trim() || 'public', picked, setStage)
      : await createDatasetFromLink(folder, name.trim(), schemaName.trim() || 'public', link.trim());
    setStage(null);
    if (!result.success) { setError(result.message ?? 'Could not create the dataset'); return; }
    navigate(`/f/${result.id}`);
  };

  return (
    <VStack align="stretch" gap={4} p={6} maxW="640px" aria-label="New dataset">
      <HStack gap={2}><LuTable size={18} /><Text fontSize="lg" fontWeight="700">New dataset</Text></HStack>
      <Text fontSize="xs" color="fg.muted" fontFamily="mono">
        Data you add here becomes queryable immediately — in this folder ({folder}) and every folder beneath it.
      </Text>

      <HStack gap={2}>
        <Input aria-label="Dataset name" size="sm" fontFamily="mono" maxW="240px"
          placeholder="dataset_name" value={name} onChange={(e) => setName(e.target.value)} />
        <Input aria-label="Dataset schema" size="sm" fontFamily="mono" maxW="180px"
          placeholder="schema (public)" value={schemaName} onChange={(e) => setSchemaName(e.target.value)} />
      </HStack>

      <Box border="1px dashed" borderColor="border.muted" borderRadius="md" p={4}>
        <HStack gap={2}>
          <Button aria-label="Pick files to upload" size="xs" variant="outline" onClick={() => fileInput.current?.click()}>
            <LuUpload size={12} /> <Text ml={1}>Upload files</Text>
          </Button>
          <input
            ref={fileInput} type="file" multiple hidden aria-label="Dataset file input"
            accept=".csv,.xlsx,.parquet"
            onChange={(e) => setPicked([...(e.target.files ?? [])])}
          />
          <Text fontSize="xs" color="fg.muted" fontFamily="mono">
            {picked.length > 0 ? picked.map((f) => f.name).join(', ') : 'CSV, Excel or Parquet — each file becomes a table'}
          </Text>
        </HStack>
        <HStack gap={2} mt={3}>
          <LuLink size={12} />
          <Input aria-label="Dataset link URL" size="xs" fontFamily="mono"
            placeholder="…or paste a Google Sheets link" value={link} onChange={(e) => setLink(e.target.value)} />
        </HStack>
      </Box>

      <HStack justify="flex-end" gap={2}>
        {stage && <Text fontSize="xs" color="fg.muted" fontFamily="mono">{stage}</Text>}
        <Button aria-label="Create dataset" size="sm" bg="accent.teal" color="white" onClick={submit} loading={!!stage}>
          Create dataset
        </Button>
      </HStack>
      {error && <Text aria-label="Dataset error" fontSize="xs" color="accent.danger" fontFamily="mono">{error}</Text>}
    </VStack>
  );
}

function DatasetView({ fileId }: { fileId: number }) {
  const { fileState } = useFile(fileId) ?? {};
  const content = fileState?.content as DatasetContent | undefined;
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const addInput = useRef<HTMLInputElement>(null);
  const hidden = useMemo(() => new Set(content?.hiddenTables ?? []), [content]);

  if (!content) return <Box p={6}><Text fontSize="sm" color="fg.muted" fontFamily="mono">Loading dataset…</Text></Box>;

  /** Run a lifecycle action, then force-reload the doc so the page reflects it. */
  const act = async (fn: () => Promise<{ success: boolean; message?: string }>) => {
    setActionError(null);
    setSaving(true);
    try {
      const result = await fn();
      if (!result.success) { setActionError(result.message ?? 'Action failed'); return; }
      await reloadFile({ fileId });
    } finally {
      setSaving(false);
    }
  };

  const addFiles = (files: File[]) => {
    if (files.length === 0) return;
    const schema = content.files?.[0]?.schema_name ?? 'public';
    void act(() => addFilesToDataset(fileId, fileState?.name ?? 'dataset', schema, files));
  };

  const toggle = async (key: string) => {
    const next = new Set(hidden);
    if (next.has(key)) next.delete(key); else next.add(key);
    const nextContent: DatasetContent = { ...content, hiddenTables: [...next] };
    setSaving(true);
    try {
      editFile({ fileId, changes: { content: nextContent } });
      await publishFile({ fileId });
    } finally {
      setSaving(false);
    }
  };

  return (
    <VStack align="stretch" gap={3} p={6} aria-label="Dataset tables">
      <HStack justify="space-between">
        <HStack gap={2}><LuTable size={16} /><Text fontSize="sm" fontWeight="700">Tables</Text></HStack>
        <HStack gap={2}>
          {saving && <LuSave size={12} />}
          <Text fontSize="xs" color="fg.muted" fontFamily="mono">
            query these via the <Text as="span" fontWeight="700">{FILES_CONNECTION}</Text> connection — here and in every folder beneath
          </Text>
          <Button aria-label="Add files to dataset" size="2xs" variant="outline" onClick={() => addInput.current?.click()}>
            <LuPlus size={11} /> <Text ml={1}>Add files</Text>
          </Button>
          <input ref={addInput} type="file" multiple hidden aria-label="Add files input"
            accept=".csv,.xlsx,.parquet" onChange={(e) => addFiles([...(e.target.files ?? [])])} />
        </HStack>
      </HStack>
      {actionError && <Text aria-label="Dataset action error" fontSize="xs" color="accent.danger" fontFamily="mono">{actionError}</Text>}
      <Box border="1px solid" borderColor="border.muted" borderRadius="md" overflow="hidden">
        {(content.files ?? []).map((t) => (
          <SchemaColumnRow
            key={tableKey(t)}
            ariaLabel={`Dataset table ${tableKey(t)}`}
            name={`${t.schema_name}.${t.table_name}`}
            type={`${t.row_count} rows`}
            selection={{
              checked: !hidden.has(tableKey(t)),
              onToggle: () => toggle(tableKey(t)),
              ariaLabel: `Expose table ${tableKey(t)}`,
            }}
            description={
              <HStack gap={2} minW={0}>
                <Text fontSize="2xs" color="fg.muted" truncate>
                  {t.source === 'link' ? (t.source_url ?? 'link') : t.filename} · {t.columns.length} columns
                </Text>
                {t.source === 'link' && t.source_group && (
                  <Box as="button" aria-label={`Re-import ${tableKey(t)}`} title="Re-import from source"
                    color="accent.teal" cursor="pointer"
                    onClick={() => void act(() => reimportDatasetGroup(fileId, t.source_group!))}>
                    <LuRefreshCw size={11} />
                  </Box>
                )}
                <Box as="button" aria-label={`Delete table ${tableKey(t)}`} title="Delete table"
                  color="accent.danger" cursor="pointer"
                  onClick={() => void act(() => deleteDatasetTable(fileId, tableKey(t)))}>
                  <LuTrash2 size={11} />
                </Box>
              </HStack>
            }
          />
        ))}
      </Box>
    </VStack>
  );
}
