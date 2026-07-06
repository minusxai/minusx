'use client';

import { useState, useEffect, type Dispatch, type SetStateAction } from 'react';
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
  LuUpload,
  LuX,
  LuFile,
  LuCheck,
} from 'react-icons/lu';
import { CsvFileInfo } from '@/lib/types';
import { uploadCsvFilesS3, FileWithSchema } from '@/lib/connections/client/csv-upload';
import { sanitizeTableName, validateIdentifier } from '@/lib/csv-utils';
import type { BaseConfigProps } from './types';
import type { ActivePanel } from './StaticConnectionConfig';

// ─── Types ────────────────────────────────────────────────────────────────────

interface PendingFile {
  file: File;
  schemaName: string;
  tableName: string;
}

export interface CsvUploadPanelProps {
  /** Whether the CSV-upload tab is the currently active panel. */
  isActive: boolean;
  existingFiles: CsvFileInfo[];
  collisionSet: Set<string>;
  onChange: BaseConfigProps['onChange'];
  onError: (error: string) => void;
  /** Called when pending (un-uploaded) files change — true if files are staged but not yet uploaded. */
  onPendingChange?: (hasPending: boolean) => void;
  uploadProgress: 'idle' | 'uploading' | 'done' | 'error';
  setUploadProgress: Dispatch<SetStateAction<'idle' | 'uploading' | 'done' | 'error'>>;
  setActivePanel: Dispatch<SetStateAction<ActivePanel>>;
  setTablesOpen: Dispatch<SetStateAction<boolean>>;
  setCollapsedSchemas: Dispatch<SetStateAction<Set<string>>>;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function CsvUploadPanel({
  isActive,
  existingFiles,
  collisionSet,
  onChange,
  onError,
  onPendingChange,
  uploadProgress,
  setUploadProgress,
  setActivePanel,
  setTablesOpen,
  setCollapsedSchemas,
}: CsvUploadPanelProps) {
  // ── CSV upload state ──────────────────────────────────────────────────────
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const [uploadStage, setUploadStage] = useState<string>('');

  // Notify parent when pending files change
  useEffect(() => {
    onPendingChange?.(pendingFiles.length > 0);
  }, [pendingFiles.length, onPendingChange]);

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

  // ── Render ────────────────────────────────────────────────────────────────

  if (!isActive) return null;

  return (
    <Box p={3}>
      {pendingFiles.length === 0 ? (
        <VStack align="stretch" gap={3}>
          {/* Success feedback + compact add-more */}
          {uploadProgress === 'done' && (
            <VStack align="stretch" gap={2}>
              <HStack gap={1.5} px={3} py={2} borderRadius="md" bg="accent.teal/10" border="1px solid" borderColor="accent.teal/30" aria-label="Upload succeeded">
                <LuCheck size={14} color="var(--chakra-colors-accent-teal)" />
                <Text fontSize="xs" color="accent.teal" fontWeight="600">
                  Uploaded successfully. Save connection to persist.
                </Text>
              </HStack>
              <Button as="label" size="xs" variant="ghost" cursor="pointer" color="accent.teal" alignSelf="flex-start">
                <LuUpload size={12} /> Add more files
                <input
                  type="file"
                  accept=".csv,.parquet,.pq,.xlsx"
                  multiple
                  onChange={(e) => handleFilesSelected(Array.from(e.target.files ?? []))}
                  style={{ display: 'none' }}
                />
              </Button>
            </VStack>
          )}
          {/* Empty state — prominent drop zone */}
          {uploadProgress !== 'done' && <Box
            as="label"
            display="flex"
            flexDirection="column"
            alignItems="center"
            gap={2}
            py={6}
            borderRadius="md"
            border="2px dashed"
            borderColor="border.default"
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
              aria-label="CSV file input"
              onChange={(e) => handleFilesSelected(Array.from(e.target.files ?? []))}
              style={{ display: 'none' }}
            />
          </Box>}
        </VStack>
      ) : (
        <VStack align="stretch" gap={3}>
          {/* Dataset name — shared across all files in this upload */}
          <Box>
            <Text fontSize="xs" fontWeight="600" mb={1}>Dataset Name {!pendingFiles[0]?.schemaName && <Text as="span" color="accent.danger">*</Text>}</Text>
            <Input
              size="sm"
              fontFamily="mono"
              borderColor={!pendingFiles[0]?.schemaName ? 'accent.danger' : undefined}
              _focus={!pendingFiles[0]?.schemaName ? { borderColor: 'accent.danger', boxShadow: '0 0 0 1px var(--chakra-colors-accent-danger)' } : undefined}
              value={pendingFiles[0]?.schemaName ?? ''}
              onChange={(e) => {
                const v = e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_');
                setPendingFiles((p) => p.map((pf) => ({ ...pf, schemaName: v })));
              }}
              placeholder="e.g. marketing_data"
              aria-label="CSV dataset name"
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
                <Text fontSize="xs" color="fg.muted" truncate flex={1} minW={0} title={file.name}>
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
            aria-label="Upload files"
          >
            <LuUpload size={14} /> Upload
          </Button>
          {!pendingFiles[0]?.schemaName && (
            <Text fontSize="2xs" color="accent.warning">
              Enter a dataset name above to enable upload.
            </Text>
          )}
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
  );
}
