'use client';

/**
 * StaticConnectionConfig — unified UI for the "static" CSV connection.
 *
 * The static connection is the single landing zone for all user-uploaded CSV/xlsx files
 * and Google Sheets imports within a given mode (org, tutorial, etc.).
 * It replaces the old pattern of creating separate CSV or Google Sheets connections.
 *
 * Features:
 * - Upload CSV / xlsx files (multiple, per-file schema + table name)
 * - Add a Google Sheet (URL + schema, all sheets become tables)
 * - View all registered tables grouped by source (CSV files vs Google Sheets groups)
 * - Rename schema/table for any registered file inline (no S3 changes — pure metadata update)
 * - Collision detection: warns and blocks when two files share the same schema.table name
 * - Delete individual CSV tables (removes S3 object + drops from files list)
 * - Delete an entire Google Sheets group (all sheets from one spreadsheet)
 * - Re-import a Google Sheet (refresh data from the live spreadsheet)
 */

import { useRef, useState } from 'react';
import Image from 'next/image';
import { useSearchParams } from 'next/navigation';
import {
  Box,
  Text,
  VStack,
  HStack,
  Button,
  Input,
  Spinner,
  IconButton,
  Collapsible,
  Dialog,
  Portal,
} from '@chakra-ui/react';
import {
  LuUpload,
  LuX,
  LuFile,
  LuLink,
  LuRefreshCw,
  LuTrash2,
  LuTable,
  LuChevronDown,
  LuChevronRight,
  LuCheck,
  LuPencil,
  LuCircleAlert,
  LuDatabase,
} from 'react-icons/lu';
import { CsvFileInfo } from '@/lib/types';
import { uploadCsvFilesS3, FileWithSchema } from '@/lib/backend/csv-upload';
import { importGoogleSheets, reimportGoogleSheets } from '@/lib/backend/google-sheets';
import { sanitizeTableName, validateIdentifier } from '@/lib/csv-utils';
import { BaseConfigProps } from './types';

// ─── Types ────────────────────────────────────────────────────────────────────

interface StaticConnectionConfigProps extends BaseConfigProps {
  userMode: string;
  onError: (error: string) => void;
  onPendingDeletion?: (s3Key: string) => void;
  onSave?: () => void;
}

interface PendingFile {
  file: File;
  schemaName: string;
  tableName: string;
}

type ActivePanel = null | 'csv-upload' | 'sheets-add';

// ─── Helpers ─────────────────────────────────────────────────────────────────

type DisplayItem =
  | { kind: 'csv'; file: CsvFileInfo }
  | { kind: 'sheets'; id: string; files: CsvFileInfo[] };

/**
 * Build a unified ordered display list from config.files, preserving array order so
 * newly-prepended items always appear at the top. Sheets with the same spreadsheet_id
 * are grouped at the position of their first occurrence.
 */
function buildDisplayItems(files: CsvFileInfo[]): DisplayItem[] {
  const sheetsMap = new Map<string, CsvFileInfo[]>();
  for (const f of files) {
    if (f.source_type === 'google_sheets' && f.spreadsheet_id) {
      if (!sheetsMap.has(f.spreadsheet_id)) sheetsMap.set(f.spreadsheet_id, []);
      sheetsMap.get(f.spreadsheet_id)!.push(f);
    }
  }

  const items: DisplayItem[] = [];
  const seenIds = new Set<string>();
  for (const f of files) {
    if (f.source_type === 'google_sheets' && f.spreadsheet_id) {
      if (!seenIds.has(f.spreadsheet_id)) {
        seenIds.add(f.spreadsheet_id);
        items.push({ kind: 'sheets', id: f.spreadsheet_id, files: sheetsMap.get(f.spreadsheet_id)! });
      }
    } else {
      items.push({ kind: 'csv', file: f });
    }
  }
  return items;
}

/** @deprecated use buildDisplayItems; kept for collision detection which still needs both lists */
function groupFiles(files: CsvFileInfo[]): {
  csvFiles: CsvFileInfo[];
  sheetsGroups: Map<string, CsvFileInfo[]>;
} {
  const csvFiles: CsvFileInfo[] = [];
  const sheetsGroups = new Map<string, CsvFileInfo[]>();
  for (const f of files) {
    if (f.source_type === 'google_sheets' && f.spreadsheet_id) {
      if (!sheetsGroups.has(f.spreadsheet_id)) sheetsGroups.set(f.spreadsheet_id, []);
      sheetsGroups.get(f.spreadsheet_id)!.push(f);
    } else {
      csvFiles.push(f);
    }
  }
  return { csvFiles, sheetsGroups };
}

/** Group display items by schema_name, preserving order of first occurrence. */
function groupBySchema(items: DisplayItem[]): { schema: string; items: DisplayItem[] }[] {
  const map = new Map<string, DisplayItem[]>();
  for (const item of items) {
    const schema = item.kind === 'csv'
      ? item.file.schema_name
      : item.files[0]?.schema_name ?? 'unknown';
    if (!map.has(schema)) map.set(schema, []);
    map.get(schema)!.push(item);
  }
  return Array.from(map.entries()).map(([schema, items]) => ({ schema, items }));
}

/**
 * Find all schema.table pairs that appear more than once in the files list.
 * Returns a Set of "schema.table" strings that are duplicated.
 */
