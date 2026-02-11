'use client';

import { Box, Text, Input, VStack, Button, Textarea } from '@chakra-ui/react';
import { LuUpload } from 'react-icons/lu';
import { BaseConfigProps } from './types';

export default function BigQueryConfig({ config, onChange, mode }: BaseConfigProps) {
  const projectId = config.project_id || '';
  const serviceAccountJson = config.service_account_json || '';

  const handleServiceAccountJsonChange = (value: string) => {
    try {
      if (value.trim()) {
        const parsed = JSON.parse(value);
        onChange({
          ...config,
          service_account_json: value,
          project_id: parsed.project_id || projectId
        });
      } else {
        onChange({
          ...config,
          service_account_json: value
        });
      }
    } catch (e) {
      // Invalid JSON, just update the raw value
      onChange({
        ...config,
        service_account_json: value
      });
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const fileContent = event.target?.result as string;
        handleServiceAccountJsonChange(fileContent);
      };
      reader.readAsText(file);
    }
  };

  return (
    <>
      {/* Service Account JSON */}
      <Box>
        <Text fontSize="sm" fontWeight="700" mb={2}>
          Service Account JSON
          {mode === 'view' && (
            <Text as="span" fontSize="xs" color="accent.warning" ml={2}>
              (re-upload required for security)
            </Text>
          )}
        </Text>
        <VStack align="stretch" gap={2}>
          <Button
            as="label"
            size="sm"
            colorPalette="teal"
            cursor="pointer"
          >
            <LuUpload /> Upload JSON File
            <input
              type="file"
              accept=".json"
              onChange={handleFileUpload}
              style={{ display: 'none' }}
            />
          </Button>
          <hr />
          <Textarea
            value={serviceAccountJson}
            onChange={(e) => handleServiceAccountJsonChange(e.target.value)}
            placeholder='{"type": "service_account", "project_id": "...", ...}'
            fontFamily="mono"
            fontSize="xs"
            minH="150px"
            disabled
          />
          <Text fontSize="xs" color="fg.muted" mt={1}>
            Automatically extracted from service account JSON
          </Text>
        </VStack>
      </Box>
      <Box>
        <Text fontSize="sm" fontWeight="700" mb={2}>
          Project ID
        </Text>
        <Input
          value={projectId}
          readOnly
          placeholder="Extracted from service account JSON"
          fontFamily="mono"
          bg="bg.muted"
        />
        <Text fontSize="xs" color="fg.muted" mt={1}>
          Automatically extracted from service account JSON
        </Text>
      </Box>
    </>
  );
}
