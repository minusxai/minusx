'use client';

import { useState } from 'react';
import { Box, Text, VStack, HStack, Button, Input, Span } from '@chakra-ui/react';
import { LuDownload, LuLink, LuTable, LuCheck } from 'react-icons/lu';
import { CsvFileInfo } from '@/lib/types';
import { importGoogleSheets } from '@/lib/backend/google-sheets';
import { BaseConfigProps } from './types';

interface GoogleSheetsConfigProps extends BaseConfigProps {
  connectionName: string;
  userMode: string;
  onError: (error: string) => void;
}

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
  const [importProgress, setImportProgress] = useState<'idle' | 'importing' | 'done' | 'error'>('idle');
  const [importStage, setImportStage] = useState<string>('');

  const handleImport = async () => {
    if (!spreadsheetUrl) {
      onError('Please enter a Google Sheets URL');
      return;
    }

    if (!connectionName || !/^[a-z0-9_]+$/.test(connectionName)) {
      onError('Please enter a valid connection name first');
      return;
    }

    // Basic URL validation
    if (!spreadsheetUrl.includes('docs.google.com/spreadsheets')) {
      onError('Invalid Google Sheets URL. Expected format: https://docs.google.com/spreadsheets/d/...');
      return;
    }

    setImportProgress('importing');
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
        setImportProgress('error');
        return;
      }

      // Update config with the generated paths and file metadata
      onChange(result.config!);

      setImportProgress('done');
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Import failed');
      setImportProgress('error');
    }
  };

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
            value={spreadsheetUrl}
            onChange={(e) => {
              setSpreadsheetUrl(e.target.value);
              setImportProgress('idle');
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
          fontFamily="mono"
          value={schemaName}
          onChange={(e) => setSchemaName(e.target.value.toLowerCase())}
          placeholder="public"
        />
      </Box>

      {/* Import Button */}
      <Button
        onClick={handleImport}
        loading={importProgress === 'importing'}
        disabled={!spreadsheetUrl}
        bg="accent.teal"
        size="sm"
        width="fit-content"
      >
        <LuDownload size={14} /> {mode === 'create' ? 'Fetch & Create Database' : 'Re-import Sheets'}
      </Button>

      {/* Import progress indicator */}
      {importProgress === 'importing' && importStage && (
        <Text fontSize="xs" color="accent.teal">{importStage}</Text>
      )}
      {importProgress === 'done' && (
        <HStack gap={1.5}>
          <LuCheck size={12} color="var(--chakra-colors-accent-teal)" />
          <Text fontSize="xs" color="accent.teal">
            Database created. You can now test the connection.
          </Text>
        </HStack>
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
                  <Text fontSize="2xs" color="fg.muted">
                    {file.row_count.toLocaleString()} rows
                  </Text>
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
