'use client';

import { Box, Text, Input, VStack, SimpleGrid, HStack } from '@chakra-ui/react';
import { BaseConfigProps } from './types';

const PROTOCOLS = ['https', 'http'] as const;

export default function ClickHouseConfig({ config, onChange }: BaseConfigProps) {
  const protocol = config.protocol === 'http' ? 'http' : 'https';

  return (
    <VStack gap={3} align="stretch">
      <SimpleGrid columns={2} gap={3}>
        <Box gridColumn="span 2">
          <Text fontSize="sm" fontWeight="700" mb={2}>Host</Text>
          <Input
            aria-label="clickhouse host"
            value={config.host ?? ''}
            onChange={(e) => onChange({ ...config, host: e.target.value })}
            placeholder="play.clickhouse.com"
            fontFamily="mono"
            required
          />
        </Box>
        <Box>
          <Text fontSize="sm" fontWeight="700" mb={2}>Protocol</Text>
          <HStack gap={0}>
            {PROTOCOLS.map((p) => (
              <Box
                as="button"
                key={p}
                aria-label={`clickhouse protocol ${p}`}
                px={3}
                py={1.5}
                fontSize="xs"
                fontWeight="700"
                fontFamily="mono"
                borderRadius="md"
                borderLeftRadius={p === 'https' ? 'md' : 0}
                borderRightRadius={p === 'http' ? 'md' : 0}
                border="1px solid"
                borderLeft={p === 'http' ? '0' : undefined}
                borderColor={protocol === p ? 'accent.primary' : 'border.default'}
                bg={protocol === p ? 'accent.primary/10' : 'transparent'}
                color={protocol === p ? 'accent.primary' : 'fg.muted'}
                onClick={() => onChange({ ...config, protocol: p })}
                cursor="pointer"
              >
                {p}
              </Box>
            ))}
          </HStack>
        </Box>
        <Box>
          <Text fontSize="sm" fontWeight="700" mb={2}>Port</Text>
          <Input
            aria-label="clickhouse port"
            type="number"
            value={config.port ?? ''}
            onChange={(e) => onChange({ ...config, port: e.target.value === '' ? undefined : parseInt(e.target.value) })}
            placeholder={protocol === 'https' ? '8443' : '8123'}
            fontFamily="mono"
          />
        </Box>
      </SimpleGrid>

      <Box>
        <Text fontSize="sm" fontWeight="700" mb={2}>Database</Text>
        <Input
          aria-label="clickhouse database"
          value={config.database ?? ''}
          onChange={(e) => onChange({ ...config, database: e.target.value })}
          placeholder="default"
          fontFamily="mono"
        />
        <Text fontSize="xs" color="fg.muted" mt={1}>
          Default database for unqualified tables; also scopes schema discovery. Leave blank to browse all.
        </Text>
      </Box>

      <SimpleGrid columns={2} gap={3}>
        <Box>
          <Text fontSize="sm" fontWeight="700" mb={2}>Username</Text>
          <Input
            aria-label="clickhouse username"
            value={config.username ?? ''}
            onChange={(e) => onChange({ ...config, username: e.target.value })}
            placeholder="default"
            fontFamily="mono"
            required
          />
        </Box>
        <Box>
          <Text fontSize="sm" fontWeight="700" mb={2}>Password</Text>
          <Input
            aria-label="clickhouse password"
            type="password"
            value={config.password ?? ''}
            onChange={(e) => onChange({ ...config, password: e.target.value })}
            placeholder="(optional)"
            fontFamily="mono"
          />
        </Box>
      </SimpleGrid>
    </VStack>
  );
}
