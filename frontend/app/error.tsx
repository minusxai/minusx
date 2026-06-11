'use client';

import { useEffect, useState } from 'react';
import { showAdminToast } from '@/lib/utils/toast-helpers';
import { isHydrationError } from '@/lib/utils/error-utils';
import { captureError } from '@/lib/messaging/capture-error';
import { decideRecoveryAction, hardReload } from '@/lib/utils/error-recovery';
import { getStore } from '@/store/store';
import { selectDevMode } from '@/store/uiSlice';
import { Box, Button, Text, VStack } from '@chakra-ui/react';
import { IS_DEV, IS_TEST, SEND_ERRORS_IN_DEV } from '@/lib/constants';
import * as Sentry from '@sentry/nextjs';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const isDev = IS_DEV;
  // Set when auto-recovery is exhausted: a deterministic error survived the
  // capped resets and the guarded reload, so we render a manual fallback.
  const [exhausted, setExhausted] = useState(false);

  useEffect(() => {
    // Log error to console for debugging
    console.error('Page error:', error);

    // Report to bug reporting channel (skip hydration noise; skip dev unless DEBUG flag is on)
    if ((!IS_DEV || IS_TEST || SEND_ERRORS_IN_DEV) && !isHydrationError(error.message)) {
      void captureError('page-error', error);
      // Also report to Sentry: this nested error boundary catches the error and
      // renders a fallback, so it never propagates to global-error.tsx (the only
      // other place that calls Sentry.captureException).
      Sentry.captureException(error);
    }

    // Suppress hydration errors unless admin has opted into seeing all error toasts
    const showAll = selectDevMode(getStore().getState());
    if (!showAll && isHydrationError(error.message)) return;

    // Show toast notification (only to admins)
    showAdminToast({
      title: 'An error occurred',
      description: isDev
        ? 'Check the console for details.'
        : 'Something went wrong. The page will attempt to recover.',
      type: 'error',
      duration: 5000,
    });

    // Attempt automatic recovery ONLY in production. A deterministic render
    // error remounts this boundary on every reset(), so an unconditional
    // reset() loops forever (and a stale tab never picks up a fixed build) —
    // decideRecoveryAction caps the resets, then tries one guarded hard
    // reload, then gives up to the manual fallback below.
    if (!isDev) {
      const action = decideRecoveryAction(error.message);
      if (action === 'reset') {
        reset();
      } else if (action === 'reload') {
        hardReload();
      } else {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setExhausted(true);
      }
    }
  }, [error, reset, isDev]);

  // In dev mode, show the error details
  if (isDev) {
    return (
      <Box p={8} bg="accent.danger" _dark={{ bg: 'accent.danger/20' }} borderRadius="md" m={4}>
        <VStack align="stretch" gap={4}>
          <Text fontSize="2xl" fontWeight="bold" color="accent.danger" _dark={{ color: 'accent.danger' }}>
            Error in Development Mode
          </Text>
          <Text fontSize="md" fontWeight="semibold" color="accent.danger" _dark={{ color: 'accent.danger' }}>
            {error.message}
          </Text>
          <Box
            as="pre"
            p={4}
            bg="accent.muted"
            color="accent.danger"
            borderRadius="md"
            overflow="auto"
            fontSize="sm"
            fontFamily="mono"
          >
            {error.stack}
          </Box>
          <Button onClick={() => reset()} colorScheme="red">
            Try to Recover
          </Button>
        </VStack>
      </Box>
    );
  }

  // In production, render nothing while auto-recovery is in flight — once it
  // is exhausted, show a manual fallback instead of looping.
  if (!exhausted) return null;

  return (
    <Box display="flex" alignItems="center" justifyContent="center" minH="50vh" p={8}>
      <VStack gap={4} textAlign="center" maxW="md">
        <Text fontSize="2xl" fontWeight="bold">
          Something went wrong
        </Text>
        <Text color="fg.muted">
          This page keeps running into an error and could not recover automatically.
        </Text>
        <Button aria-label="Reload page" onClick={() => hardReload()}>
          Reload page
        </Button>
      </VStack>
    </Box>
  );
}
