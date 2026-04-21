'use client';

import { Box, Text, Input, VStack, SimpleGrid } from '@chakra-ui/react';
import { BaseConfigProps } from './types';

export default function AthenaConfig({ config, onChange }: BaseConfigProps) {
  return (
    <VStack gap={3} align="stretch">
      <SimpleGrid columns={2} gap={3}>
        <Box>
          <Text fontSize="sm" fontWeight="700" mb={2}>Region</Text>
          <Input
            value={config.region_name || ''}
            onChange={(e) => onChange({ ...config, region_name: e.target.value })}
            placeholder="us-east-1"
            fontFamily="mono"
          />
        </Box>
        <Box>
          <Text fontSize="sm" fontWeight="700" mb={2}>Workgroup</Text>
          <Input
            value={config.work_group || ''}
            onChange={(e) => onChange({ ...config, work_group: e.target.value })}
            placeholder="primary"
            fontFamily="mono"
          />
        </Box>
      </SimpleGrid>

      <Box>
        <Text fontSize="sm" fontWeight="700" mb={2}>S3 Staging Directory</Text>
        <Input
          value={config.s3_staging_dir || ''}
          onChange={(e) => onChange({ ...config, s3_staging_dir: e.target.value })}
          placeholder="s3://my-bucket/athena-results/"
          fontFamily="mono"
        />
        <Text fontSize="xs" color="fg.muted" mt={1}>
          S3 path where Athena writes query results
        </Text>
      </Box>

      <Box>
        <Text fontSize="sm" fontWeight="700" mb={2}>Default Schema</Text>
        <Input
          value={config.schema_name || ''}
          onChange={(e) => onChange({ ...config, schema_name: e.target.value })}
          placeholder="default"
          fontFamily="mono"
        />
      </Box>

      <SimpleGrid columns={2} gap={3}>
        <Box>
          <Text fontSize="sm" fontWeight="700" mb={2}>AWS Access Key ID</Text>
          <Input
            value={config.aws_access_key_id || ''}
            onChange={(e) => onChange({ ...config, aws_access_key_id: e.target.value })}
            placeholder="(optional)"
            fontFamily="mono"
          />
        </Box>
        <Box>
          <Text fontSize="sm" fontWeight="700" mb={2}>AWS Secret Access Key</Text>
          <Input
            type="password"
            value={config.aws_secret_access_key || ''}
            onChange={(e) => onChange({ ...config, aws_secret_access_key: e.target.value })}
            placeholder="(optional)"
            fontFamily="mono"
          />
        </Box>
      </SimpleGrid>
      <Text fontSize="xs" color="fg.muted" mt={-1}>
        Leave both blank to authenticate via IAM role
      </Text>
    </VStack>
  );
}
