'use client';

import { useState, type Dispatch, type SetStateAction } from 'react';
import {
  Box,
  Text,
  VStack,
  HStack,
  Button,
  Input,
  IconButton,
} from '@chakra-ui/react';
import {
  LuX,
  LuLink,
  LuCheck,
} from 'react-icons/lu';
import { CsvFileInfo } from '@/lib/types';
import { importGoogleSheets } from '@/lib/connections/client/google-sheets';
import { validateIdentifier } from '@/lib/csv-utils';
import type { BaseConfigProps } from './types';
import type { ActivePanel } from './StaticConnectionConfig';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SheetsAddPanelProps {
  /** Whether the sheets-add tab is the currently active panel. */
  isActive: boolean;
  existingFiles: CsvFileInfo[];
  onChange: BaseConfigProps['onChange'];
  onError: (error: string) => void;
  pendingSheets: Array<{ url: string; schema: string; tableName: string }>;
  setPendingSheets: Dispatch<SetStateAction<Array<{ url: string; schema: string; tableName: string }>>>;
  importProgress: 'idle' | 'importing' | 'done' | 'error';
  setImportProgress: Dispatch<SetStateAction<'idle' | 'importing' | 'done' | 'error'>>;
  setActivePanel: Dispatch<SetStateAction<ActivePanel>>;
  setTablesOpen: Dispatch<SetStateAction<boolean>>;
  setCollapsedSchemas: Dispatch<SetStateAction<Set<string>>>;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function SheetsAddPanel({
  isActive,
  existingFiles,
  onChange,
  onError,
  pendingSheets,
  setPendingSheets,
  importProgress,
  setImportProgress,
  setActivePanel,
  setTablesOpen,
  setCollapsedSchemas,
}: SheetsAddPanelProps) {
  const [importStage, setImportStage] = useState<string>('');

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

  // ── Render ────────────────────────────────────────────────────────────────

  if (!isActive) return null;

  return (
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
            aria-label="Dataset name"
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
                aria-label="Spreadsheet URL"
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
          aria-label="Import sheets"
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
  );
}
