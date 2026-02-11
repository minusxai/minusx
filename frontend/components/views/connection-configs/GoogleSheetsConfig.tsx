'use client';

import { useState } from 'react';
import { Box, Text, VStack, HStack, Button, Input, Icon, Span } from '@chakra-ui/react';
import { LuDownload, LuLink, LuTable } from 'react-icons/lu';
import { CsvFileInfo } from '@/lib/types';
import { importGoogleSheets } from '@/lib/backend/google-sheets';
import { BaseConfigProps } from './types';

interface GoogleSheetsConfigProps extends BaseConfigProps {
  connectionName: string;
  companyId: number | undefined;
  userMode: string;
  onError: (error: string) => void;
}

export default function GoogleSheetsConfig({
  config,
  onChange,
  mode,
  connectionName,
  companyId,
  userMode,
  onError
}: GoogleSheetsConfigProps) {
  const [spreadsheetUrl, setSpreadsheetUrl] = useState<string>(config.spreadsheet_url || '');
  const [importProgress, setImportProgress] = useState<'idle' | 'importing' | 'done' | 'error'>('idle');

  const handleImport = async () => {
    if (!spreadsheetUrl) {
      onError('Please enter a Google Sheets URL');
      return;
    }

    if (!companyId) {
      onError('Unable to determine company ID');
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

    try {
      const result = await importGoogleSheets(
        connectionName,
        spreadsheetUrl,
        companyId,
        userMode,
        mode === 'view'  // replace_existing in view mode
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
    <VStack gap={4} align="stretch">
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

        <VStack align="stretch" gap={3}>
          {/* URL Input */}
          <HStack gap={2}>
            <Icon as={LuLink} boxSize={4} color="fg.muted" />
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

          <Text fontSize="xs" color="fg.muted">
            Enter the URL of a public Google Sheets document. The sheet must be shared as <Span color="accent.warning">&quot;Anyone with the link can view&quot;</Span>.
          </Text>

          {/* Import Button */}
          <Button
            onClick={handleImport}
            loading={importProgress === 'importing'}
            disabled={!spreadsheetUrl}
            colorPalette="teal"
            size="sm"
            width="fit-content"
          >
            <LuDownload /> {mode === 'create' ? 'Fetch & Create Database' : 'Re-import Sheets'}
          </Button>

          {/* Import progress indicator */}
          {importProgress === 'importing' && (
            <Text fontSize="xs" color="accent.teal">
              Downloading and processing Google Sheets... This may take a moment.
            </Text>
          )}
          {importProgress === 'done' && (
            <Text fontSize="xs" color="accent.success">
              Database created successfully! You can now test the connection.
            </Text>
          )}

          {/* Show existing tables in view mode */}
          {mode === 'view' && config.files?.length > 0 && (
            <Box
              p={3}
              borderRadius="md"
              border="1px solid"
              borderColor="border.subtle"
              bg="bg.muted"
            >
              <HStack gap={2} mb={2}>
                <Icon as={LuTable} boxSize={4} color="fg.muted" />
                <Text fontSize="xs" fontWeight="600">
                  Imported Sheets
                </Text>
              </HStack>
              <VStack align="stretch" gap={2}>
                {(config.files as CsvFileInfo[]).map((file, idx) => (
                  <Box key={idx}>
                    <HStack justify="space-between">
                      <Text fontSize="xs" fontFamily="mono" fontWeight="600">
                        {file.table_name}
                      </Text>
                      <Text fontSize="xs" color="fg.muted">
                        {file.row_count.toLocaleString()} rows
                      </Text>
                    </HStack>
                    <Text fontSize="xs" color="fg.muted" fontFamily="mono">
                      {file.columns.map(c => c.name).join(', ')}
                    </Text>
                  </Box>
                ))}
              </VStack>
              {config.spreadsheet_url && (
                <Text fontSize="xs" color="fg.muted" mt={3}>
                  Source: {config.spreadsheet_url}
                </Text>
              )}
            </Box>
          )}

          {/* Show created tables after import in create mode */}
          {mode === 'create' && config.files?.length > 0 && (
            <Box
              p={3}
              borderRadius="md"
              border="1px solid"
              borderColor="accent.success"
              bg="accent.success/5"
            >
              <HStack gap={2} mb={2}>
                <Icon as={LuTable} boxSize={4} color="accent.success" />
                <Text fontSize="xs" fontWeight="600" color="accent.success">
                  Created Tables
                </Text>
              </HStack>
              <VStack align="stretch" gap={2}>
                {(config.files as CsvFileInfo[]).map((file, idx) => (
                  <Box key={idx}>
                    <HStack justify="space-between">
                      <Text fontSize="xs" fontFamily="mono" fontWeight="600">
                        {file.table_name}
                      </Text>
                      <Text fontSize="xs" color="fg.muted">
                        {file.row_count.toLocaleString()} rows
                      </Text>
                    </HStack>
                    <Text fontSize="xs" color="fg.muted" fontFamily="mono">
                      {file.columns.map(c => c.name).join(', ')}
                    </Text>
                  </Box>
                ))}
              </VStack>
            </Box>
          )}
        </VStack>
      </Box>
    </VStack>
  );
}
