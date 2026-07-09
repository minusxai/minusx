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
  LuSparkles,
} from 'react-icons/lu';
import { CsvFileInfo } from '@/lib/types';
import {
  importGoogleSheets,
  analyzeGoogleSheet,
  reviseGoogleSheetTransforms,
  confirmGoogleSheetImport,
  type SheetAnalysisResult,
} from '@/lib/connections/client/google-sheets';
import type { SheetTransform } from '@/lib/sheets-import/types';
import { validateIdentifier } from '@/lib/csv-utils';
import SheetImportReview, { type SheetImportProposal } from './SheetImportReview';
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

  // Agentic import: the agent inspects the raw sheet and proposes transforms; the user
  // reviews (redact / feedback / confirm) before anything lands on the connection.
  type AgentPhase = 'idle' | 'analyzing' | 'review' | 'revising' | 'confirming';
  const [agentPhase, setAgentPhase] = useState<AgentPhase>('idle');
  const [analysis, setAnalysis] = useState<SheetAnalysisResult | null>(null);
  const [proposals, setProposals] = useState<SheetImportProposal[]>([]);
  const [dropped, setDropped] = useState<string[]>([]);

  const firstSheet = pendingSheets.find((s) => s.url.trim());
  const datasetSchema = pendingSheets[0]?.schema || 'public';

  // The dataset name field groups the imported tables — it overrides the agent's default schema.
  const withDatasetSchema = (transforms: SheetTransform[]): SheetTransform[] =>
    transforms.map((t) => ({ ...t, schema_name: datasetSchema }));

  const toProposals = (result: SheetAnalysisResult, includedByTable?: Map<string, boolean>): SheetImportProposal[] =>
    withDatasetSchema(result.transforms).map((t) => ({
      transform: t,
      preview: result.previews[t.output_table],
      included: includedByTable?.get(t.output_table) ?? true,
    }));

  const handleAgentAnalyze = async () => {
    if (!firstSheet) { onError('Please enter a Google Sheets URL'); return; }
    if (!firstSheet.url.includes('docs.google.com/spreadsheets')) { onError(`Invalid URL: ${firstSheet.url}`); return; }
    const schemaErr = pendingSheets[0]?.schema ? validateIdentifier(pendingSheets[0].schema) : null;
    if (schemaErr) { onError(`Schema "${pendingSheets[0].schema}": ${schemaErr}`); return; }

    onError('');
    setAgentPhase('analyzing');
    const result = await analyzeGoogleSheet('static', firstSheet.url);
    if (!result.success) { onError(result.message); setAgentPhase('idle'); return; }
    setAnalysis(result.data);
    setProposals(toProposals(result.data));
    setDropped(result.data.dropped);
    setAgentPhase('review');
  };

  const handleAgentToggle = (outputTable: string) => {
    setProposals((prev) => prev.map((p) =>
      p.transform.output_table === outputTable ? { ...p, included: !p.included } : p,
    ));
  };

  const handleAgentRevise = async (feedback: string) => {
    if (!analysis || !firstSheet) return;
    onError('');
    setAgentPhase('revising');
    const result = await reviseGoogleSheetTransforms(
      'static', analysis.raw_files, proposals.map((p) => p.transform), feedback,
    );
    if (!result.success) { onError(result.message); setAgentPhase('review'); return; }
    const includedByTable = new Map(proposals.map((p) => [p.transform.output_table, p.included]));
    setProposals(toProposals({ ...analysis, ...result.data }, includedByTable));
    setDropped(result.data.dropped);
    setAgentPhase('review');
  };

  const handleAgentConfirm = async () => {
    if (!analysis || !firstSheet) return;
    const accepted = proposals.filter((p) => p.included).map((p) => p.transform);
    if (accepted.length === 0) return;
    onError('');
    setAgentPhase('confirming');
    const result = await confirmGoogleSheetImport('static', firstSheet.url, analysis.raw_files, accepted);
    if (!result.success) { onError(result.message); setAgentPhase('review'); return; }

    onChange({ files: [...result.data.files, ...existingFiles] });
    setImportProgress('done');
    setAnalysis(null);
    setProposals([]);
    setDropped([]);
    setAgentPhase('idle');
    setPendingSheets([{ url: '', schema: '', tableName: '' }]);
    setActivePanel('csv-upload');
    setTablesOpen(true);
    // Collapse all schemas except the newly imported one (same behavior as the plain import).
    const importedSchemas = new Set(result.data.files.map((f) => f.schema_name));
    const allSchemas = new Set(existingFiles.map((f) => f.schema_name));
    importedSchemas.forEach((s) => allSchemas.delete(s));
    setCollapsedSchemas(allSchemas);
  };

  const handleAgentCancel = () => {
    setAnalysis(null);
    setProposals([]);
    setDropped([]);
    setAgentPhase('idle');
  };

  const agentReviewing = agentPhase === 'review' || agentPhase === 'revising' || agentPhase === 'confirming';

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

  if (agentReviewing) {
    return (
      <Box p={3}>
        <SheetImportReview
          proposals={proposals}
          dropped={dropped}
          revising={agentPhase === 'revising'}
          confirming={agentPhase === 'confirming'}
          onToggle={handleAgentToggle}
          onRevise={handleAgentRevise}
          onConfirm={handleAgentConfirm}
          onCancel={handleAgentCancel}
        />
      </Box>
    );
  }

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

        <HStack gap={2}>
          <Button
            onClick={handleAgentAnalyze}
            loading={agentPhase === 'analyzing'}
            disabled={pendingSheets.every((s) => !s.url.trim()) || importProgress === 'importing'}
            size="sm"
            bg="accent.teal"
            color="white"
            flex={1}
            aria-label="Import with agent"
          >
            <LuSparkles size={14} /> Import with agent
          </Button>
          <Button
            onClick={handleSheetImport}
            loading={importProgress === 'importing'}
            disabled={pendingSheets.every((s) => !s.url.trim()) || !pendingSheets[0]?.schema || agentPhase === 'analyzing'}
            size="sm"
            variant="subtle"
            flex={1}
            aria-label="Import sheets"
          >
            Import tabs as-is
          </Button>
        </HStack>
        {agentPhase === 'analyzing' && (
          <Text fontSize="xs" color="accent.teal">
            The agent is reading the sheet, finding tables, and writing transforms — this can take a minute…
          </Text>
        )}
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
