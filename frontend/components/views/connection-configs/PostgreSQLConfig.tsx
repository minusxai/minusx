'use client';

import { Box, Text, Input, VStack } from '@chakra-ui/react';
import { BaseConfigProps } from './types';

export default function PostgreSQLConfig({ config, onChange }: BaseConfigProps) {
  return (
    <VStack gap={3} align="stretch">
      <Box>
        <Text fontSize="sm" fontWeight="700" mb={2}>Host</Text>
        <Input
          value={config.host || 'localhost'}
          onChange={(e) => onChange({ ...config, host: e.target.value })}
          placeholder="localhost"
          fontFamily="mono"
        />
      </Box>

      <Box>
        <Text fontSize="sm" fontWeight="700" mb={2}>Port</Text>
        <Input
          type="number"
          value={config.port || 5432}
          onChange={(e) => onChange({ ...config, port: parseInt(e.target.value) || 5432 })}
          placeholder="5432"
          fontFamily="mono"
        />
      </Box>

      <Box>
        <Text fontSize="sm" fontWeight="700" mb={2}>Database</Text>
        <Input
          value={config.database || ''}
          onChange={(e) => onChange({ ...config, database: e.target.value })}
          placeholder="my_database"
          fontFamily="mono"
          required
        />
      </Box>

      <Box>
        <Text fontSize="sm" fontWeight="700" mb={2}>Username</Text>
        <Input
          value={config.username || ''}
          onChange={(e) => onChange({ ...config, username: e.target.value })}
          placeholder="postgres"
          fontFamily="mono"
          required
        />
      </Box>

      <Box>
        <Text fontSize="sm" fontWeight="700" mb={2}>Password</Text>
        <Input
          type="password"
          value={config.password || ''}
          onChange={(e) => onChange({ ...config, password: e.target.value })}
          placeholder="(optional)"
          fontFamily="mono"
        />
        <Text fontSize="xs" color="fg.muted" mt={1}>
          Optional - leave blank for trust/peer authentication
        </Text>
      </Box>
    </VStack>
  );
}
