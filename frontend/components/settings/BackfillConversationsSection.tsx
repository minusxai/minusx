'use client';

import { useState } from 'react';
import { Box, Flex, Text, Button, Icon } from '@chakra-ui/react';
import { LuLoader } from 'react-icons/lu';

export default function BackfillConversationsSection() {
  const [isBackfilling, setIsBackfilling] = useState(false);
  const [backfillReport, setBackfillReport] = useState<{ found: number; migrated: number; skipped: number; emptyLog: number; failed: number; dry: boolean } | null>(null);
  const [backfillError, setBackfillError] = useState<string | null>(null);

  // One-time backfill of pre-v3 conversation files into the v3 tables (admin-only API).
  const handleBackfillV3 = async (dry: boolean) => {
    setIsBackfilling(true);
    setBackfillReport(null);
    setBackfillError(null);
    try {
      const res = await fetch(`/api/admin/migrate-conversations-v3${dry ? '?dry=1' : ''}`, { method: 'POST' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setBackfillError(json?.error?.message || `Backfill failed (HTTP ${res.status})`);
        return;
      }
      setBackfillReport(json.data ?? json);
    } catch {
      setBackfillError('Failed to run backfill');
    } finally {
      setIsBackfilling(false);
    }
  };

  return (
    <Box py={4} px={4}>
      <Flex justify="space-between" align="center" mb={backfillReport || backfillError ? 2 : 0}>
        <Text fontSize="sm" fontWeight="medium" fontFamily="mono">
          Backfill Conversations to v3
        </Text>
        <Flex gap={2}>
          <Button
            size="sm"
            variant="outline"
            fontFamily="mono"
            aria-label="Dry-run conversation backfill"
            onClick={() => handleBackfillV3(true)}
            disabled={isBackfilling}
          >
            {isBackfilling ? (
              <><Icon fontSize="md" mr={1}><LuLoader className="animate-spin" /></Icon>Working...</>
            ) : 'Dry run'}
          </Button>
          <Button
            size="sm"
            bg="accent.teal"
            color="white"
            fontFamily="mono"
            aria-label="Run conversation backfill"
            onClick={() => handleBackfillV3(false)}
            disabled={isBackfilling}
          >
            Run backfill
          </Button>
        </Flex>
      </Flex>
      <Text fontSize="xs" color="fg.muted" fontFamily="mono" mb={backfillReport || backfillError ? 2 : 0}>
        One-time: port pre-v3 conversation files into the v3 tables so old chats appear in history. Idempotent and non-destructive (source files are untouched) — safe to re-run. Dry run reports counts without writing.
      </Text>
      {backfillError && (
        <Text fontSize="xs" color="accent.danger" fontFamily="mono">✗ {backfillError}</Text>
      )}
      {backfillReport && (
        <Box mt={2} p={2} bg="bg.muted" borderRadius="md" borderWidth="1px" borderColor="border">
          <Text fontSize="xs" fontFamily="mono" color={backfillReport.failed > 0 ? 'accent.danger' : 'accent.teal'}>
            {backfillReport.dry ? 'Dry run · ' : '✓ '}
            found {backfillReport.found} · migrated {backfillReport.migrated} · skipped {backfillReport.skipped} · empty {backfillReport.emptyLog} · failed {backfillReport.failed}
          </Text>
        </Box>
      )}
    </Box>
  );
}
