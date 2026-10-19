'use client';

import { Box, Text, Input, VStack, SimpleGrid, NativeSelect } from '@chakra-ui/react';
import type { BaseConfigProps } from './types';

export default function MySQLConfig({ config, onChange }: BaseConfigProps) {
  return (
    <VStack gap={3} align="stretch">
      <SimpleGrid columns={2} gap={3}>
        <Box>
          <Text fontSize="sm" fontWeight="700" mb={2}>Host</Text>
          <Input aria-label="mysql host" value={config.host ?? ''} onChange={e => onChange({ ...config, host: e.target.value })} placeholder="db.example.com" fontFamily="mono" required />
        </Box>
        <Box>
          <Text fontSize="sm" fontWeight="700" mb={2}>Port</Text>
          <Input aria-label="mysql port" type="number" min={1} max={65535} value={config.port ?? ''} onChange={e => onChange({ ...config, port: e.target.value === '' ? undefined : Number(e.target.value) })} placeholder="3306" fontFamily="mono" />
        </Box>
      </SimpleGrid>
      <Text fontSize="xs" color="fg.muted">For Apache Doris, use the FE host and MySQL query port (usually 9030).</Text>
      <Box>
        <Text fontSize="sm" fontWeight="700" mb={2}>Database</Text>
        <Input aria-label="mysql database" value={config.database ?? ''} onChange={e => onChange({ ...config, database: e.target.value })} placeholder="analytics" fontFamily="mono" />
        <Text fontSize="xs" color="fg.muted" mt={1}>Default database for queries and schema discovery. Leave blank to browse all accessible databases.</Text>
      </Box>
      <SimpleGrid columns={2} gap={3}>
        <Box>
          <Text fontSize="sm" fontWeight="700" mb={2}>Username</Text>
          <Input aria-label="mysql username" value={config.username ?? ''} onChange={e => onChange({ ...config, username: e.target.value })} placeholder="reader" fontFamily="mono" required />
        </Box>
        <Box>
          <Text fontSize="sm" fontWeight="700" mb={2}>Password</Text>
          <Input aria-label="mysql password" type="password" value={config.password ?? ''} onChange={e => onChange({ ...config, password: e.target.value })} placeholder="(optional)" fontFamily="mono" />
        </Box>
      </SimpleGrid>
      <Box>
        <Text fontSize="sm" fontWeight="700" mb={2}>TLS</Text>
        <NativeSelect.Root>
          <NativeSelect.Field aria-label="mysql ssl_mode" value={config.ssl_mode ?? 'disabled'} onChange={e => onChange({ ...config, ssl_mode: e.target.value })}>
            <option value="disabled">Disabled</option>
            <option value="required">Required — verify server certificate</option>
          </NativeSelect.Field>
          <NativeSelect.Indicator />
        </NativeSelect.Root>
      </Box>
    </VStack>
  );
}
