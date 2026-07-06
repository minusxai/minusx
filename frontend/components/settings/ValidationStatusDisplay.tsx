'use client';

import { Box, Flex, Text, Icon, VStack } from '@chakra-ui/react';
import { LuChevronDown, LuChevronRight } from 'react-icons/lu';
import type { ValidationStatus } from './DataManagementSection';

type ExpandedErrorsKey = 'export' | 'validate' | 'import' | 'migrate' | null;

interface ValidationStatusDisplayProps {
  status: ValidationStatus | null;
  type: 'export' | 'validate' | 'import';
  expandedErrors: ExpandedErrorsKey;
  setExpandedErrors: (value: ExpandedErrorsKey) => void;
}

export default function ValidationStatusDisplay({
  status,
  type,
  expandedErrors,
  setExpandedErrors,
}: ValidationStatusDisplayProps) {
  if (!status) return null;

  return (
    <Box mt={2}>
      <Flex
        align="center"
        gap={2}
        cursor={status.errors.length > 0 ? 'pointer' : 'default'}
        onClick={() => status.errors.length > 0 && setExpandedErrors(expandedErrors === type ? null : type)}
      >
        <Text fontSize="xs" color={status.valid ? 'accent.teal' : 'accent.danger'} fontFamily="mono">
          {status.valid
            ? (status.warnings.length > 0 ? status.warnings[0] : '✓ Valid')
            : `✗ ${status.errors.length} error${status.errors.length > 1 ? 's' : ''}`}
        </Text>
        {status.errors.length > 0 && (
          <Icon fontSize="sm" color="fg.muted">
            {expandedErrors === type ? <LuChevronDown /> : <LuChevronRight />}
          </Icon>
        )}
      </Flex>

      {status.errors.length > 0 && expandedErrors === type && (
        <Box mt={2} p={2} bg="accent.danger/10" borderRadius="md" borderWidth="1px" borderColor="accent.danger/30">
          <VStack align="stretch" gap={1}>
            {status.errors.map((error, idx) => (
              <Text key={idx} fontSize="xs" color="accent.danger" fontFamily="mono">
                • {error}
              </Text>
            ))}
          </VStack>
        </Box>
      )}
    </Box>
  );
}
