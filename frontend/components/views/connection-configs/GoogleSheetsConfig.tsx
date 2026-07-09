'use client';

import { useState } from 'react';
import { Box, Text, VStack, HStack, Button, Input, Span } from '@chakra-ui/react';
import { LuDownload, LuLink, LuTable, LuCheck, LuSparkles } from 'react-icons/lu';
import { CsvFileInfo } from '@/lib/types';
import {
  importGoogleSheets,
  analyzeGoogleSheet,
  reviseGoogleSheetTransforms,
  confirmGoogleSheetImport,
  type SheetAnalysisResult,
} from '@/lib/connections/client/google-sheets';
import SheetImportReview, { type SheetImportProposal } from './SheetImportReview';
import { BaseConfigProps } from './types';

interface GoogleSheetsConfigProps extends BaseConfigProps {
  connectionName: string;
  userMode: string;
  onError: (error: string) => void;
}

type ImportPhase = 'idle' | 'importing' | 'analyzing' | 'review' | 'revising' | 'confirming' | 'done' | 'error';

export default function GoogleSheetsConfig({
  config,
  onChange,
  mode,
  connectionName,
  userMode,
  onError
}: GoogleSheetsConfigProps) {
  const [spreadsheetUrl, setSpreadsheetUrl] = useState<string>(config.spreadsheet_url || '');
  const [schemaName, setSchemaName] = useState<string>(config.schema_name || 'public');
  const [phase, setPhase] = useState<ImportPhase>('idle');
  const [importStage, setImportStage] = useState<string>('');
  // Agentic review state: the analysis (raw grids + spreadsheet id) and the proposals the
  // user is confirming/redacting. Previews live inside proposals.
  const [analysis, setAnalysis] = useState<SheetAnalysisResult | null>(null);
  const [proposals, setProposals] = useState<SheetImportProposal[]>([]);
  const [dropped, setDropped] = useState<string[]>([]);

  const validateInputs = (): boolean => {
    if (!spreadsheetUrl) {
      onError('Please enter a Google Sheets URL');
      return false;
    }
    if (!connectionName || !/^[a-z0-9_]+$/.test(connectionName)) {
      onError('Please enter a valid connection name first');
      return false;
    }
    if (!spreadsheetUrl.includes('docs.google.com/spreadsheets')) {
      onError('Invalid Google Sheets URL. Expected format: https://docs.google.com/spreadsheets/d/...');
      return false;
    }
    return true;
  };

  // ── Agentic flow (primary): analyze → review/redact/feedback → confirm ──────

  const handleAnalyze = async () => {
    if (!validateInputs()) return;
    setPhase('analyzing');
    setImportStage('The agent is reading the sheet and writing transforms…');
    const result = await analyzeGoogleSheet(connectionName, spreadsheetUrl);
    if (!result.success) {
      onError(result.message);
      setPhase('error');
      return;
    }
    setAnalysis(result.data);
    setProposals(result.data.transforms.map(t => ({
      transform: t,
      preview: result.data.previews[t.output_table],
      included: true,
    })));
    setDropped(result.data.dropped);
    setPhase('review');
  };

  const handleToggle = (outputTable: string) => {
    setProposals(prev => prev.map(p =>
      p.transform.output_table === outputTable ? { ...p, included: !p.included } : p,
    ));
  };

  const handleRevise = async (feedback: string) => {
    if (!analysis) return;
    setPhase('revising');
    const result = await reviseGoogleSheetTransforms(
      connectionName,
      analysis.raw_files,
      proposals.map(p => p.transform),
      feedback,
    );
    if (!result.success) {
      onError(result.message);
      setPhase('review');
      return;
    }
    const previouslyExcluded = new Set(proposals.filter(p => !p.included).map(p => p.transform.output_table));
    setProposals(result.data.transforms.map(t => ({
      transform: t,
      preview: result.data.previews[t.output_table],
      included: !previouslyExcluded.has(t.output_table),
    })));
    setDropped(result.data.dropped);
    setPhase('review');
  };

  const handleConfirm = async () => {
    if (!analysis) return;
    const accepted = proposals.filter(p => p.included).map(p => p.transform);
    if (accepted.length === 0) return;
    setPhase('confirming');
    const result = await confirmGoogleSheetImport(connectionName, spreadsheetUrl, analysis.raw_files, accepted);
    if (!result.success) {
      onError(result.message);
      setPhase('review');
      return;
    }
    onChange({
      files: result.data.files,
      spreadsheet_url: result.data.spreadsheet_url,
      spreadsheet_id: result.data.spreadsheet_id,
      schema_name: schemaName,
    });
    setAnalysis(null);
    setProposals([]);
    setPhase('done');
  };

  const handleCancelReview = () => {
    setAnalysis(null);
    setProposals([]);
    setDropped([]);
    setPhase('idle');
  };

  // ── Legacy flow (secondary): import every tab as-is ─────────────────────────

  const handleImport = async () => {
    if (!validateInputs()) return;
    setPhase('importing');
    setImportStage('Downloading from Google Sheets…');
    try {
      const result = await importGoogleSheets(
        connectionName,
        spreadsheetUrl,
        mode === 'view',  // replace_existing in view mode
        schemaName,
      );
      if (!result.success) {
        onError(result.message);
        setPhase('error');
        return;
      }
      onChange(result.config!);
      setPhase('done');
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Import failed');
      setPhase('error');
    }
  };

  const busy = phase === 'importing' || phase === 'analyzing' || phase === 'revising' || phase === 'confirming';
  const reviewing = phase === 'review' || phase === 'revising' || phase === 'confirming';

  return (
    <VStack gap={3} align="stretch">
      {/* Google Sheets URL Input */}
      <Box>
        <Text fontSize="sm" fontWeight="700" mb={2}>
          Google Sheets URL
          {mode === 'view' && config.files?.length > 0 && (
            <Text as="span" fontSize="xs" color="fg.muted" ml={2}>
              ({config.files.length} sheet{config.files.length !== 1 ? 's' : ''} imported)
            </Text>
          )}
        </Text>

        <HStack gap={2}>
          <LuLink size={16} color="var(--chakra-colors-fg-muted)" style={{ flexShrink: 0 }} />
          <Input
            aria-label="Google Sheets URL"
            value={spreadsheetUrl}
            onChange={(e) => {
              setSpreadsheetUrl(e.target.value);
              setPhase('idle');
            }}
            placeholder="https://docs.google.com/spreadsheets/d/..."
            fontFamily="mono"
            fontSize="sm"
          />
        </HStack>

        <Text fontSize="xs" color="fg.muted" mt={1.5}>
          Must be shared as <Span color="accent.warning">&quot;Anyone with the link can view&quot;</Span>
        </Text>
      </Box>

      {/* Schema Input */}
      <Box>
        <Text fontSize="sm" fontWeight="700" mb={2}>Schema</Text>
        <Input
          aria-label="Schema name"
          fontFamily="mono"
          value={schemaName}
          onChange={(e) => setSchemaName(e.target.value.toLowerCase())}
          placeholder="public"
        />
      </Box>

      {/* Action buttons (hidden while reviewing) */}
      {!reviewing && (
        <HStack gap={2}>
          <Button
            aria-label="Analyze and import with agent"
            onClick={handleAnalyze}
            loading={phase === 'analyzing'}
            disabled={!spreadsheetUrl || busy}
            bg="accent.teal"
            size="sm"
            width="fit-content"
          >
            <LuSparkles size={14} /> Import with Agent
          </Button>
          <Button
            aria-label="Import tabs as-is"
            onClick={handleImport}
            loading={phase === 'importing'}
            disabled={!spreadsheetUrl || busy}
            variant="subtle"
            size="sm"
            width="fit-content"
          >
            <LuDownload size={14} /> {mode === 'create' ? 'Import tabs as-is' : 'Re-import Sheets'}
          </Button>
        </HStack>
      )}

      {/* Progress indicator */}
      {(phase === 'importing' || phase === 'analyzing') && importStage && (
        <Text fontSize="xs" color="accent.teal">{importStage}</Text>
      )}
      {phase === 'done' && (
        <HStack gap={1.5}>
          <LuCheck size={12} color="var(--chakra-colors-accent-teal)" />
          <Text fontSize="xs" color="accent.teal">
            Database created. You can now test the connection.
          </Text>
        </HStack>
      )}

      {/* Agentic review step: confirm / redact / feedback */}
      {reviewing && (
        <SheetImportReview
          proposals={proposals}
          dropped={dropped}
          revising={phase === 'revising'}
          confirming={phase === 'confirming'}
          onToggle={handleToggle}
          onRevise={handleRevise}
          onConfirm={handleConfirm}
          onCancel={handleCancelReview}
        />
      )}

      {/* Imported tables list */}
      {config.files?.length > 0 && (
        <Box
          p={3}
          borderRadius="md"
          border="1px solid"
          borderColor="border.subtle"
          bg="bg.muted"
        >
          <HStack gap={2} mb={2}>
            <LuTable size={14} color="var(--chakra-colors-fg-muted)" />
            <Text fontSize="xs" fontWeight="600">
              {mode === 'view' ? 'Imported Sheets' : 'Created Tables'}
            </Text>
          </HStack>
          <VStack align="stretch" gap={2}>
            {(config.files as CsvFileInfo[]).map((file, idx) => (
              <Box key={idx}>
                <HStack justify="space-between">
                  <Text fontSize="xs" fontFamily="mono" fontWeight="600">
                    {file.schema_name || schemaName}.{file.table_name}
                  </Text>
                  <HStack gap={1.5}>
                    {file.transform && (
                      <HStack gap={0.5}>
                        <LuSparkles size={10} color="var(--chakra-colors-accent-teal)" />
                        <Text fontSize="2xs" color="accent.teal">agent</Text>
                      </HStack>
                    )}
                    <Text fontSize="2xs" color="fg.muted">
                      {file.row_count.toLocaleString()} rows
                    </Text>
                  </HStack>
                </HStack>
                <Text fontSize="2xs" color="fg.muted" fontFamily="mono">
                  {file.columns.map(c => c.name).join(', ')}
                </Text>
              </Box>
            ))}
          </VStack>
          {config.spreadsheet_url && mode === 'view' && (
            <Text fontSize="2xs" color="fg.muted" mt={2} fontFamily="mono" truncate>
              {config.spreadsheet_url}
            </Text>
          )}
        </Box>
      )}
    </VStack>
  );
}