function findCollisions(files: CsvFileInfo[]): Set<string> {
  const seen = new Map<string, number>();
  for (const f of files) {
    const key = `${f.schema_name}.${f.table_name}`;
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  const collisions = new Set<string>();
  for (const [key, count] of seen) {
    if (count >= 2) collisions.add(key);
  }
  return collisions;
}

// ─── Inline rename row ────────────────────────────────────────────────────────

interface FileRowProps {
  f: CsvFileInfo;
  isCollision: boolean;
  editingKey: string | null;
  editSchema: string;
  editTable: string;
  editError: string;
  onStartEdit: (f: CsvFileInfo) => void;
  onEditSchema: (v: string) => void;
  onEditTable: (v: string) => void;
  onConfirmRename: (s3Key: string) => void;
  onCancelEdit: () => void;
  onDelete: (s3Key: string) => void;
  /** Extra indent for nested rows (e.g. inside a sheets group) */
  nested?: boolean;
}

function FileRow({
  f, isCollision, editingKey, editSchema, editTable, editError,
  onStartEdit, onEditSchema, onEditTable, onConfirmRename, onCancelEdit, onDelete,
  nested = false,
}: FileRowProps) {
  const tableInputRef = useRef<HTMLInputElement>(null);
  const isEditing = editingKey === f.s3_key;
  const colPreview = f.columns.slice(0, 4).map((c) => c.name).join(', ')
    + (f.columns.length > 4 ? ` +${f.columns.length - 4}` : '');

  if (isEditing) {
    return (
      <Box
        px={3}
        py={2}
        borderRadius="md"
        border="1px solid"
        borderColor="accent.teal"
        bg="accent.teal/5"
      >
        <HStack gap={1} align="center" wrap="nowrap">
          <Input
            size="xs"
            fontFamily="mono"
            w="24"
            value={editSchema}
            onChange={(e) => onEditSchema(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { tableInputRef.current?.focus(); }
              if (e.key === 'Escape') onCancelEdit();
            }}
            aria-label="Schema name"
            autoFocus
          />
          <Text fontSize="xs" flexShrink={0} color="fg.muted">.</Text>
          <Input
            ref={tableInputRef}
            size="xs"
            fontFamily="mono"
            w="28"
            value={editTable}
            onChange={(e) => onEditTable(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onConfirmRename(f.s3_key);
              if (e.key === 'Escape') onCancelEdit();
            }}
            aria-label="Table name"
          />
          <IconButton size="xs" variant="ghost" colorPalette="green" aria-label="Confirm rename" onClick={() => onConfirmRename(f.s3_key)}>
            <LuCheck />
          </IconButton>
          <IconButton size="xs" variant="ghost" aria-label="Cancel rename" onClick={onCancelEdit}>
            <LuX />
          </IconButton>
        </HStack>
        {editError && (
          <Text fontSize="2xs" color="red.400" mt={1}>{editError}</Text>
        )}
      </Box>
    );
  }

  return (
    <HStack
      role="group"
      gap={2}
      px={3}
      py={1.5}
      borderRadius="md"
      transition="background 0.1s"
      _hover={{ bg: 'bg.surface' }}
      cursor="default"
    >
      <Text
        fontSize="xs"
        fontFamily="mono"
        fontWeight="600"
        color={isCollision ? 'red.400' : 'fg.default'}
        truncate
        flex={1}
        minW={0}
        title={colPreview}
      >
        {f.table_name}
      </Text>
      {isCollision && (
        <Box as="span" display="inline-flex" title="Duplicate name — rename to resolve" flexShrink={0}>
          <LuCircleAlert size={10} color="var(--chakra-colors-red-400)" />
        </Box>
      )}
      <Text fontSize="2xs" color="fg.subtle" fontFamily="mono" whiteSpace="nowrap" flexShrink={0}>
        {f.row_count.toLocaleString()} rows
      </Text>
      <IconButton
        size="2xs"
        variant="ghost"
        aria-label={`Rename ${f.schema_name}.${f.table_name}`}
        color="fg.muted"
        onClick={() => onStartEdit(f)}
      >
        <LuPencil size={11} />
      </IconButton>
      <IconButton
        size="2xs"
        variant="ghost"
        colorPalette="red"
        aria-label={`Delete table ${f.table_name}`}
        onClick={() => onDelete(f.s3_key)}
      >
        <LuTrash2 size={11} />
      </IconButton>
    </HStack>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function StaticConnectionConfig({
  config,
  onChange,
  userMode,
  onError,
  onPendingDeletion,
  onSave,
}: StaticConnectionConfigProps) {
  // ── Panel toggle ──────────────────────────────────────────────────────────
  const searchParams = useSearchParams();
  const tabParam = searchParams.get('tab');
  const [activePanel, setActivePanel] = useState<ActivePanel>(
    tabParam === 'sheets' ? 'sheets-add' : 'csv-upload'
  );

  // ── CSV upload state ──────────────────────────────────────────────────────
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const [uploadProgress, setUploadProgress] = useState<'idle' | 'uploading' | 'done' | 'error'>('idle');
  const [uploadStage, setUploadStage] = useState<string>('');

  // ── Google Sheets add state ───────────────────────────────────────────────
  const [pendingSheets, setPendingSheets] = useState<Array<{ url: string; schema: string; tableName: string }>>([
    { url: '', schema: '', tableName: '' },
  ]);
  const [importProgress, setImportProgress] = useState<'idle' | 'importing' | 'done' | 'error'>('idle');
  const [importStage, setImportStage] = useState<string>('');

  // ── Per-item loading states ───────────────────────────────────────────────
  const [reimportingId, setReimportingId] = useState<string | null>(null);

  // ── Existing tables open/close ─────────────────────────────────────────────
  const [tablesOpen, setTablesOpen] = useState(false);

  // ── Schema expand/collapse ────────────────────────────────────────────────
  const [collapsedSchemas, setCollapsedSchemas] = useState<Set<string>>(new Set());
  const toggleSchema = (schema: string) => {
    setCollapsedSchemas((prev) => {
      const next = new Set(prev);
      if (next.has(schema)) next.delete(schema);
      else next.add(schema);
      return next;
    });
  };

  // ── Delete confirmation state ──────────────────────────────────────────────
  const [deleteTarget, setDeleteTarget] = useState<{ type: 'file'; s3Key: string; name: string } | { type: 'sheets'; id: string; name: string } | null>(null);

  // ── Inline rename state ───────────────────────────────────────────────────
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editSchema, setEditSchema] = useState('');
  const [editTable, setEditTable] = useState('');
  const [editError, setEditError] = useState('');

  const existingFiles = (config.files ?? []) as CsvFileInfo[];
  const { sheetsGroups } = groupFiles(existingFiles);
  const displayItems = buildDisplayItems(existingFiles);
  const collisionSet = findCollisions(existingFiles);

  // ── Rename handlers ───────────────────────────────────────────────────────

  const handleStartEdit = (f: CsvFileInfo) => {
    setEditingKey(f.s3_key);
    setEditSchema(f.schema_name);
    setEditTable(f.table_name);
    setEditError('');
  };

  const handleCancelEdit = () => {
    setEditingKey(null);
    setEditError('');
  };

  const handleConfirmRename = (s3Key: string) => {
    const schemaErr = validateIdentifier(editSchema);
    if (schemaErr) { setEditError(`Schema: ${schemaErr}`); return; }
    const tableErr = validateIdentifier(editTable);
    if (tableErr) { setEditError(`Table: ${tableErr}`); return; }

    // Collision check — exclude the file being renamed
    const others = existingFiles.filter((f) => f.s3_key !== s3Key);
    if (others.some((f) => f.schema_name === editSchema && f.table_name === editTable)) {
      setEditError(`${editSchema}.${editTable} is already used by another file`);
      return;
    }

    onChange({
      files: existingFiles.map((f) =>
        f.s3_key === s3Key ? { ...f, schema_name: editSchema, table_name: editTable } : f
      ),
    });
    setEditingKey(null);
    setEditError('');
  };

  // ── CSV upload handlers ───────────────────────────────────────────────────

  const handleFilesSelected = (selected: File[]) => {
    setPendingFiles(
      selected.map((file) => ({
        file,
        schemaName: '',
        tableName: sanitizeTableName(file.name),
      })),
    );
    setUploadProgress('idle');
    setActivePanel('csv-upload');
  };

  const handleUpload = async () => {
    if (pendingFiles.length === 0) { onError('Please select at least one file'); return; }

    // Block upload if existing files have unresolved name collisions
    if (collisionSet.size > 0) {
      onError('Resolve name conflicts in existing files before uploading more');
      return;
    }

    for (const { schemaName, tableName } of pendingFiles) {
      if (!schemaName) { onError('Please enter a dataset name'); return; }
      const schemaErr = validateIdentifier(schemaName);
      if (schemaErr) { onError(`Dataset name "${schemaName}": ${schemaErr}`); return; }
      const tableErr = tableName ? validateIdentifier(tableName) : null;
      if (tableErr) { onError(`Table "${tableName}": ${tableErr}`); return; }
    }

    // Check that pending files don't conflict with existing files or each other
    for (let i = 0; i < pendingFiles.length; i++) {
      const { schemaName, tableName, file } = pendingFiles[i];
      const resolvedTable = tableName || sanitizeTableName(file.name);
      const key = `${schemaName}.${resolvedTable}`;

      const conflictsExisting = existingFiles.some(
        (f) => f.schema_name === schemaName && f.table_name === resolvedTable
      );
      if (conflictsExisting) {
        onError(`"${key}" already exists — rename the file or choose a different table name`);
        return;
      }

      const conflictsPending = pendingFiles.slice(0, i).some((p) => {
        const pt = p.tableName || sanitizeTableName(p.file.name);
        return p.schemaName === schemaName && pt === resolvedTable;
      });
      if (conflictsPending) {
        onError(`Two selected files would both map to "${key}" — rename one of them`);
        return;
      }
    }

    setUploadProgress('uploading');
    try {
      const filesWithSchema: FileWithSchema[] = pendingFiles.map(({ file, schemaName, tableName }) => ({
        file,
        schemaName: schemaName || 'public',
        tableName: tableName || undefined,
      }));

      const result = await uploadCsvFilesS3('static', filesWithSchema, false, setUploadStage);

      if (!result.success) { onError(result.message); setUploadProgress('error'); return; }

      // Tag each file with source_type so the UI knows it came from a CSV upload
      const newFiles: CsvFileInfo[] = (result.config!.files ?? []).map((f) => ({
        ...f,
        source_type: 'csv' as const,
      }));

      const uploadedSchema = pendingFiles[0]?.schemaName || 'public';
      onChange({ files: [...newFiles, ...existingFiles] });
      setUploadProgress('done');
      setPendingFiles([]);
      setTablesOpen(true);
      // Collapse all schemas except the newly uploaded one
      const allSchemas = new Set([...existingFiles.map(f => f.schema_name), uploadedSchema]);
      allSchemas.delete(uploadedSchema);
      setCollapsedSchemas(allSchemas);
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Upload failed');
      setUploadProgress('error');
    }
  };

  // ── Google Sheets add handler ─────────────────────────────────────────────

  const handleSheetImport = async () => {
    const validSheets = pendingSheets.filter((s) => s.url.trim());
    if (validSheets.length === 0) { onError('Please enter at least one Google Sheets URL'); return; }
    if (!pendingSheets[0]?.schema) { onError('Please enter a dataset name'); return; }

    for (const s of validSheets) {
      if (!s.url.includes('docs.google.com/spreadsheets')) {
        onError(`Invalid URL: ${s.url}`);
        return;
      }
      const schemaErr = s.schema ? validateIdentifier(s.schema) : null;
      if (schemaErr) { onError(`Schema "${s.schema}": ${schemaErr}`); return; }
      const tableErr = s.tableName ? validateIdentifier(s.tableName) : null;
      if (tableErr) { onError(`Table name "${s.tableName}": ${tableErr}`); return; }
    }
    setImportProgress('importing');
    setImportStage('Downloading from Google Sheets…');
    let allNewFiles: CsvFileInfo[] = [];
    try {
      for (const sheet of validSheets) {
        const result = await importGoogleSheets('static', sheet.url, false, sheet.schema || 'public');
        if (!result.success) { onError(result.message); setImportProgress('error'); return; }

        const spreadsheetFiles: CsvFileInfo[] = (result.config!.files ?? []).map((f, idx) => ({
          ...f,
          // Override table name: if user supplied one and there's only one sheet, use it directly;
          // if multiple sheets, use it as a prefix (e.g. "sales" → "sales_sheet1")
          table_name:
            sheet.tableName
              ? result.config!.files!.length === 1
                ? sheet.tableName
                : `${sheet.tableName}_${f.table_name}`
              : f.table_name,
          source_type: 'google_sheets' as const,
          spreadsheet_url: sheet.url,
          spreadsheet_id: result.config!.spreadsheet_id,
        }));
        allNewFiles = [...allNewFiles, ...spreadsheetFiles];
      }

      const importedSchema = pendingSheets[0]?.schema || 'public';
      onChange({ files: [...allNewFiles, ...existingFiles] });
      setImportProgress('done');
      setPendingSheets([{ url: '', schema: '', tableName: '' }]);
      setActivePanel('csv-upload');
      setTablesOpen(true);
      // Collapse all schemas except the newly imported one
      const allSchemas = new Set([...existingFiles.map(f => f.schema_name), importedSchema]);
      allSchemas.delete(importedSchema);
      setCollapsedSchemas(allSchemas);
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Import failed');
      setImportProgress('error');
    }
  };

  // ── Delete with confirmation ──────────────────────────────────────────────

  const handleDeleteFileClick = (s3Key: string) => {
    const file = existingFiles.find((f) => f.s3_key === s3Key);
    setDeleteTarget({ type: 'file', s3Key, name: file ? `${file.schema_name}.${file.table_name}` : s3Key });
  };

  const handleDeleteSheetGroupClick = (spreadsheetId: string) => {
    const group = sheetsGroups.get(spreadsheetId) ?? [];
    const name = group.length > 0 ? `${group.length} sheet${group.length !== 1 ? 's' : ''} from this spreadsheet` : 'this spreadsheet';
    setDeleteTarget({ type: 'sheets', id: spreadsheetId, name });
  };

  const handleDeleteConfirm = () => {
    if (!deleteTarget) return;
    if (deleteTarget.type === 'file') {
      onChange({ files: existingFiles.filter((f) => f.s3_key !== deleteTarget.s3Key) });
      onPendingDeletion?.(deleteTarget.s3Key);
      if (editingKey === deleteTarget.s3Key) setEditingKey(null);
    } else {
      const groupFiles = sheetsGroups.get(deleteTarget.id) ?? [];
      onChange({ files: existingFiles.filter((f) => f.spreadsheet_id !== deleteTarget.id) });
      groupFiles.forEach((f) => onPendingDeletion?.(f.s3_key));
      if (groupFiles.some((f) => f.s3_key === editingKey)) setEditingKey(null);
    }
    setDeleteTarget(null);
    // Auto-save after delete
    setTimeout(() => onSave?.(), 0);
  };

  // ── Re-import a Google Sheet ──────────────────────────────────────────────

  const handleReimport = async (spreadsheetId: string) => {
    const groupFiles = sheetsGroups.get(spreadsheetId) ?? [];
    if (groupFiles.length === 0) return;

    const spreadsheetUrl = groupFiles[0].spreadsheet_url ?? '';
    const schemaName = groupFiles[0].schema_name ?? 'public';
    const oldS3Keys = groupFiles.map((f) => f.s3_key);

    setReimportingId(spreadsheetId);
    try {
      const result = await reimportGoogleSheets(spreadsheetId, spreadsheetUrl, schemaName, oldS3Keys);

      if (!result.success) { onError(result.message ?? 'Re-import failed'); return; }

      // Replace files from this spreadsheet with freshly imported ones, keeping at same position
      const unchanged = existingFiles.filter((f) => f.spreadsheet_id !== spreadsheetId);
      // Find where the old group was in the list to re-insert at the same spot
      const firstIdx = existingFiles.findIndex((f) => f.spreadsheet_id === spreadsheetId);
      const newFiles = result.files ?? [];
      const updated =
        firstIdx === -1
          ? [...newFiles, ...unchanged]
          : [...unchanged.slice(0, firstIdx), ...newFiles, ...unchanged.slice(firstIdx)];
      onChange({ files: updated });
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Re-import failed');
    } finally {
      setReimportingId(null);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────

  const hasFiles = existingFiles.length > 0;

  const sharedRowProps = {
    editingKey,
    editSchema,
    editTable,
    editError,
    onStartEdit: handleStartEdit,
    onEditSchema: (v: string) => { setEditSchema(v); setEditError(''); },
    onEditTable: (v: string) => { setEditTable(v); setEditError(''); },
    onConfirmRename: handleConfirmRename,
    onCancelEdit: handleCancelEdit,
    onDelete: handleDeleteFileClick,
  };

  return (
    <VStack gap={4} align="stretch">

      {/* ── Add data — tabbed panel ── */}
      <Box borderRadius="lg" border="1px solid" borderColor="border.default" overflow="hidden">
        {/* Tab bar */}
        <HStack gap={0} borderBottom="1px solid" borderColor="border.subtle">
          <Box
            as="button"
            flex={1}
            px={4}
            py={2}
            cursor="pointer"
            borderBottom="2px solid"
            borderColor={activePanel === 'csv-upload' ? 'accent.teal' : 'transparent'}
            bg={activePanel === 'csv-upload' ? 'bg.surface' : 'bg.muted'}
            _hover={{ bg: 'bg.surface' }}
            transition="all 0.1s"
            onClick={() => {
              setActivePanel(activePanel === 'csv-upload' ? null : 'csv-upload');
              setUploadProgress('idle');
            }}
          >
            <HStack gap={1.5} justify="center">
              <LuUpload size={13} color={activePanel === 'csv-upload' ? 'var(--chakra-colors-accent-teal)' : 'var(--chakra-colors-fg-muted)'} />
              <Text fontSize="xs" fontWeight={activePanel === 'csv-upload' ? '700' : '500'} color={activePanel === 'csv-upload' ? 'accent.teal' : 'fg.muted'}>
                Upload CSV / xlsx
              </Text>
            </HStack>
          </Box>
          <Box
            as="button"
            flex={1}
            px={4}
            py={2}
            cursor="pointer"
            borderBottom="2px solid"
            borderColor={activePanel === 'sheets-add' ? 'accent.teal' : 'transparent'}
            bg={activePanel === 'sheets-add' ? 'bg.surface' : 'bg.muted'}
            _hover={{ bg: 'bg.surface' }}
            transition="all 0.1s"
            onClick={() => {
              setActivePanel(activePanel === 'sheets-add' ? null : 'sheets-add');
              setImportProgress('idle');
              if (activePanel !== 'sheets-add') setPendingSheets([{ url: '', schema: '', tableName: '' }]);
            }}
          >
            <HStack gap={1.5} justify="center">
              <Image src="/logos/google-sheets.svg" alt="Google Sheets" width={13} height={13} />
              <Text fontSize="xs" fontWeight={activePanel === 'sheets-add' ? '700' : '500'} color={activePanel === 'sheets-add' ? 'accent.teal' : 'fg.muted'}>
                Add Google Sheet
              </Text>
            </HStack>
          </Box>
        </HStack>

        {/* ── CSV upload panel ── */}
        {activePanel === 'csv-upload' && (
          <Box p={3}>
            {pendingFiles.length === 0 ? (
              <VStack align="stretch" gap={3}>
                {/* Success feedback */}
                {uploadProgress === 'done' && (
                  <HStack gap={1.5} px={3} py={2} borderRadius="md" bg="accent.teal/10" border="1px solid" borderColor="accent.teal/30">
                    <LuCheck size={14} color="var(--chakra-colors-accent-teal)" />
                    <Text fontSize="xs" color="accent.teal" fontWeight="600">
                      Uploaded successfully. Save connection to persist.
                    </Text>
                  </HStack>
                )}
                {/* Empty state — prominent drop zone */}
                <Box
                  as="label"
                  display="flex"
                  flexDirection="column"
                  alignItems="center"
                  gap={2}
                  py={6}
                  borderRadius="md"
                  border="2px dashed"
                  borderColor={uploadProgress === 'done' ? 'accent.teal/30' : 'border.default'}
                  bg="bg.muted"
                  cursor="pointer"
                  _hover={{ borderColor: 'accent.teal', bg: 'accent.teal/5' }}
                  transition="all 0.15s"
                >
                  <LuUpload size={20} color="var(--chakra-colors-fg-muted)" />
                  <Text fontSize="sm" fontWeight="600" color="fg.muted">
                    Click to select files
                  </Text>
                  <Text fontSize="2xs" color="fg.subtle">
                    .csv, .parquet, .xlsx
                  </Text>
                  <input
                    type="file"
                    accept=".csv,.parquet,.pq,.xlsx"
                    multiple
                    onChange={(e) => handleFilesSelected(Array.from(e.target.files ?? []))}
                    style={{ display: 'none' }}
                  />
                </Box>
              </VStack>
            ) : (
              <VStack align="stretch" gap={3}>
                {/* Dataset name — shared across all files in this upload */}
                <Box>
                  <Text fontSize="xs" fontWeight="600" mb={1}>Dataset Name</Text>
                  <Input
                    size="sm"
                    fontFamily="mono"
                    value={pendingFiles[0]?.schemaName ?? ''}
                    onChange={(e) => {
                      const v = e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_');
                      setPendingFiles((p) => p.map((pf) => ({ ...pf, schemaName: v })));
                    }}
                    placeholder="e.g. marketing_data"
                  />
                  <Text fontSize="2xs" color="fg.muted" mt={1}>
                    Groups these files together. Lowercase, underscores only.
                  </Text>
                </Box>

                {/* File list */}
                <VStack align="stretch" gap={1.5}>
                  <HStack justify="space-between">
                    <Text fontSize="xs" fontWeight="600">
                      Files ({pendingFiles.length})
                    </Text>
                    <Button as="label" size="xs" variant="ghost" cursor="pointer" color="accent.teal">
                      + Add more
                      <input
                        type="file"
                        accept=".csv,.parquet,.pq,.xlsx"
                        multiple
                        onChange={(e) => {
                          const newFiles = Array.from(e.target.files ?? []);
                          const currentSchema = pendingFiles[0]?.schemaName ?? '';
                          setPendingFiles((p) => [
                            ...p,
                            ...newFiles.map((file) => ({
                              file,
                              schemaName: currentSchema,
                              tableName: sanitizeTableName(file.name),
                            })),
                          ]);
                        }}
                        style={{ display: 'none' }}
                      />
                    </Button>
                  </HStack>
                  {pendingFiles.map(({ file, tableName }, idx) => (
                    <HStack
                      key={idx}
                      gap={2}
                      px={3}
                      py={1.5}
                      borderRadius="md"
                      bg="bg.muted"
                      border="1px solid"
                      borderColor="border.subtle"
                    >
                      <LuFile size={12} color="var(--chakra-colors-fg-muted)" style={{ flexShrink: 0 }} />
                      <Text fontSize="2xs" color="fg.muted" truncate flex={1} minW={0} title={file.name}>
                        {file.name}
                      </Text>
                      <Text fontSize="2xs" color="fg.subtle" whiteSpace="nowrap">
                        {(file.size / 1024).toFixed(0)} KB
                      </Text>
                      <Box w="1px" h="12px" bg="border.subtle" />
                      <Text fontSize="2xs" color="fg.muted" whiteSpace="nowrap">table:</Text>
                      <Input
                        size="xs"
                        fontFamily="mono"
                        w="36"
                        flexShrink={0}
                        value={tableName}
                        onChange={(e) =>
                          setPendingFiles((p) =>
                            p.map((pf, i) => i === idx ? { ...pf, tableName: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_') } : pf)
                          )
                        }
                        placeholder="auto"
                      />
                      <IconButton
                        size="2xs"
                        variant="ghost"
                        onClick={() => setPendingFiles((p) => p.filter((_, i) => i !== idx))}
                        aria-label="Remove file"
                      >
                        <LuX size={12} />
                      </IconButton>
                    </HStack>
                  ))}
                </VStack>

                <Button
                  onClick={handleUpload}
                  loading={uploadProgress === 'uploading'}
                  disabled={pendingFiles.length === 0 || !pendingFiles[0]?.schemaName}
                  size="sm"
                  bg="accent.teal"
                  color="white"
                >
                  <LuUpload size={14} /> Upload
                </Button>
                {uploadProgress === 'uploading' && uploadStage && (
                  <Text fontSize="xs" color="accent.teal">{uploadStage}</Text>
                )}
                {uploadProgress === 'done' && (
                  <Text fontSize="xs" color="accent.teal">
                    Uploaded. Save the connection to persist.
                  </Text>
                )}
                {uploadProgress === 'error' && (
                  <Text fontSize="xs" color="accent.danger">Upload failed — see error above.</Text>
                )}
              </VStack>
            )}
          </Box>
        )}

        {/* ── Google Sheets add panel ── */}
        {activePanel === 'sheets-add' && (
          <Box p={3}>
            <VStack align="stretch" gap={3}>
              {/* Dataset name — shared across all sheets */}
              <Box>
                <Text fontSize="xs" fontWeight="600" mb={1}>Dataset Name</Text>
                <Input
                  size="sm"
                  fontFamily="mono"
                  value={pendingSheets[0]?.schema ?? ''}
                  onChange={(e) => {
                    const v = e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_');
                    setPendingSheets((p) => p.map((s) => ({ ...s, schema: v })));
                  }}
                  placeholder="e.g. survey_results"
                />
                <Text fontSize="2xs" color="fg.muted" mt={1}>
                  Groups imported sheets together. Lowercase, underscores only.
                </Text>
              </Box>

              {/* Spreadsheet URLs */}
              <VStack align="stretch" gap={1.5}>
                <HStack justify="space-between">
                  <Text fontSize="xs" fontWeight="600">
                    Spreadsheets ({pendingSheets.length})
                  </Text>
                  <Button
                    size="xs"
                    variant="ghost"
                    color="accent.teal"
                    onClick={() => {
                      const currentSchema = pendingSheets[0]?.schema ?? '';
                      setPendingSheets((p) => [...p, { url: '', schema: currentSchema, tableName: '' }]);
                    }}
                  >
                    + Add another
                  </Button>
                </HStack>

                {pendingSheets.map((sheet, idx) => (
                  <HStack
                    key={idx}
                    gap={2}
                    px={3}
                    py={2}
                    borderRadius="md"
                    bg="bg.muted"
                    border="1px solid"
                    borderColor="border.subtle"
                  >
                    <LuLink size={12} color="var(--chakra-colors-fg-muted)" style={{ flexShrink: 0 }} />
                    <Input
                      size="xs"
                      fontFamily="mono"
                      flex={1}
                      value={sheet.url}
                      onChange={(e) => {
                        const v = e.target.value;
                        setPendingSheets((p) => p.map((s, i) => i === idx ? { ...s, url: v } : s));
                        setImportProgress('idle');
                      }}
                      placeholder="https://docs.google.com/spreadsheets/d/..."
                    />
                    <Box w="1px" h="12px" bg="border.subtle" />
                    <Text fontSize="2xs" color="fg.muted" whiteSpace="nowrap">table:</Text>
                    <Input
                      size="xs"
                      fontFamily="mono"
                      w="36"
                      flexShrink={0}
                      value={sheet.tableName}
                      onChange={(e) =>
                        setPendingSheets((p) => p.map((s, i) => i === idx ? { ...s, tableName: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_') } : s))
                      }
                      placeholder="auto (from tab)"
                    />
                    {pendingSheets.length > 1 && (
                      <IconButton
                        size="2xs"
                        variant="ghost"
                        aria-label="Remove this spreadsheet"
                        onClick={() => setPendingSheets((p) => p.filter((_, i) => i !== idx))}
                      >
                        <LuX size={12} />
                      </IconButton>
                    )}
                  </HStack>
                ))}
              </VStack>

              <Text fontSize="2xs" color="fg.muted">
                Sheets must be shared as &quot;Anyone with the link can view&quot;. Each tab becomes a table.
              </Text>

              <Button
                onClick={handleSheetImport}
                loading={importProgress === 'importing'}
                disabled={pendingSheets.every((s) => !s.url.trim()) || !pendingSheets[0]?.schema}
                size="sm"
                bg="accent.teal"
                color="white"
              >
                Import
              </Button>
              {importProgress === 'importing' && importStage && (
                <Text fontSize="xs" color="accent.teal">{importStage}</Text>
              )}
              {importProgress === 'done' && (
                <HStack gap={1.5} px={3} py={2} borderRadius="md" bg="accent.teal/10" border="1px solid" borderColor="accent.teal/30">
                  <LuCheck size={14} color="var(--chakra-colors-accent-teal)" />
                  <Text fontSize="xs" color="accent.teal" fontWeight="600">
                    Imported successfully. Save connection to persist.
                  </Text>
                </HStack>
              )}
              {importProgress === 'error' && (
                <Text fontSize="xs" color="accent.danger">Import failed — see error above.</Text>
              )}
            </VStack>
          </Box>
        )}

        {/* Collapsed state hint */}
        {activePanel === null && (
          <Box px={4} py={3} bg="bg.surface">
            <Text fontSize="xs" color="fg.muted">
              Select a tab above to add data to this connection.
            </Text>
          </Box>
        )}
      </Box>

      {/* ── Registered tables (collapsible, default closed) ── */}
      {hasFiles && (
        <Collapsible.Root open={tablesOpen || collisionSet.size > 0} onOpenChange={(details) => setTablesOpen(details.open)}>
          <Box borderRadius="lg" border="1px solid" borderColor="border.subtle" overflow="hidden">
            <Collapsible.Trigger asChild>
              <Box
                as="button"
                w="100%"
                px={4}
                py={2.5}
                cursor="pointer"
                bg="bg.muted"
                _hover={{ bg: 'bg.subtle' }}
                transition="background 0.15s"
              >
                <HStack gap={2} justify="space-between">
                  <HStack gap={2}>
                    <LuTable size={14} color="var(--chakra-colors-fg-muted)" />
                    <Text fontSize="xs" fontWeight="700">
                      Existing Tables
                    </Text>
                    <Box
                      px={1.5}
                      py={0.5}
                      bg="fg.muted/10"
                      borderRadius="full"
                    >
                      <Text fontSize="2xs" fontWeight="600" fontFamily="mono" color="fg.muted">
                        {existingFiles.length}
                      </Text>
                    </Box>
                  </HStack>
                  <LuChevronDown size={14} color="var(--chakra-colors-fg-muted)" />
                </HStack>
              </Box>
            </Collapsible.Trigger>
            <Collapsible.Content>
              <Box maxH="460px" overflowY="auto">
                {/* Collision warning banner */}
                {collisionSet.size > 0 && (
                  <HStack
                    gap={2}
                    mx={3}
                    mt={3}
                    p={2}
                    borderRadius="md"
                    bg="red.subtle"
                    border="1px solid"
                    borderColor="red.200"
                  >
                    <LuCircleAlert size={12} color="var(--chakra-colors-red-400)" style={{ flexShrink: 0 }} />
                    <Text fontSize="xs" color="red.600">
                      Name conflicts detected — click the pencil to rename.
                    </Text>
                  </HStack>
                )}

                <VStack align="stretch" gap={0} py={1}>
                  {groupBySchema(displayItems).map(({ schema, items: schemaItems }, schemaIdx) => {
                    const tableCount = schemaItems.reduce((n, it) => n + (it.kind === 'csv' ? 1 : it.files.length), 0);
                    const isExpanded = !collapsedSchemas.has(schema);
                    return (
                      <Box key={schema}>
                        {schemaIdx > 0 && (
                          <Box mx={4} my={1} borderTop="1px solid" borderColor="border.subtle" />
                        )}
                        {/* Schema header — clickable to expand/collapse */}
                        <HStack
                          as="button"
                          w="100%"
                          gap={2}
                          px={4}
                          py={2}
                          cursor="pointer"
                          position="sticky"
                          top={0}
                          bg="bg.muted"
                          zIndex={1}
                          _hover={{ bg: 'bg.subtle' }}
                          transition="background 0.1s"
                          onClick={() => toggleSchema(schema)}
                        >
                          {isExpanded
                            ? <LuChevronDown size={12} color="var(--chakra-colors-fg-muted)" />
                            : <LuChevronRight size={12} color="var(--chakra-colors-fg-muted)" />
                          }
                          <LuDatabase size={12} color="var(--chakra-colors-accent-secondary)" />
                          <Text fontSize="xs" fontWeight="700" fontFamily="mono" color={isExpanded ? 'accent.secondary' : 'fg.default'}>
                            {schema}
                          </Text>
                          <Box px={1.5} py={0} bg="fg.muted/10" borderRadius="sm">
                            <Text fontSize="2xs" fontWeight="600" fontFamily="mono" color="fg.muted">
                              {tableCount} {tableCount === 1 ? 'table' : 'tables'}
                            </Text>
                          </Box>
                        </HStack>

                        {/* Table rows — indented with left border */}
                        {isExpanded && (
                          <Box ml={5} pl={3} borderLeft="2px solid" borderColor="border.subtle">
                            <VStack align="stretch" gap={0}>
                              {schemaItems.map((item) => {
                                if (item.kind === 'csv') {
                                  return (
                                    <FileRow
                                      key={item.file.s3_key}
                                      f={item.file}
                                      isCollision={collisionSet.has(`${item.file.schema_name}.${item.file.table_name}`)}
                                      {...sharedRowProps}
                                    />
                                  );
                                }
                                const url = item.files[0]?.spreadsheet_url ?? '';
                                const isReimporting = reimportingId === item.id;
                                return (
                                  <Box key={item.id} my={1}>
                                    {/* Spreadsheet source row */}
                                    <HStack
                                      justify="space-between"
                                      gap={2}
                                      px={3}
                                      py={1.5}
                                      borderRadius="md"
                                      bg="bg.surface"
                                      border="1px solid"
                                      borderColor="border.subtle"
                                    >
                                      <HStack gap={1.5} flex={1} minW={0}>
                                        <Box flexShrink={0}>
                                          <Image src="/logos/google-sheets.svg" alt="Google Sheets" width={12} height={12} />
                                        </Box>
                                        <Text fontSize="2xs" color="fg.muted" fontFamily="mono" truncate title={url}>
                                          {item.files.length} sheet{item.files.length !== 1 ? 's' : ''}
                                        </Text>
                                      </HStack>
                                      <HStack gap={0} flexShrink={0}>
                                        <IconButton
                                          size="2xs"
                                          variant="ghost"
                                          aria-label="Re-import sheets from this spreadsheet"
                                          onClick={() => handleReimport(item.id)}
                                          title="Re-import"
                                        >
                                          {isReimporting ? <Spinner size="xs" /> : <LuRefreshCw size={11} />}
                                        </IconButton>
                                        <IconButton
                                          size="2xs"
                                          variant="ghost"
                                          colorPalette="red"
                                          aria-label="Delete all sheets from this spreadsheet"
                                          disabled={isReimporting}
                                          onClick={() => handleDeleteSheetGroupClick(item.id)}
                                        >
                                          <LuTrash2 size={11} />
                                        </IconButton>
                                      </HStack>
                                    </HStack>
                                    {/* Sheet rows */}
                                    <VStack align="stretch" gap={0} pl={2}>
                                      {item.files.map((f) => (
                                        <FileRow
                                          key={f.s3_key}
                                          f={f}
                                          isCollision={collisionSet.has(`${f.schema_name}.${f.table_name}`)}
                                          nested
                                          {...sharedRowProps}
                                        />
                                      ))}
                                    </VStack>
                                  </Box>
                                );
                              })}
                            </VStack>
                          </Box>
                        )}
                      </Box>
                    );
                  })}
                </VStack>

                {/* Footer hint */}
                <HStack px={4} py={2} bg="bg.muted" borderTop="1px solid" borderColor="border.subtle" gap={1}>
                  <Text fontSize="2xs" color="fg.subtle" fontFamily="mono">
                    queried as schema.table
                  </Text>
                  <Text fontSize="2xs" color="fg.subtle">&middot;</Text>
                </HStack>
              </Box>
            </Collapsible.Content>
          </Box>
        </Collapsible.Root>
      )}

      {!hasFiles && activePanel === null && (
        <Text fontSize="xs" color="fg.muted">
          No tables yet. Upload CSV/xlsx files or add a Google Sheet above.
        </Text>
      )}
      {/* ── Delete confirmation dialog ── */}
      <Dialog.Root open={!!deleteTarget} onOpenChange={(e) => { if (!e.open) setDeleteTarget(null); }}>
        <Portal>
          <Dialog.Backdrop />
          <Dialog.Positioner>
            <Dialog.Content bg="bg.surface" borderRadius="lg" border="1px solid" borderColor="border.default">
              <Dialog.Header px={6} py={4} borderBottom="1px solid" borderColor="border.default">
                <Dialog.Title fontSize="md" fontWeight="700">Delete Table</Dialog.Title>
              </Dialog.Header>
              <Dialog.Body px={6} py={5}>
                <Text fontSize="sm">
                  Are you sure you want to delete <Text as="span" fontWeight="700" fontFamily="mono">{deleteTarget?.name}</Text>? This will be saved immediately.
                </Text>
              </Dialog.Body>
              <Dialog.Footer px={6} py={4} gap={3} borderTop="1px solid" borderColor="border.default" justifyContent="flex-end">
                <Dialog.ActionTrigger asChild>
                  <Button variant="outline" size="sm">Cancel</Button>
                </Dialog.ActionTrigger>
                <Button bg="accent.danger" color="white" size="sm" onClick={handleDeleteConfirm}>
                  <LuTrash2 size={14} /> Delete
                </Button>
              </Dialog.Footer>
              <Dialog.CloseTrigger />
            </Dialog.Content>
          </Dialog.Positioner>
        </Portal>
      </Dialog.Root>
    </VStack>
  );
}
