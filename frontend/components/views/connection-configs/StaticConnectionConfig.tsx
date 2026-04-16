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
 * - Delete individual CSV tables (removes S3 object + drops from files list)
 * - Delete an entire Google Sheets group (all sheets from one spreadsheet)
 * - Re-import a Google Sheet (refresh data from the live spreadsheet)
 */

import { useState } from 'react';
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
} from 'react-icons/lu';
import { CsvFileInfo } from '@/lib/types';
import { uploadCsvFilesS3, FileWithSchema } from '@/lib/backend/csv-upload';
import { importGoogleSheets, reimportGoogleSheets } from '@/lib/backend/google-sheets';
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

function sanitizeForId(filename: string): string {
  return filename.replace(/\.[^.]+$/, '').replace(/[\s\-]/g, '_').toLowerCase();
}

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
  const [sheetUrl, setSheetUrl] = useState('');
  const [sheetSchema, setSheetSchema] = useState('public');
  const [importProgress, setImportProgress] = useState<'idle' | 'importing' | 'done' | 'error'>('idle');

  // ── Per-item loading states ───────────────────────────────────────────────
  const [reimportingId, setReimportingId] = useState<string | null>(null);
  const [deletingKey, setDeletingKey] = useState<string | null>(null); // s3_key or spreadsheet_id

  const existingFiles = (config.files ?? []) as CsvFileInfo[];
  const { csvFiles, sheetsGroups } = groupFiles(existingFiles);

  // ── CSV upload handlers ───────────────────────────────────────────────────

  const handleFilesSelected = (selected: File[]) => {
    setPendingFiles(
      selected.map((file) => ({
        file,
        schemaName: 'public',
        tableName: sanitizeForId(file.name),
      })),
    );
    setUploadProgress('idle');
  };

  const handleUpload = async () => {
    if (pendingFiles.length === 0) { onError('Please select at least one file'); return; }

    for (const { schemaName, tableName } of pendingFiles) {
      if (schemaName && !/^[a-z0-9_]+$/.test(schemaName)) {
        onError('Schema names must contain only lowercase letters, numbers, and underscores');
        return;
      }
      if (tableName && !/^[a-z0-9_]+$/.test(tableName)) {
        onError('Table names must contain only lowercase letters, numbers, and underscores');
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

      onChange({ files: [...existingFiles, ...newFiles] });
      setUploadProgress('done');
      setPendingFiles([]);
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Upload failed');
      setUploadProgress('error');
    }
  };

  // ── Google Sheets add handler ─────────────────────────────────────────────

  const handleSheetImport = async () => {
    if (!sheetUrl) { onError('Please enter a Google Sheets URL'); return; }
    if (!sheetUrl.includes('docs.google.com/spreadsheets')) {
      onError('Invalid Google Sheets URL — expected https://docs.google.com/spreadsheets/d/...');
      return;
    }
    if (sheetSchema && !/^[a-z0-9_]+$/.test(sheetSchema)) {
      onError('Schema name must contain only lowercase letters, numbers, and underscores');
      return;
    }
    if (!companyId) { onError('Unable to determine company ID'); return; }

    setImportProgress('importing');
    try {
      const result = await importGoogleSheets('static', sheetUrl, companyId, userMode, false, sheetSchema);

      if (!result.success) { onError(result.message); setImportProgress('error'); return; }

      const newFiles: CsvFileInfo[] = (result.config!.files ?? []).map((f) => ({
        ...f,
        source_type: 'google_sheets' as const,
        spreadsheet_url: sheetUrl,
        spreadsheet_id: result.config!.spreadsheet_id,
      }));

      onChange({ files: [...existingFiles, ...newFiles] });
      setImportProgress('done');
      setSheetUrl('');
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

      // Replace files from this spreadsheet with the freshly imported ones
      const unchanged = existingFiles.filter((f) => f.spreadsheet_id !== spreadsheetId);
      onChange({ files: [...unchanged, ...(result.files ?? [])] });
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Re-import failed');
    } finally {
      setReimportingId(null);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────

  const hasFiles = existingFiles.length > 0;

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
          <VStack align="stretch" gap={2}>
            <HStack gap={2}>
              <Icon as={LuLink} boxSize={4} color="fg.muted" flexShrink={0} />
              <Input
                value={sheetUrl}
                onChange={(e) => { setSheetUrl(e.target.value); setImportProgress('idle'); }}
                placeholder="https://docs.google.com/spreadsheets/d/..."
                fontFamily="mono"
                fontSize="sm"
              />
            </HStack>
            <HStack gap={2}>
              <Text fontSize="xs" color="fg.muted" whiteSpace="nowrap">Schema:</Text>
              <Input
                size="sm"
                fontFamily="mono"
                value={sheetSchema}
                onChange={(e) => setSheetSchema(e.target.value.toLowerCase())}
                placeholder="public"
              />
            </HStack>
            <Text fontSize="xs" color="fg.muted">
              Sheet must be publicly shared — &quot;Anyone with the link can view&quot;.
              Each non-empty sheet becomes a table.
            </Text>
            <HStack gap={2}>
              <Button
                onClick={handleSheetImport}
                loading={importProgress === 'importing'}
                disabled={!sheetUrl}
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
          <HStack gap={2} mb={3}>
            <Icon as={LuTable} boxSize={4} color="fg.muted" />
            <Text fontSize="xs" fontWeight="700">
              Registered Tables
              <Text as="span" fontSize="xs" fontWeight="400" color="fg.muted" ml={1}>
                ({existingFiles.length} table{existingFiles.length !== 1 ? 's' : ''})
              </Text>
            </Text>
          </HStack>

          <VStack align="stretch" gap={3}>

            {/* CSV files */}
            {csvFiles.map((f) => (
              <HStack key={f.s3_key} justify="space-between" align="start" gap={2}>
                <VStack align="start" gap={0} flex={1} minW={0}>
                  <HStack gap={1}>
                    <Icon as={LuFile} boxSize={3} color="fg.muted" flexShrink={0} />
                    <Text fontSize="xs" fontFamily="mono" fontWeight="600" truncate>
                      {f.schema_name}.{f.table_name}
                    </Text>
                    <Text fontSize="xs" color="fg.muted" whiteSpace="nowrap">
                      {f.row_count.toLocaleString()} rows
                    </Text>
                  </HStack>
                  <Text fontSize="xs" color="fg.muted" fontFamily="mono" pl={4} truncate>
                    {f.columns.slice(0, 5).map((c) => c.name).join(', ')}
                    {f.columns.length > 5 ? ` +${f.columns.length - 5} more` : ''}
                  </Text>
                </VStack>
                <Button
                  size="xs"
                  variant="ghost"
                  colorPalette="red"
                  aria-label={`Delete table ${f.table_name}`}
                  loading={deletingKey === f.s3_key}
                  onClick={() => handleDeleteFile(f.s3_key)}
                  flexShrink={0}
                >
                  <LuTrash2 />
                </Button>
              </HStack>
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

                  {/* Individual sheet rows */}
                  <VStack align="stretch" gap={1} pl={4}>
                    {files.map((f) => (
                      <HStack key={f.s3_key} justify="space-between">
                        <Text fontSize="xs" fontFamily="mono" fontWeight="600">
                          {f.schema_name}.{f.table_name}
                        </Text>
                        <HStack gap={2}>
                          <Text fontSize="xs" color="fg.muted" fontFamily="mono">{f.file_format}</Text>
                          <Text fontSize="xs" color="fg.muted">{f.row_count.toLocaleString()} rows</Text>
                        </HStack>
                      </HStack>
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
        Upload and Google Sheets changes take effect after saving the connection.
      </Text>
    </VStack>
  );
}
