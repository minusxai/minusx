'use client';

import { useEffect } from 'react';
import { showAdminToast } from '@/lib/utils/toast-helpers';
import { isHydrationError } from '@/lib/utils/error-utils';
import { captureError } from '@/lib/messaging/capture-error';
import { getStore } from '@/store/store';
import { selectDevMode } from '@/store/uiSlice';
import { Box, Button, Text, VStack } from '@chakra-ui/react';
import { IS_DEV, IS_TEST, SEND_ERRORS_IN_DEV } from '@/lib/constants';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const isDev = IS_DEV;

  useEffect(() => {
    // Log error to console for debugging
    console.error('Page error:', error);

    // Report to bug reporting channel (skip hydration noise; skip dev unless DEBUG flag is on)
    if ((!IS_DEV || IS_TEST || SEND_ERRORS_IN_DEV) && !isHydrationError(error.message)) {
      void captureError('page-error', error);
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

    // Attempt automatic recovery ONLY in production
    if (!isDev) {
      reset();
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

  // In production, return null - the toast is shown and the component will reset
  return null;
}
