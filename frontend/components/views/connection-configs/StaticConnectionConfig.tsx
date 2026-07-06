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

import { useState, useMemo } from 'react';
import Image from 'next/image';
import { useSearchParams } from 'next/navigation';
import {
  Box,
  Text,
  VStack,
  HStack,
  Spinner,
  IconButton,
  Collapsible,
} from '@chakra-ui/react';
import { Tooltip } from '@/components/ui/tooltip';
import {
  LuUpload,
  LuRefreshCw,
  LuTrash2,
  LuTable,
  LuChevronDown,
  LuChevronRight,
  LuCircleAlert,
  LuDatabase,
} from 'react-icons/lu';
import { CsvFileInfo, JobSchedule } from '@/lib/types';
import { reimportGoogleSheets } from '@/lib/connections/client/google-sheets';
import { mergeReimportedSheetFiles } from '@/lib/data/helpers/sheet-reimport';
import { validateIdentifier } from '@/lib/csv-utils';
import { BaseConfigProps } from './types';
import { SheetsAutoSyncSection } from './SheetsAutoSyncSection';
import { FileRow } from './FileRow';
import { CsvUploadPanel } from './CsvUploadPanel';
import { SheetsAddPanel } from './SheetsAddPanel';
import { DeleteConfirmDialog } from './DeleteConfirmDialog';

// ─── Types ────────────────────────────────────────────────────────────────────

interface StaticConnectionConfigProps extends BaseConfigProps {
  userMode: string;
  onError: (error: string) => void;
  onPendingDeletion?: (s3Key: string) => void;
  onSave?: () => void;
  /** Override the default tab when not driven by URL params (e.g. wizard). */
  initialTab?: 'csv' | 'sheets';
  /** When set, only show this tab — hide the tab switcher entirely. */
  singleTab?: 'csv' | 'sheets';
  /** Called when pending (un-uploaded) files change — true if files are staged but not yet uploaded. */
  onPendingChange?: (hasPending: boolean) => void;
  /** Google Sheets auto-sync (content level); section renders only when onAutoSyncChange is set and sheet groups exist. */
  autoSync?: JobSchedule;
  onAutoSyncChange?: (autoSync: JobSchedule | undefined) => void;
  lastSyncedAt?: string;
  lastSyncError?: string;
}

export type ActivePanel = null | 'csv-upload' | 'sheets-add';

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

// ─── Component ────────────────────────────────────────────────────────────────

export default function StaticConnectionConfig({
  config,
  onChange,
  userMode,
  onError,
  onPendingDeletion,
  onSave,
  initialTab,
  singleTab,
  onPendingChange,
  autoSync,
  onAutoSyncChange,
  lastSyncedAt,
  lastSyncError,
}: StaticConnectionConfigProps) {
  // ── Panel toggle ──────────────────────────────────────────────────────────
  const searchParams = useSearchParams();
  const tabParam = searchParams.get('tab');
  const [activePanel, setActivePanel] = useState<ActivePanel>(
      initialTab === 'sheets' || tabParam === 'sheets' ? 'sheets-add' : 'csv-upload'
  );

  // ── CSV upload state (cross-cutting: also reset by the tab bar below) ──────
  const [uploadProgress, setUploadProgress] = useState<'idle' | 'uploading' | 'done' | 'error'>('idle');

  // ── Google Sheets add state (cross-cutting: also reset by the tab bar below) ──
  const [pendingSheets, setPendingSheets] = useState<Array<{ url: string; schema: string; tableName: string }>>([
    { url: '', schema: '', tableName: '' },
  ]);
  const [importProgress, setImportProgress] = useState<'idle' | 'importing' | 'done' | 'error'>('idle');

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

  const existingFiles = useMemo(() => (config.files ?? []) as CsvFileInfo[], [config.files]);
  const { sheetsGroups } = useMemo(() => groupFiles(existingFiles), [existingFiles]);
  const displayItems = useMemo(() => buildDisplayItems(existingFiles), [existingFiles]);
  const collisionSet = useMemo(() => findCollisions(existingFiles), [existingFiles]);

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

      // Refresh the tabs the user STILL has from the re-import; never resurrect deleted tabs and
      // never auto-add brand-new ones (see mergeReimportedSheetFiles). Keeps positions in place.
      onChange({ files: mergeReimportedSheetFiles(existingFiles, spreadsheetId, result.files ?? []) });
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
        {/* Tab bar — hidden when singleTab locks to one mode */}
        {!singleTab && <HStack gap={0} borderBottom="1px solid" borderColor="border.subtle">
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
            aria-label="Upload CSV tab"
            onClick={() => {
              setActivePanel(activePanel === 'csv-upload' ? null : 'csv-upload');
              setUploadProgress('idle');
            }}
          >
            <HStack gap={1.5} justify="center">
              <LuUpload size={13} color={activePanel === 'csv-upload' ? 'var(--chakra-colors-accent-teal)' : 'var(--chakra-colors-fg-muted)'} />
              <Text fontSize="xs" fontWeight={activePanel === 'csv-upload' ? '700' : '500'} color={activePanel === 'csv-upload' ? 'accent.teal' : 'fg.muted'}>
                Upload CSV / XLSX
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
            aria-label="Add Google Sheet tab"
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
        </HStack>}

        {/* ── CSV upload panel ── */}
        <CsvUploadPanel
          isActive={activePanel === 'csv-upload'}
          existingFiles={existingFiles}
          collisionSet={collisionSet}
          onChange={onChange}
          onError={onError}
          onPendingChange={onPendingChange}
          uploadProgress={uploadProgress}
          setUploadProgress={setUploadProgress}
          setActivePanel={setActivePanel}
          setTablesOpen={setTablesOpen}
          setCollapsedSchemas={setCollapsedSchemas}
        />

        {/* ── Google Sheets add panel ── */}
        <SheetsAddPanel
          isActive={activePanel === 'sheets-add'}
          existingFiles={existingFiles}
          onChange={onChange}
          onError={onError}
          pendingSheets={pendingSheets}
          setPendingSheets={setPendingSheets}
          importProgress={importProgress}
          setImportProgress={setImportProgress}
          setActivePanel={setActivePanel}
          setTablesOpen={setTablesOpen}
          setCollapsedSchemas={setCollapsedSchemas}
        />

        {/* Collapsed state hint */}
        {activePanel === null && (
          <Box px={4} py={3} bg="bg.surface">
            <Text fontSize="xs" color="fg.muted">
              Select a tab above to add data to this connection.
            </Text>
          </Box>
        )}
      </Box>

      {/* ── Google Sheets auto-sync schedule ── */}
      {onAutoSyncChange && sheetsGroups.size > 0 && (
        <Box borderRadius="lg" border="1px solid" borderColor="border.subtle" px={4} py={3}>
          <SheetsAutoSyncSection
            autoSync={autoSync}
            onChange={onAutoSyncChange}
            lastSyncedAt={lastSyncedAt}
            lastSyncError={lastSyncError}
          />
        </Box>
      )}

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
                                        <Tooltip content="Re-import">
                                          <IconButton
                                            size="2xs"
                                            variant="ghost"
                                            aria-label="Re-import sheets from this spreadsheet"
                                            onClick={() => handleReimport(item.id)}
                                          >
                                            {isReimporting ? <Spinner size="xs" /> : <LuRefreshCw size={11} />}
                                          </IconButton>
                                        </Tooltip>
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
      <DeleteConfirmDialog
        target={deleteTarget}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={handleDeleteConfirm}
      />
    </VStack>
  );
}
