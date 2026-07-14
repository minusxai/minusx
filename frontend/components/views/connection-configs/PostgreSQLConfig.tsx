'use client';

import { useState } from 'react';
import { Box, Text, Input, VStack, SimpleGrid, HStack } from '@chakra-ui/react';
import { BaseConfigProps } from './types';

export default function PostgreSQLConfig({ config, onChange }: BaseConfigProps) {
  // Determine initial mode from config state
  const [inputMode, setInputMode] = useState<'fields' | 'string'>(
    config.connection_string ? 'string' : 'fields'
  );

  const switchToString = () => {
    setInputMode('string');
    // Clear individual fields, keep connection_string
    onChange({ connection_string: config.connection_string || '' });
  };

  const switchToFields = () => {
    setInputMode('fields');
    // Clear connection_string, keep individual fields
    const { connection_string: _, ...rest } = config;
    onChange(rest.host ? rest : { host: 'localhost', port: 5432, database: '', username: '', password: '' });
  };

  return (
    <VStack gap={3} align="stretch">
      <HStack gap={0} alignSelf="flex-start">
        <Box
          as="button"
          px={3}
          py={1.5}
          fontSize="xs"
          fontWeight="700"
          fontFamily="mono"
          borderRadius="md"
          borderRightRadius={0}
          border="1px solid"
          borderColor={inputMode === 'fields' ? 'accent.primary' : 'border.default'}
          bg={inputMode === 'fields' ? 'accent.primary/10' : 'transparent'}
          color={inputMode === 'fields' ? 'accent.primary' : 'fg.muted'}
          onClick={switchToFields}
          cursor="pointer"
        >
          Fields
        </Box>
        <Box
          as="button"
          px={3}
          py={1.5}
          fontSize="xs"
          fontWeight="700"
          fontFamily="mono"
          borderRadius="md"
          borderLeftRadius={0}
          border="1px solid"
          borderLeft="0"
          borderColor={inputMode === 'string' ? 'accent.primary' : 'border.default'}
          bg={inputMode === 'string' ? 'accent.primary/10' : 'transparent'}
          color={inputMode === 'string' ? 'accent.primary' : 'fg.muted'}
          onClick={switchToString}
          cursor="pointer"
        >
          Connection String
        </Box>
      </HStack>

      {inputMode === 'string' ? (
        <Box>
          <Text fontSize="sm" fontWeight="700" mb={2}>Connection String</Text>
          <Input
            aria-label="postgresql connection_string"
            value={config.connection_string || ''}
            onChange={(e) => onChange({ connection_string: e.target.value })}
            placeholder="postgresql://user:password@localhost:5432/mydb?sslmode=disable"
            fontFamily="mono"
          />
          <Text fontSize="xs" color="fg.muted" mt={1}>
            Full PostgreSQL connection URI including SSL options
          </Text>
        </Box>
      ) : (
        <>
          <SimpleGrid columns={2} gap={3}>
            <Box>
              <Text fontSize="sm" fontWeight="700" mb={2}>Host</Text>
              <Input
                aria-label="postgresql host"
                value={config.host ?? ''}
                onChange={(e) => onChange({ ...config, host: e.target.value })}
                placeholder="localhost"
                fontFamily="mono"
              />
            </Box>
            <Box>
              <Text fontSize="sm" fontWeight="700" mb={2}>Port</Text>
              <Input
                aria-label="postgresql port"
                type="number"
                value={config.port ?? ''}
                onChange={(e) => onChange({ ...config, port: e.target.value === '' ? undefined : parseInt(e.target.value) })}
                placeholder="5432"
                fontFamily="mono"
              />
            </Box>
          </SimpleGrid>

          <Box>
            <Text fontSize="sm" fontWeight="700" mb={2}>Database</Text>
            <Input
              aria-label="postgresql database"
              value={config.database || ''}
              onChange={(e) => onChange({ ...config, database: e.target.value })}
              placeholder="my_database"
              fontFamily="mono"
              required
            />
          </Box>

          <SimpleGrid columns={2} gap={3}>
            <Box>
              <Text fontSize="sm" fontWeight="700" mb={2}>Username</Text>
              <Input
                aria-label="postgresql username"
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
                aria-label="postgresql password"
                type="password"
                value={config.password || ''}
                onChange={(e) => onChange({ ...config, password: e.target.value })}
                placeholder="(optional)"
                fontFamily="mono"
              />
              <Text fontSize="xs" color="fg.muted" mt={1}>
                Leave blank for trust/peer auth
              </Text>
            </Box>
          </SimpleGrid>
        </>
      )}
    </VStack>
  );
}
