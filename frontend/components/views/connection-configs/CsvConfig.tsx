'use client';

import { useState } from 'react';
import { Box, Text, VStack, HStack, Button, Icon } from '@chakra-ui/react';
import { LuUpload, LuX, LuFile } from 'react-icons/lu';
import { CsvFileInfo } from '@/lib/types';
import { uploadCsvFiles } from '@/lib/backend/csv-upload';
import { BaseConfigProps } from './types';

interface CsvConfigProps extends BaseConfigProps {
  connectionName: string;
  companyId: number | undefined;
  userMode: string;
  onError: (error: string) => void;
}

export default function CsvConfig({
  config,
  onChange,
  mode,
  connectionName,
  companyId,
  userMode,
  onError
}: CsvConfigProps) {
  const [csvFiles, setCsvFiles] = useState<File[]>([]);
  const [uploadProgress, setUploadProgress] = useState<'idle' | 'uploading' | 'done' | 'error'>('idle');

  const handleCsvUpload = async () => {
    if (csvFiles.length === 0) {
      onError('Please select at least one CSV file');
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

    setUploadProgress('uploading');

    try {
      const result = await uploadCsvFiles(
        connectionName,
        csvFiles,
        companyId,
        userMode,
        mode === 'view'  // replace_existing in view mode
      );

      if (!result.success) {
        onError(result.message);
        setUploadProgress('error');
        return;
      }

      // Update config with the generated paths and file metadata
      onChange(result.config!);

      setUploadProgress('done');
      setCsvFiles([]);  // Clear selected files after successful upload
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Upload failed');
      setUploadProgress('error');
    }
  };

  return (
    <VStack gap={4} align="stretch">
      {/* File Upload Section */}
      <Box>
        <Text fontSize="sm" fontWeight="700" mb={2}>
          CSV Files
          {mode === 'view' && config.files?.length > 0 && (
            <Text as="span" fontSize="xs" color="fg.muted" ml={2}>
              ({config.files.length} table{config.files.length !== 1 ? 's' : ''} loaded)
            </Text>
          )}
        </Text>

        {/* File Input for Upload */}
        <VStack align="stretch" gap={3}>
          <Button
            as="label"
            size="sm"
            colorPalette="teal"
            cursor="pointer"
            width="fit-content"
          >
            <LuUpload /> {mode === 'create' ? 'Select CSV Files' : 'Upload New Files'}
            <input
              type="file"
              accept=".csv"
              multiple
              onChange={(e) => {
                const files = Array.from(e.target.files || []);
                setCsvFiles(files);
                setUploadProgress('idle');
              }}
              style={{ display: 'none' }}
            />
          </Button>

          {/* Show selected files (pending upload) */}
          {csvFiles.length > 0 && (
            <Box
              p={3}
              borderRadius="md"
              border="1px solid"
              borderColor="accent.teal"
              bg="accent.teal/5"
            >
              <Text fontSize="xs" fontWeight="600" mb={2} color="accent.teal">
                {csvFiles.length} file{csvFiles.length !== 1 ? 's' : ''} selected
              </Text>
              <VStack align="stretch" gap={1}>
                {csvFiles.map((file, idx) => (
                  <HStack key={idx} justify="space-between">
                    <HStack gap={2}>
                      <Icon as={LuFile} boxSize={3} color="fg.muted" />
                      <Text fontSize="xs" fontFamily="mono">{file.name}</Text>
                      <Text fontSize="xs" color="fg.muted">
                        ({(file.size / 1024).toFixed(1)} KB)
                      </Text>
                    </HStack>
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={() => {
                        setCsvFiles(csvFiles.filter((_, i) => i !== idx));
                      }}
                    >
                      <LuX />
                    </Button>
                  </HStack>
                ))}
              </VStack>

              {/* Upload & Create Database button */}
              <Button
                onClick={handleCsvUpload}
                loading={uploadProgress === 'uploading'}
                disabled={csvFiles.length === 0}
                colorPalette="teal"
                size="sm"
                mt={3}
                width="100%"
              >
                <LuUpload /> Upload & Create Database
              </Button>
            </Box>
          )}

          {/* Upload progress indicator */}
          {uploadProgress === 'uploading' && (
            <Text fontSize="xs" color="accent.teal">
              Uploading and processing CSV files...
            </Text>
          )}
          {uploadProgress === 'done' && (
            <Text fontSize="xs" color="accent.success">
              Database created successfully! You can now test the connection.
            </Text>
          )}

          {/* Show existing tables in view mode */}
          {mode === 'view' && config.files?.length > 0 && csvFiles.length === 0 && (
            <Box
              p={3}
              borderRadius="md"
              border="1px solid"
              borderColor="border.subtle"
              bg="bg.muted"
            >
              <Text fontSize="xs" fontWeight="600" mb={2}>
                Uploaded Tables
              </Text>
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
              <Text fontSize="xs" color="fg.muted" mt={3}>
                Upload new files above to replace existing data
              </Text>
            </Box>
          )}

          {/* Show created tables after upload in create mode */}
          {mode === 'create' && config.files?.length > 0 && csvFiles.length === 0 && (
            <Box
              p={3}
              borderRadius="md"
              border="1px solid"
              borderColor="accent.success"
              bg="accent.success/5"
            >
              <Text fontSize="xs" fontWeight="600" mb={2} color="accent.success">
                Created Tables
              </Text>
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

          <Text fontSize="xs" color="fg.muted">
            Each CSV file will be converted to a table. Table names are derived from filenames.
          </Text>
        </VStack>
      </Box>
    </VStack>
  );
}
