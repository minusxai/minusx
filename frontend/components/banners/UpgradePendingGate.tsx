'use client';

import { useState } from 'react';
import { Box, Button, Heading, Text, VStack, Code } from '@chakra-ui/react';

/**
 * Shown instead of the app when this build cannot read the workspace's data.
 *
 * Migrations do not run at boot — a build declares the range of data versions it can
 * read, and refuses anything outside it rather than misreading it. That refusal is what
 * lands here, and it is a dead end without a way out: every API call returns 503, so a
 * banner over a broken app would be decoration. The way out is one explicit action, which
 * is also the only migration path — the same endpoint whatever the deployment.
 *
 * `build-too-old` gets no button on purpose. It means the data is NEWER than this build
 * writes, i.e. a rollback, and migrating cannot help: the fix is to deploy the newer
 * build again. Offering the button there would invite someone to rewrite v39 rows with
 * v38 shapes.
 */
export function UpgradePendingGate({
  message,
  reason,
}: {
  message: string;
  reason: 'upgrade-pending' | 'build-too-old';
}) {
  const [state, setState] = useState<'idle' | 'running' | 'failed'>('idle');
  const [detail, setDetail] = useState<string>('');

  async function migrate() {
    setState('running');
    setDetail('');
    try {
      const res = await fetch('/api/admin/migrate-db', { method: 'POST' });
      const body = await res.json().catch(() => null);
      if (!res.ok || body?.success === false) {
        // Surfaced rather than swallowed: a failed migration leaves the workspace exactly
        // where it was (atomicImport is all-or-nothing), so the useful thing is the reason.
        setState('failed');
        setDetail([body?.error, ...(body?.errors ?? [])].filter(Boolean).join('; ') || `HTTP ${res.status}`);
        return;
      }
      // The gate is evaluated per request, so a reload is enough to re-check.
      window.location.reload();
    } catch (e) {
      setState('failed');
      setDetail(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <Box display="flex" alignItems="center" justifyContent="center" minH="100vh" p={6}>
      <VStack gap={4} maxW="lg" textAlign="center">
        <Heading size="md">
          {reason === 'build-too-old' ? 'This deployment is older than your data' : 'Your data needs migrating'}
        </Heading>
        <Text color="fg.muted">{message}</Text>

        {reason === 'upgrade-pending' ? (
          <>
            <Button
              aria-label="Migrate data now"
              onClick={migrate}
              loading={state === 'running'}
              loadingText="Migrating…"
            >
              Migrate now
            </Button>
            <Text fontSize="xs" color="fg.muted">
              Admins only. Your files and users are exported, migrated and re-imported in
              one step — nothing is changed unless the whole migration succeeds.
            </Text>
          </>
        ) : (
          <Text fontSize="sm" color="fg.muted">
            Deploy the newer build again. Migrating cannot help here — it would write older
            shapes over newer data.
          </Text>
        )}

        {state === 'failed' && (
          <Box w="full" textAlign="left">
            <Text fontSize="sm" color="fg.error" mb={1}>Migration did not run:</Text>
            <Code display="block" whiteSpace="pre-wrap" p={2} fontSize="xs">{detail}</Code>
          </Box>
        )}
      </VStack>
    </Box>
  );
}
