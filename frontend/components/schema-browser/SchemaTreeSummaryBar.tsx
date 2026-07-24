'use client';

import { HStack, Icon, IconButton, Text } from '@chakra-ui/react';
import { Tooltip } from '@/components/kit/tooltip';
import { LuDatabase, LuRefreshCw, LuTable } from 'react-icons/lu';

export interface SchemaTreeStats {
  totalSchemas: number;
  totalTables: number;
  whitelistedSchemas: number;
  whitelistedTables: number;
}

interface SchemaTreeSummaryBarProps {
  onRetry?: () => void;
  connectionName?: string;
  stats: SchemaTreeStats | null;
}

/** Refresh-schema row + selection stats strip shown above the tree view. */
export default function SchemaTreeSummaryBar({ onRetry, connectionName, stats }: SchemaTreeSummaryBarProps) {
  return (
    <>
      {/* Refresh Button */}
      {onRetry && (
        <HStack
          px={3}
          py={1.5}
          borderBottom="1px solid"
          borderColor="border.default"
          bg="bg.muted"
          justify="space-between"
        >
          <Text fontSize="xs" color="fg.subtle" fontFamily="mono">
            {connectionName ? `${connectionName} schema` : 'Database schema'}
          </Text>
          <Tooltip content="Fetch latest schema from database">
            <IconButton
              aria-label="Refresh schema"
              size="2xs"
              variant="ghost"
              onClick={onRetry}
              color="fg.subtle"
              _hover={{ color: 'accent.teal' }}
            >
              <LuRefreshCw size={12} />
            </IconButton>
          </Tooltip>
        </HStack>
      )}

      {/* Stats Summary — compact inline bar */}
      {stats && (
        <HStack
          px={3}
          py={2}
          gap={3}
          fontFamily="mono"
          fontSize="xs"
          borderBottom="1px solid"
          borderColor="border.default"
          bg="bg.muted"
        >
          <HStack gap={1}>
            <Icon as={LuDatabase} boxSize={3} color="accent.secondary" />
            <Text fontWeight="700" color="fg.default">
              {stats.whitelistedSchemas}/{stats.totalSchemas}
            </Text>
            <Text color="fg.subtle">schemas</Text>
          </HStack>
          <Text color="fg.subtle">·</Text>
          <HStack gap={1}>
            <Icon as={LuTable} boxSize={3} color="accent.teal" />
            <Text fontWeight="700" color="fg.default">
              {stats.whitelistedTables}/{stats.totalTables}
            </Text>
            <Text color="fg.subtle">tables</Text>
          </HStack>
        </HStack>
      )}
    </>
  );
}
