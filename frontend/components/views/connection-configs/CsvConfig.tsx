'use client';

import { useState } from 'react';
import { Box, Text, VStack, HStack, Button, Icon, Input } from '@chakra-ui/react';
import { LuUpload, LuX, LuFile } from 'react-icons/lu';
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
    <VStack gap={4} align="stretch">
      {/* File selector */}
      <Box>
        <Text fontSize="sm" fontWeight="700" mb={2}>
          Files
          {mode === 'view' && existingFiles.length > 0 && (
            <Text as="span" fontSize="xs" color="fg.muted" ml={2}>
              ({existingFiles.length} registered)
            </Text>
          )}
        </Text>

        <VStack align="stretch" gap={3}>
          <Button as="label" size="sm" bg="accent.teal" cursor="pointer" width="fit-content">
            <LuUpload /> {mode === 'create' ? 'Select Files' : 'Upload New Files'}
            <input
              type="file"
              accept=".csv,.parquet,.pq,.xlsx"
              multiple
              onChange={(e) => handleFilesSelected(Array.from(e.target.files || []))}
              style={{ display: 'none' }}
            />
          </Button>

          {/* Pending files with per-file schema input */}
          {pendingFiles.length > 0 && (
            <Box p={3} borderRadius="md" border="1px solid" borderColor="accent.teal" bg="accent.teal/5">
              <Text fontSize="xs" fontWeight="600" mb={3} color="accent.teal">
                {pendingFiles.length} file{pendingFiles.length !== 1 ? 's' : ''} selected
              </Text>

              <VStack align="stretch" gap={3}>
                {pendingFiles.map(({ file, schemaName, tableName }, idx) => (
                  <Box key={idx} p={2} borderRadius="sm" bg="bg.surface" border="1px solid" borderColor="border.subtle">
                    <HStack justify="space-between" mb={2}>
                      <HStack gap={2}>
                        <Icon as={LuFile} boxSize={3} color="fg.muted" />
                        <Text fontSize="xs" fontFamily="mono">{file.name}</Text>
                        <Text fontSize="xs" color="fg.muted">({(file.size / 1024).toFixed(1)} KB)</Text>
                      </HStack>
                      <Button size="xs" variant="ghost" onClick={() => removeFile(idx)}>
                        <LuX />
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
                    </HStack>
                    <HStack gap={2} mt={1}>
                      <Text fontSize="xs" color="fg.muted" whiteSpace="nowrap">Table:</Text>
                      <Input
                        size="xs"
                        fontFamily="mono"
                        value={tableName}
                        onChange={(e) => updateTableName(idx, e.target.value)}
                        placeholder="auto-generated from filename"
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
                <LuUpload /> Upload & Register
              </Button>
            </Box>
          )}

          {uploadProgress === 'uploading' && (
            <Text fontSize="xs" color="accent.teal">Uploading to S3 and reading metadata…</Text>
          )}
          {uploadProgress === 'done' && (
            <Text fontSize="xs" color="accent.teal">Files registered. You can now test the connection.</Text>
          )}

          {/* Registered tables */}
          {existingFiles.length > 0 && pendingFiles.length === 0 && (
            <Box p={3} borderRadius="md" border="1px solid" borderColor={mode === 'view' ? 'border.subtle' : 'accent.teal'} bg={mode === 'view' ? 'bg.muted' : 'accent.teal/5'}>
              <Text fontSize="xs" fontWeight="600" mb={2} color={mode === 'view' ? undefined : 'accent.teal'}>
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
                        <Text fontSize="xs" color="fg.muted" fontFamily="mono">{f.file_format}</Text>
                        <Text fontSize="xs" color="fg.muted">{f.row_count.toLocaleString()} rows</Text>
                      </HStack>
                    </HStack>
                    <Text fontSize="xs" color="fg.muted" fontFamily="mono">
                      {f.columns.slice(0, 5).map((c) => c.name).join(', ')}
                      {f.columns.length > 5 ? ` +${f.columns.length - 5} more` : ''}
                    </Text>
                  </Box>
                ))}
              </VStack>
              {mode === 'view' && (
                <Text fontSize="xs" color="fg.muted" mt={3}>
                  Upload new files above to add more tables
                </Text>
              )}
            </Box>
          )}

          <Text fontSize="xs" color="fg.muted">
            Accepts <Text as="span" fontFamily="mono">.csv</Text>,{' '}
            <Text as="span" fontFamily="mono">.parquet</Text>, and{' '}
            <Text as="span" fontFamily="mono">.xlsx</Text> files. Each file (or sheet) becomes a
            table queried as <Text as="span" fontFamily="mono">schema_name.table_name</Text>.
          </Text>
        </VStack>
      </Box>
    </VStack>
  );
}
