'use client';

import { useState } from 'react';
import { Box, Text, VStack, HStack, Button, Input } from '@chakra-ui/react';
import { LuUpload, LuX, LuFile, LuCheck } from 'react-icons/lu';
import { CsvFileInfo } from '@/lib/types';
import { uploadCsvFilesS3, FileWithSchema } from '@/lib/backend/csv-upload';
import { BaseConfigProps } from './types';

interface CsvConfigProps extends BaseConfigProps {
  connectionName: string;
  onError: (error: string) => void;
}

interface PendingFile {
  file: File;
  schemaName: string;
  tableName: string;
}

export default function CsvConfig({
  config,
  onChange,
  mode,
  connectionName,
  onError,
}: CsvConfigProps) {
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const [uploadProgress, setUploadProgress] = useState<'idle' | 'uploading' | 'done' | 'error'>('idle');
  const [uploadStage, setUploadStage] = useState<string>('');

  const handleFilesSelected = (selected: File[]) => {
    setPendingFiles(
      selected.map((file) => ({
        file,
        schemaName: 'public',
        tableName: file.name.replace(/\.[^.]+$/, '').replace(/[\s-]/g, '_').toLowerCase(),
      }))
    );
    setUploadProgress('idle');
  };

  const updateSchema = (idx: number, schemaName: string) => {
    setPendingFiles((prev) =>
      prev.map((pf, i) => (i === idx ? { ...pf, schemaName: schemaName.toLowerCase() } : pf))
    );
  };

  const updateTableName = (idx: number, tableName: string) => {
    setPendingFiles((prev) =>
      prev.map((pf, i) => (i === idx ? { ...pf, tableName: tableName.toLowerCase() } : pf))
    );
  };

  const removeFile = (idx: number) => {
    setPendingFiles((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleUpload = async () => {
    if (pendingFiles.length === 0) {
      onError('Please select at least one file');
      return;
    }
    if (!connectionName || !/^[a-z0-9_]+$/.test(connectionName)) {
      onError('Please enter a valid connection name first');
      return;
    }
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

      const result = await uploadCsvFilesS3(
        connectionName,
        filesWithSchema,
        mode === 'view',
        setUploadStage,
      );

      if (!result.success) {
        onError(result.message);
        setUploadProgress('error');
        return;
      }

      onChange(result.config!);
      setUploadProgress('done');
      setPendingFiles([]);
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Upload failed');
      setUploadProgress('error');
    }
  };

  const existingFiles = (config.files ?? []) as CsvFileInfo[];

  return (
    <VStack gap={3} align="stretch">
      {/* File selector */}
      <Box>
        <HStack justify="space-between" mb={2}>
          <Text fontSize="sm" fontWeight="700">
            Files
            {mode === 'view' && existingFiles.length > 0 && (
              <Text as="span" fontSize="xs" color="fg.muted" ml={2}>
                ({existingFiles.length} registered)
              </Text>
            )}
          </Text>
          <Button
            as="label"
            size="xs"
            variant="outline"
            cursor="pointer"
          >
            <LuUpload size={12} />
            {mode === 'create' ? 'Select Files' : 'Upload Files'}
            <input
              type="file"
              accept=".csv,.parquet,.pq,.xlsx"
              multiple
              onChange={(e) => handleFilesSelected(Array.from(e.target.files || []))}
              style={{ display: 'none' }}
            />
          </Button>
        </HStack>

        <Text fontSize="xs" color="fg.muted" mb={3}>
          Accepts <Text as="span" fontFamily="mono">.csv</Text>,{' '}
          <Text as="span" fontFamily="mono">.parquet</Text>, and{' '}
          <Text as="span" fontFamily="mono">.xlsx</Text> files
        </Text>

        <VStack align="stretch" gap={3}>
          {/* Pending files with per-file schema input */}
          {pendingFiles.length > 0 && (
            <Box p={3} borderRadius="md" border="1px solid" borderColor="accent.teal/30" bg="accent.teal/5">
              <Text fontSize="xs" fontWeight="600" mb={2} color="accent.teal">
                {pendingFiles.length} file{pendingFiles.length !== 1 ? 's' : ''} selected
              </Text>

              <VStack align="stretch" gap={2}>
                {pendingFiles.map(({ file, schemaName, tableName }, idx) => (
                  <Box key={idx} p={2} borderRadius="md" bg="bg.surface" border="1px solid" borderColor="border.subtle">
                    <HStack justify="space-between" mb={2}>
                      <HStack gap={2}>
                        <LuFile size={12} color="var(--chakra-colors-fg-muted)" />
                        <Text fontSize="xs" fontFamily="mono">{file.name}</Text>
                        <Text fontSize="2xs" color="fg.muted">({(file.size / 1024).toFixed(1)} KB)</Text>
                      </HStack>
                      <Button size="xs" variant="ghost" onClick={() => removeFile(idx)}>
                        <LuX size={12} />
                      </Button>
                    </HStack>
                    <HStack gap={2}>
                      <Text fontSize="xs" color="fg.muted" whiteSpace="nowrap">Schema:</Text>
                      <Input
                        size="xs"
                        fontFamily="mono"
                        value={schemaName}
                        onChange={(e) => updateSchema(idx, e.target.value)}
                        placeholder="public"
                      />
                      <Text fontSize="xs" color="fg.muted" whiteSpace="nowrap">Table:</Text>
                      <Input
                        size="xs"
                        fontFamily="mono"
                        value={tableName}
                        onChange={(e) => updateTableName(idx, e.target.value)}
                        placeholder="auto from filename"
                      />
                    </HStack>
                  </Box>
                ))}
              </VStack>

              <Button
                onClick={handleUpload}
                loading={uploadProgress === 'uploading'}
                disabled={pendingFiles.length === 0}
                bg="accent.teal"
                size="sm"
                mt={3}
                width="100%"
              >
                <LuUpload size={14} /> Upload & Register
              </Button>
            </Box>
          )}

          {uploadProgress === 'uploading' && uploadStage && (
            <Text fontSize="xs" color="accent.teal">{uploadStage}</Text>
          )}
          {uploadProgress === 'done' && (
            <HStack gap={1.5}>
              <LuCheck size={12} color="var(--chakra-colors-accent-teal)" />
              <Text fontSize="xs" color="accent.teal">Files registered. You can now test the connection.</Text>
            </HStack>
          )}

          {/* Registered tables */}
          {existingFiles.length > 0 && pendingFiles.length === 0 && (
            <Box p={3} borderRadius="md" border="1px solid" borderColor="border.subtle" bg="bg.muted">
              <Text fontSize="xs" fontWeight="600" mb={2}>
                Registered Tables
              </Text>
              <VStack align="stretch" gap={2}>
                {existingFiles.map((f, idx) => (
                  <Box key={idx}>
                    <HStack justify="space-between">
                      <Text fontSize="xs" fontFamily="mono" fontWeight="600">
                        {f.schema_name}.{f.table_name}
                      </Text>
                      <HStack gap={2}>
                        <Text fontSize="2xs" color="fg.muted" fontFamily="mono">{f.file_format}</Text>
                        <Text fontSize="2xs" color="fg.muted">{f.row_count.toLocaleString()} rows</Text>
                      </HStack>
                    </HStack>
                    <Text fontSize="2xs" color="fg.muted" fontFamily="mono">
                      {f.columns.slice(0, 5).map((c) => c.name).join(', ')}
                      {f.columns.length > 5 ? ` +${f.columns.length - 5} more` : ''}
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
