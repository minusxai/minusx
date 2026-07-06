'use client';

import { Box, Flex, Text, Icon, VStack } from '@chakra-ui/react';
import { LuChevronDown, LuChevronRight } from 'react-icons/lu';
import type { MigrationResult } from './DataManagementSection';

type ExpandedErrorsKey = 'export' | 'validate' | 'import' | 'migrate' | null;

interface MigrationStatusDisplayProps {
  result: MigrationResult | null;
  expandedErrors: ExpandedErrorsKey;
  setExpandedErrors: (value: ExpandedErrorsKey) => void;
}

export default function MigrationStatusDisplay({
  result,
  expandedErrors,
  setExpandedErrors,
}: MigrationStatusDisplayProps) {
  if (!result) return null;

  return (
    <Box mt={2}>
      <Flex
        align="center"
        gap={2}
        cursor={result.errors && result.errors.length > 0 ? 'pointer' : 'default'}
        onClick={() => result.errors && result.errors.length > 0 && setExpandedErrors(expandedErrors === 'migrate' ? null : 'migrate')}
      >
        <Text fontSize="xs" color={result.success ? 'accent.teal' : 'accent.danger'} fontFamily="mono">
          {result.success
            ? (result.migrations.length > 0
                ? `✓ ${result.migrations.length} migration${result.migrations.length > 1 ? 's' : ''} applied`
                : result.message || '✓ Database is up to date')
            : `✗ ${result.errors?.length || 0} error${(result.errors?.length || 0) > 1 ? 's' : ''}`}
        </Text>
        {result.errors && result.errors.length > 0 && (
          <Icon fontSize="sm" color="fg.muted">
            {expandedErrors === 'migrate' ? <LuChevronDown /> : <LuChevronRight />}
          </Icon>
        )}
      </Flex>

      {/* Show applied migrations */}
      {result.success && result.migrations.length > 0 && (
        <Box mt={2} p={2} bg="accent.teal/10" borderRadius="md" borderWidth="1px" borderColor="accent.teal/30">
          <VStack align="stretch" gap={1}>
            {result.migrations.map((migration, idx) => (
              <Text key={idx} fontSize="xs" color="accent.teal" fontFamily="mono">
                ✓ {migration}
              </Text>
            ))}
          </VStack>
        </Box>
      )}

      {/* Show errors */}
      {result.errors && result.errors.length > 0 && expandedErrors === 'migrate' && (
        <Box mt={2} p={2} bg="accent.danger/10" borderRadius="md" borderWidth="1px" borderColor="accent.danger/30">
          <VStack align="stretch" gap={1}>
            {result.errors.map((error, idx) => (
              <Text key={idx} fontSize="xs" color="accent.danger" fontFamily="mono">
                • {error}
              </Text>
            ))}
          </VStack>
        </Box>
      )}

      {/* Show validation results if present */}
      {result.validation && result.validation.errors.length > 0 && (
        <Box mt={2} p={2} bg="orange.50" borderRadius="md" borderWidth="1px" borderColor="orange.200">
          <Text fontSize="xs" fontWeight="medium" color="orange.900" fontFamily="mono" mb={1}>
            Validation Issues:
          </Text>
          <VStack align="stretch" gap={1}>
            {result.validation.errors.map((error, idx) => (
              <Text key={idx} fontSize="xs" color="orange.900" fontFamily="mono">
                • {error}
              </Text>
            ))}
          </VStack>
        </Box>
      )}
    </Box>
  );
}
