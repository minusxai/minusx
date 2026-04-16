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
import {
  Box,
  Text,
  VStack,
  HStack,
  Button,
  Input,
  Icon,
  Spinner,
  IconButton,
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
} from 'react-icons/lu';
import { CsvFileInfo } from '@/lib/types';
import { uploadCsvFilesS3, FileWithSchema } from '@/lib/backend/csv-upload';
import { importGoogleSheets, reimportGoogleSheets } from '@/lib/backend/google-sheets';
import { sanitizeTableName, validateIdentifier } from '@/lib/csv-utils';
import { BaseConfigProps } from './types';

// ─── Types ────────────────────────────────────────────────────────────────────

interface StaticConnectionConfigProps extends BaseConfigProps {
  companyId: number | undefined;
  userMode: string;
  onError: (error: string) => void;
}

interface PendingFile {
  file: File;
  schemaName: string;
  tableName: string;
}

type ActivePanel = null | 'csv-upload' | 'sheets-add';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Split files into plain CSV entries and Google Sheets groups (by spreadsheet_id). */
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
  deletingKey: string | null;
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
  deletingKey, onStartEdit, onEditSchema, onEditTable, onConfirmRename, onCancelEdit, onDelete,
  nested = false,
}: FileRowProps) {
  const tableInputRef = useRef<HTMLInputElement>(null);
  const isEditing = editingKey === f.s3_key;

  return (
    <VStack align="stretch" gap={0}>
      <HStack justify="space-between" align="center" gap={2} role="group" pl={nested ? 0 : undefined}>
        <VStack align="start" gap={0} flex={1} minW={0}>
          {/* Schema.table display or edit inputs */}
          {isEditing ? (
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
              <Text fontSize="xs" flexShrink={0}>.</Text>
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
              <IconButton
                size="xs"
                variant="ghost"
                colorPalette="green"
                aria-label="Confirm rename"
                onClick={() => onConfirmRename(f.s3_key)}
              >
                <LuCheck />
              </IconButton>
              <IconButton
                size="xs"
                variant="ghost"
                aria-label="Cancel rename"
                onClick={onCancelEdit}
              >
                <LuX />
              </IconButton>
            </HStack>
          ) : (
            <HStack gap={1} align="center">
              {!nested && <Icon as={LuFile} boxSize={3} color="fg.muted" flexShrink={0} />}
              <Text
                fontSize="xs"
                fontFamily="mono"
                fontWeight="600"
                color={isCollision ? 'red.400' : undefined}
                truncate
              >
                {f.schema_name}.{f.table_name}
              </Text>
              {isCollision && (
                <Box
                  as="span"
                  display="inline-flex"
                  title="Duplicate name — rename this file to resolve the conflict"
                  flexShrink={0}
                >
                  <Icon as={LuCircleAlert} boxSize={3} color="red.400" />
                </Box>
              )}
              <Text fontSize="xs" color="fg.muted" whiteSpace="nowrap">
                {f.row_count.toLocaleString()} rows
              </Text>
              <IconButton
                size="xs"
                variant="ghost"
                aria-label={`Rename ${f.schema_name}.${f.table_name}`}
                color="fg.muted"
                onClick={() => onStartEdit(f)}
              >
                <LuPencil />
              </IconButton>
            </HStack>
          )}

          {/* Validation error while editing */}
          {isEditing && editError && (
            <Text fontSize="xs" color="red.400" pl={nested ? 0 : 4}>{editError}</Text>
          )}

          {/* Column preview (only on non-editing state, not nested) */}
          {!isEditing && !nested && (
            <Text fontSize="xs" color="fg.muted" fontFamily="mono" pl={4} truncate>
              {f.columns.slice(0, 5).map((c) => c.name).join(', ')}
              {f.columns.length > 5 ? ` +${f.columns.length - 5} more` : ''}
            </Text>
          )}
        </VStack>

        <Button
          size="xs"
          variant="ghost"
          colorPalette="red"
          aria-label={`Delete table ${f.table_name}`}
          loading={deletingKey === f.s3_key}
          onClick={() => onDelete(f.s3_key)}
          flexShrink={0}
        >
          <LuTrash2 />
        </Button>
      </HStack>
    </VStack>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function StaticConnectionConfig({
  config,
  onChange,
  companyId,
  userMode,
  onError,
}: StaticConnectionConfigProps) {
  // ── Panel toggle ──────────────────────────────────────────────────────────
  const [activePanel, setActivePanel] = useState<ActivePanel>(null);

  // ── CSV upload state ──────────────────────────────────────────────────────
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const [uploadProgress, setUploadProgress] = useState<'idle' | 'uploading' | 'done' | 'error'>('idle');

  // ── Google Sheets add state ───────────────────────────────────────────────
  const [pendingSheets, setPendingSheets] = useState<Array<{ url: string; schema: string; tableName: string }>>([
    { url: '', schema: 'public', tableName: '' },
  ]);
  const [importProgress, setImportProgress] = useState<'idle' | 'importing' | 'done' | 'error'>('idle');

  // ── Per-item loading states ───────────────────────────────────────────────
  const [reimportingId, setReimportingId] = useState<string | null>(null);
  const [deletingKey, setDeletingKey] = useState<string | null>(null); // s3_key or spreadsheet_id

  // ── Inline rename state ───────────────────────────────────────────────────
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editSchema, setEditSchema] = useState('');
  const [editTable, setEditTable] = useState('');
  const [editError, setEditError] = useState('');

  const existingFiles = (config.files ?? []) as CsvFileInfo[];
  const { csvFiles, sheetsGroups } = groupFiles(existingFiles);
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
        schemaName: 'public',
        tableName: sanitizeTableName(file.name),
      })),
    );
    setUploadProgress('idle');
  };

  const handleUpload = async () => {
    if (pendingFiles.length === 0) { onError('Please select at least one file'); return; }

    // Block upload if existing files have unresolved name collisions
    if (collisionSet.size > 0) {
      onError('Resolve name conflicts in existing files before uploading more');
      return;
    }

    for (const { schemaName, tableName } of pendingFiles) {
      const schemaErr = validateIdentifier(schemaName);
      if (schemaErr) { onError(`Schema "${schemaName}": ${schemaErr}`); return; }
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

      const result = await uploadCsvFilesS3('static', filesWithSchema, false);

      if (!result.success) { onError(result.message); setUploadProgress('error'); return; }

      // Tag each file with source_type so the UI knows it came from a CSV upload
      const newFiles: CsvFileInfo[] = (result.config!.files ?? []).map((f) => ({
        ...f,
        source_type: 'csv' as const,
      }));

      onChange({ files: [...newFiles, ...existingFiles] });
      setUploadProgress('done');
      setPendingFiles([]);
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Upload failed');
      setUploadProgress('error');
    }
  };

  // ── Google Sheets add handler ─────────────────────────────────────────────

  const handleSheetImport = async () => {
    const validSheets = pendingSheets.filter((s) => s.url.trim());
    if (validSheets.length === 0) { onError('Please enter at least one Google Sheets URL'); return; }

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
    if (!companyId) { onError('Unable to determine company ID'); return; }

    setImportProgress('importing');
    let allNewFiles: CsvFileInfo[] = [];
    try {
      for (const sheet of validSheets) {
        const result = await importGoogleSheets('static', sheet.url, companyId, userMode, false, sheet.schema || 'public');
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

      onChange({ files: [...allNewFiles, ...existingFiles] });
      setImportProgress('done');
      setPendingSheets([{ url: '', schema: 'public', tableName: '' }]);
      setActivePanel(null);
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Import failed');
      setImportProgress('error');
    }
  };

  // ── Delete a single CSV table ─────────────────────────────────────────────

  const handleDeleteFile = async (s3Key: string) => {
    setDeletingKey(s3Key);
    try {
      const res = await fetch('/api/csv/delete-file', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ s3_key: s3Key }),
      });
      if (!res.ok) { onError(`Delete failed: ${await res.text()}`); return; }
      onChange({ files: existingFiles.filter((f) => f.s3_key !== s3Key) });
      if (editingKey === s3Key) setEditingKey(null);
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Delete failed');
    } finally {
      setDeletingKey(null);
    }
  };

  // ── Delete all sheets from a spreadsheet ──────────────────────────────────

  const handleDeleteSheetGroup = async (spreadsheetId: string) => {
    const groupFiles = sheetsGroups.get(spreadsheetId) ?? [];
    setDeletingKey(spreadsheetId);
    try {
      await Promise.allSettled(
        groupFiles.map((f) =>
          fetch('/api/csv/delete-file', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ s3_key: f.s3_key }),
          }),
        ),
      );
      onChange({ files: existingFiles.filter((f) => f.spreadsheet_id !== spreadsheetId) });
      if (groupFiles.some((f) => f.s3_key === editingKey)) setEditingKey(null);
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Delete failed');
    } finally {
      setDeletingKey(null);
    }
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
    deletingKey,
    onStartEdit: handleStartEdit,
    onEditSchema: (v: string) => { setEditSchema(v); setEditError(''); },
    onEditTable: (v: string) => { setEditTable(v); setEditError(''); },
    onConfirmRename: handleConfirmRename,
    onCancelEdit: handleCancelEdit,
    onDelete: handleDeleteFile,
  };

  return (
    <VStack gap={4} align="stretch">

      {/* ── Action buttons ── */}
      <HStack gap={2} flexWrap="wrap">
        <Button
          size="sm"
          variant={activePanel === 'csv-upload' ? 'solid' : 'outline'}
          colorPalette="teal"
          onClick={() => {
            setActivePanel(activePanel === 'csv-upload' ? null : 'csv-upload');
            setUploadProgress('idle');
          }}
        >
          <LuUpload /> Upload CSV / xlsx
          {activePanel === 'csv-upload' ? <LuChevronDown /> : <LuChevronRight />}
        </Button>
        <Button
          size="sm"
          variant={activePanel === 'sheets-add' ? 'solid' : 'outline'}
          colorPalette="teal"
          onClick={() => {
            setActivePanel(activePanel === 'sheets-add' ? null : 'sheets-add');
            setImportProgress('idle');
            if (activePanel !== 'sheets-add') setPendingSheets([{ url: '', schema: 'public', tableName: '' }]);
          }}
        >
          <Image src="/logos/google-sheets.svg" alt="Google Sheets" width={14} height={14} />
          Add Google Sheet
          {activePanel === 'sheets-add' ? <LuChevronDown /> : <LuChevronRight />}
        </Button>
      </HStack>

      {/* ── CSV upload panel ── */}
      {activePanel === 'csv-upload' && (
        <Box p={3} borderRadius="md" border="1px solid" borderColor="accent.teal" bg="accent.teal/5">
          <Button as="label" size="sm" variant="outline" cursor="pointer" mb={pendingFiles.length > 0 ? 3 : 0}>
            <LuFile /> Select files
            <input
              type="file"
              accept=".csv,.parquet,.pq,.xlsx"
              multiple
              onChange={(e) => handleFilesSelected(Array.from(e.target.files ?? []))}
              style={{ display: 'none' }}
            />
          </Button>

          {pendingFiles.length > 0 && (
            <VStack align="stretch" gap={2}>
              {pendingFiles.map(({ file, schemaName, tableName }, idx) => (
                <Box
                  key={idx}
                  p={2}
                  borderRadius="sm"
                  bg="bg.surface"
                  border="1px solid"
                  borderColor="border.subtle"
                >
                  <HStack justify="space-between" mb={2}>
                    <HStack gap={1}>
                      <Icon as={LuFile} boxSize={3} color="fg.muted" />
                      <Text fontSize="xs" fontFamily="mono">{file.name}</Text>
                      <Text fontSize="xs" color="fg.muted">({(file.size / 1024).toFixed(1)} KB)</Text>
                    </HStack>
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={() => setPendingFiles((p) => p.filter((_, i) => i !== idx))}
                      aria-label="Remove file"
                    >
                      <LuX />
                    </Button>
                  </HStack>
                  <HStack gap={2}>
                    <Text fontSize="xs" color="fg.muted" whiteSpace="nowrap">Schema:</Text>
                    <Input
                      size="xs"
                      fontFamily="mono"
                      value={schemaName}
                      onChange={(e) =>
                        setPendingFiles((p) =>
                          p.map((pf, i) => i === idx ? { ...pf, schemaName: e.target.value.toLowerCase() } : pf)
                        )
                      }
                      placeholder="public"
                    />
                    <Text fontSize="xs" color="fg.muted" whiteSpace="nowrap">Table:</Text>
                    <Input
                      size="xs"
                      fontFamily="mono"
                      value={tableName}
                      onChange={(e) =>
                        setPendingFiles((p) =>
                          p.map((pf, i) => i === idx ? { ...pf, tableName: e.target.value.toLowerCase() } : pf)
                        )
                      }
                      placeholder="auto"
                    />
                  </HStack>
                </Box>
              ))}

              <Button
                onClick={handleUpload}
                loading={uploadProgress === 'uploading'}
                disabled={pendingFiles.length === 0}
                size="sm"
                bg="accent.teal"
                mt={1}
              >
                <LuUpload /> Upload & Register
              </Button>
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
        <Box p={3} borderRadius="md" border="1px solid" borderColor="accent.teal" bg="accent.teal/5">
          <VStack align="stretch" gap={3}>
            {pendingSheets.map((sheet, idx) => (
              <Box
                key={idx}
                p={2}
                borderRadius="sm"
                bg="bg.surface"
                border="1px solid"
                borderColor="border.subtle"
              >
                <HStack justify="space-between" mb={2}>
                  <HStack gap={1.5}>
                    <Icon as={LuLink} boxSize={3} color="fg.muted" flexShrink={0} />
                    <Text fontSize="xs" color="fg.muted">Spreadsheet {pendingSheets.length > 1 ? idx + 1 : ''}</Text>
                  </HStack>
                  {pendingSheets.length > 1 && (
                    <Button
                      size="xs"
                      variant="ghost"
                      aria-label="Remove this spreadsheet"
                      onClick={() => setPendingSheets((p) => p.filter((_, i) => i !== idx))}
                    >
                      <LuX />
                    </Button>
                  )}
                </HStack>

                <VStack align="stretch" gap={2}>
                  <Input
                    size="sm"
                    fontFamily="mono"
                    value={sheet.url}
                    onChange={(e) => {
                      const v = e.target.value;
                      setPendingSheets((p) => p.map((s, i) => i === idx ? { ...s, url: v } : s));
                      setImportProgress('idle');
                    }}
                    placeholder="https://docs.google.com/spreadsheets/d/..."
                  />
                  <HStack gap={2}>
                    <Text fontSize="xs" color="fg.muted" whiteSpace="nowrap">Schema:</Text>
                    <Input
                      size="xs"
                      fontFamily="mono"
                      value={sheet.schema}
                      onChange={(e) =>
                        setPendingSheets((p) => p.map((s, i) => i === idx ? { ...s, schema: e.target.value.toLowerCase() } : s))
                      }
                      placeholder="public"
                    />
                    <Text fontSize="xs" color="fg.muted" whiteSpace="nowrap">Table name:</Text>
                    <Input
                      size="xs"
                      fontFamily="mono"
                      value={sheet.tableName}
                      onChange={(e) =>
                        setPendingSheets((p) => p.map((s, i) => i === idx ? { ...s, tableName: e.target.value.toLowerCase() } : s))
                      }
                      placeholder="auto (from tab name)"
                    />
                  </HStack>
                </VStack>
              </Box>
            ))}

            <Button
              size="xs"
              variant="ghost"
              colorPalette="teal"
              alignSelf="start"
              onClick={() => setPendingSheets((p) => [...p, { url: '', schema: 'public', tableName: '' }])}
            >
              + Add another spreadsheet
            </Button>

            <Text fontSize="xs" color="fg.muted">
              Sheet must be publicly shared — &quot;Anyone with the link can view&quot;.
              Each tab becomes a table (use the table name field to override, or rename after import with ✏).
            </Text>

            <HStack gap={2}>
              <Button
                onClick={handleSheetImport}
                loading={importProgress === 'importing'}
                disabled={pendingSheets.every((s) => !s.url.trim())}
                size="sm"
                bg="accent.teal"
              >
                Import Sheets
              </Button>
              {importProgress === 'done' && (
                <Text fontSize="xs" color="accent.teal">Imported. Save the connection to persist.</Text>
              )}
              {importProgress === 'error' && (
                <Text fontSize="xs" color="accent.danger">Import failed — see error above.</Text>
              )}
            </HStack>
          </VStack>
        </Box>
      )}

      {/* ── Registered tables ── */}
      {hasFiles && (
        <Box p={3} borderRadius="md" border="1px solid" borderColor="border.subtle" bg="bg.muted">
          <HStack gap={2} mb={collisionSet.size > 0 ? 2 : 3}>
            <Icon as={LuTable} boxSize={4} color="fg.muted" />
            <Text fontSize="xs" fontWeight="700">
              Registered Tables
              <Text as="span" fontSize="xs" fontWeight="400" color="fg.muted" ml={1}>
                ({existingFiles.length} table{existingFiles.length !== 1 ? 's' : ''})
              </Text>
            </Text>
          </HStack>

          {/* Collision warning banner */}
          {collisionSet.size > 0 && (
            <HStack
              gap={2}
              mb={3}
              p={2}
              borderRadius="sm"
              bg="red.subtle"
              border="1px solid"
              borderColor="red.200"
            >
              <Icon as={LuCircleAlert} boxSize={3} color="red.400" flexShrink={0} />
              <Text fontSize="xs" color="red.600">
                Name conflicts detected — hover a highlighted row and click the pencil to rename.
              </Text>
            </HStack>
          )}

          <VStack align="stretch" gap={3}>

            {/* CSV files */}
            {csvFiles.map((f) => (
              <FileRow
                key={f.s3_key}
                f={f}
                isCollision={collisionSet.has(`${f.schema_name}.${f.table_name}`)}
                {...sharedRowProps}
              />
            ))}

            {/* Google Sheets groups */}
            {Array.from(sheetsGroups.entries()).map(([sheetId, files]) => {
              const url = files[0]?.spreadsheet_url ?? '';
              const isDeleting = deletingKey === sheetId;
              const isReimporting = reimportingId === sheetId;

              return (
                <Box
                  key={sheetId}
                  p={2}
                  borderRadius="sm"
                  border="1px solid"
                  borderColor="border.subtle"
                  bg="bg.surface"
                >
                  {/* Spreadsheet header row */}
                  <HStack justify="space-between" mb={2} gap={2}>
                    <HStack gap={1.5} flex={1} minW={0}>
                      <Box flexShrink={0}>
                        <Image src="/logos/google-sheets.svg" alt="Google Sheets" width={12} height={12} />
                      </Box>
                      <Text fontSize="xs" color="fg.muted" fontFamily="mono" truncate title={url}>
                        {url}
                      </Text>
                      <Text fontSize="xs" color="fg.muted" whiteSpace="nowrap">
                        ({files.length} sheet{files.length !== 1 ? 's' : ''})
                      </Text>
                    </HStack>
                    <HStack gap={1} flexShrink={0}>
                      <Button
                        size="xs"
                        variant="ghost"
                        aria-label="Re-import sheets from this spreadsheet"
                        loading={isReimporting}
                        disabled={isDeleting}
                        onClick={() => handleReimport(sheetId)}
                        title="Re-import all sheets from this spreadsheet"
                      >
                        {isReimporting ? <Spinner size="xs" /> : <LuRefreshCw />}
                      </Button>
                      <Button
                        size="xs"
                        variant="ghost"
                        colorPalette="red"
                        aria-label="Delete all sheets from this spreadsheet"
                        loading={isDeleting}
                        disabled={isReimporting}
                        onClick={() => handleDeleteSheetGroup(sheetId)}
                      >
                        <LuTrash2 />
                      </Button>
                    </HStack>
                  </HStack>

                  {/* Individual sheet rows — each is renameable */}
                  <VStack align="stretch" gap={2} pl={2}>
                    {files.map((f) => (
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

      {!hasFiles && activePanel === null && (
        <Text fontSize="xs" color="fg.muted">
          No tables yet. Upload CSV/xlsx files or add a Google Sheet above.
        </Text>
      )}

      <Text fontSize="xs" color="fg.muted">
        Tables are queried as{' '}
        <Text as="span" fontFamily="mono">schema.table_name</Text>.
        Hover any registered table and click the pencil to rename it — no re-upload needed.
        Changes take effect after saving the connection.
      </Text>
    </VStack>
  );
}
