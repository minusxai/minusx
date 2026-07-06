'use client';

import { useState } from 'react';
import { Box, Flex, Text, Button, Input, Icon } from '@chakra-ui/react';
import { LuLoader } from 'react-icons/lu';

export default function ClearLlmLogsSection() {
  const [isClearingLogs, setIsClearingLogs] = useState(false);
  const [clearLogsBefore, setClearLogsBefore] = useState('');
  const [clearLogsStatus, setClearLogsStatus] = useState<{ success: boolean; message: string } | null>(null);

  const handleClearLogs = async (scope: 'all' | 'before') => {
    if (scope === 'before' && !clearLogsBefore) return;
    setIsClearingLogs(true);
    setClearLogsStatus(null);
    try {
      const qs = scope === 'before'
        ? `?before=${encodeURIComponent(new Date(clearLogsBefore).toISOString())}`
        : '';
      const res = await fetch(`/api/llm-logs${qs}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setClearLogsStatus({ success: true, message: `Cleared ${data.removed ?? 0} log(s)` });
      } else {
        setClearLogsStatus({ success: false, message: data?.error?.message || 'Failed to clear logs' });
      }
    } catch {
      setClearLogsStatus({ success: false, message: 'Failed to clear logs' });
    } finally {
      setIsClearingLogs(false);
    }
  };

  return (
    <Box py={4} px={4}>
      <Text fontSize="sm" fontWeight="medium" fontFamily="mono" mb={1}>
        LLM Debug Logs
      </Text>
      <Text fontSize="xs" color="fg.muted" fontFamily="mono" mb={2}>
        Clear stored raw request/response logs used by the chat debug view. Usage stats are kept.
      </Text>
      <Flex gap={2} align="center" wrap="wrap">
        <Input
          type="date"
          size="sm"
          maxW="180px"
          fontFamily="mono"
          aria-label="Clear LLM logs before date"
          value={clearLogsBefore}
          onChange={(e) => setClearLogsBefore(e.target.value)}
        />
        <Button
          size="sm"
          variant="outline"
          fontFamily="mono"
          aria-label="Clear LLM logs before date"
          disabled={isClearingLogs || !clearLogsBefore}
          onClick={() => handleClearLogs('before')}
        >
          Clear before date
        </Button>
        <Button
          size="sm"
          colorPalette="red"
          variant="outline"
          fontFamily="mono"
          aria-label="Clear all LLM logs"
          disabled={isClearingLogs}
          onClick={() => handleClearLogs('all')}
        >
          {isClearingLogs ? (
            <>
              <Icon fontSize="md" mr={1}><LuLoader className="animate-spin" /></Icon>
              Clearing...
            </>
          ) : 'Clear all logs'}
        </Button>
      </Flex>
      {clearLogsStatus && (
        <Text mt={2} fontSize="xs" color={clearLogsStatus.success ? 'accent.teal' : 'accent.danger'} fontFamily="mono">
          {clearLogsStatus.success ? `✓ ${clearLogsStatus.message}` : `✗ ${clearLogsStatus.message}`}
        </Text>
      )}
    </Box>
  );
}
