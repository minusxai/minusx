'use client';

import { useState } from 'react';
import { Box, VStack, SimpleGrid, Text, Spinner } from '@chakra-ui/react';
import Image from 'next/image';
import ConnectionContainerV2 from '@/components/containers/ConnectionContainerV2';
import { createDraftFile, editFile } from '@/lib/api/file-state';
import { useAppSelector } from '@/store/hooks';
import { resolvePath } from '@/lib/mode/path-resolver';

interface StepConnectionProps {
  onComplete: (connectionId: number, connectionName: string) => void;
  onStaticSelect?: (tab: 'csv' | 'sheets') => void;
  greeting?: string;
}

const CONNECTION_TYPES = [
  { type: 'bigquery' as const,      name: 'BigQuery',       logo: '/logos/bigquery.svg',       comingSoon: false },
  { type: 'postgresql' as const,    name: 'PostgreSQL',     logo: '/logos/postgresql.svg',     comingSoon: false },
  { type: 'csv' as const,           name: 'CSV / xlsx',     logo: '/logos/csv.svg',            comingSoon: false, isStatic: true, note: 'Managed in your static connection' },
  { type: 'google-sheets' as const, name: 'Google Sheets',  logo: '/logos/google-sheets.svg',  comingSoon: false, isStatic: true, note: 'Public sheets only' },
  { type: 'athena' as const,        name: 'Athena',         logo: '/logos/athena.svg',         comingSoon: false },
  { type: 'clickhouse' as const,    name: 'ClickHouse',     logo: '/logos/clickhouse.svg',     comingSoon: true },
  { type: 'databricks' as const,    name: 'Databricks',     logo: '/logos/databricks.svg',     comingSoon: true },
  { type: 'snowflake' as const,     name: 'Snowflake',      logo: '/logos/snowflake.svg',      comingSoon: true },
];

export default function StepConnection({ onComplete, onStaticSelect, greeting }: StepConnectionProps) {
  const [draftFileId, setDraftFileId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const userMode = useAppSelector(state => state.auth.user?.mode) || 'org';

  const handleTypeSelect = async (connType: typeof CONNECTION_TYPES[number]) => {
    if (connType.comingSoon) return;

    if ('isStatic' in connType && connType.isStatic) {
      const tab = connType.type === 'google-sheets' ? 'sheets' : 'csv';
      onStaticSelect?.(tab);
      return;
    }

    setCreating(true);
    try {
      const folder = resolvePath(userMode, '/database');
      const id = await createDraftFile('connection', { folder });
      editFile({ fileId: id, changes: { content: { type: connType.type as any } } });
      setDraftFileId(id);
    } finally {
      setCreating(false);
    }
  };

  if (draftFileId) {
    return (
      <ConnectionContainerV2
        fileId={draftFileId}
        mode="create"
        skipTypePicker
        onSaveSuccess={onComplete}
        hideCancel
      />
    );
  }

  return (
    <Box p={6} overflowY="auto">
      <VStack align="stretch" gap={8} pb={4}>
        <VStack align="start" gap={2}>
          <Text fontSize="2xl" fontWeight="900" letterSpacing="-0.02em" fontFamily="mono">
            {greeting || 'Add Connection'}
          </Text>
          {!greeting && (
            <Text color="fg.muted" fontSize="sm">Select a database type to connect to</Text>
          )}
        </VStack>

        {creating && (
          <Box display="flex" justifyContent="center" py={4}>
            <Spinner size="lg" color="accent.teal" />
          </Box>
        )}

        <SimpleGrid columns={{ base: 2, md: 4 }} gap={3}>
          {CONNECTION_TYPES.map((connType) => (
            <Box
              key={connType.type}
              as="button"
              onClick={() => !connType.comingSoon && !creating && handleTypeSelect(connType)}
              px={4}
              py={4}
              borderRadius="lg"
              border="1px solid"
              borderColor="border.default"
              bg="bg.surface"
              cursor={connType.comingSoon || creating ? 'not-allowed' : 'pointer'}
              textAlign="center"
              transition="all 0.15s"
              position="relative"
              opacity={connType.comingSoon ? 0.45 : 1}
              _hover={connType.comingSoon || creating ? {} : {
                borderColor: 'accent.teal',
                bg: 'bg.muted',
              }}
            >
              {connType.comingSoon && (
                <Text position="absolute" top={1.5} right={2} fontSize="2xs" color="fg.muted" fontWeight="600">
                  Soon
                </Text>
              )}
              <VStack gap={2}>
                <Box w="36px" h="36px" position="relative" flexShrink={0}>
                  <Image src={connType.logo} alt={connType.name} fill style={{ objectFit: 'contain' }} />
                </Box>
                <VStack gap={0}>
                  <Text fontWeight="600" fontSize="sm" fontFamily="mono" color="fg.default">
                    {connType.name}
                  </Text>
                  {'note' in connType && (
                    <Text fontSize="2xs" color="fg.muted">{connType.note}</Text>
                  )}
                </VStack>
              </VStack>
            </Box>
          ))}
        </SimpleGrid>
      </VStack>
    </Box>
  );
}
