'use client';

import { Box, Text, HStack, Textarea, Button } from '@chakra-ui/react';
import { LuUpload, LuCheck } from 'react-icons/lu';
import { BaseConfigProps } from './types';

export default function BigQueryConfig({ config, onChange, mode }: BaseConfigProps) {
  const projectId = config.project_id || '';
  const serviceAccountJson = config.service_account_json || '';

  const handleServiceAccountJsonChange = (value: string) => {
    try {
      if (value.trim()) {
        const parsed = JSON.parse(value);
        const extractedProjectId = parsed.project_id || parsed.projectId || parsed.credentials?.project_id;
        onChange({
          ...config,
          service_account_json: value,
          project_id: extractedProjectId || projectId
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
        <HStack justify="space-between" mb={2}>
          <Text fontSize="sm" fontWeight="700">
            Service Account JSON
            {mode === 'view' && (
              <Text as="span" fontSize="xs" color="accent.warning" ml={2}>
                (re-upload required for security)
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
            Upload .json
            <input
              type="file"
              accept=".json"
              onChange={handleFileUpload}
              style={{ display: 'none' }}
            />
          </Button>
        </HStack>
        <Textarea
          value={serviceAccountJson}
          onChange={(e) => handleServiceAccountJsonChange(e.target.value)}
          placeholder='{"type": "service_account", "project_id": "...", ...}'
          fontFamily="mono"
          fontSize="xs"
          minH="120px"
          readOnly
        />
        {/* Project ID — auto-extracted, shown inline */}
        {projectId && (
          <HStack gap={1.5} mt={1.5}>
            <LuCheck size={12} color="var(--chakra-colors-accent-teal)" />
            <Text fontSize="xs" color="fg.muted">
              Project: <Text as="span" fontFamily="mono" fontWeight="600" color="fg.default">{projectId}</Text>
            </Text>
          </HStack>
        )}
      </Box>
    </>
  );
}
