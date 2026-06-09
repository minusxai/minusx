'use client';

import { useEffect } from 'react';
import { Box, Button, Text, VStack } from '@chakra-ui/react';
import { captureError } from '@/lib/messaging/capture-error';
import { isHydrationError } from '@/lib/utils/error-utils';
import { IS_DEV, IS_TEST, SEND_ERRORS_IN_DEV } from '@/lib/constants';
import * as Sentry from '@sentry/nextjs';

/**
 * Route-scoped error boundary for /f/[id]. Renders inline in place of the
 * page so the rest of the app shell (header, sidebar) stays usable.
 *
 * Unlike the global app/error.tsx, this does NOT auto-call reset() — a
 * persistent error in Redux state would otherwise loop forever (boundary
 * catches → reset → re-renders → throws again → boundary catches → …).
 * The user clicks Retry when they're ready.
 */
export default function FileError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('File page error:', error);
    if ((!IS_DEV || IS_TEST || SEND_ERRORS_IN_DEV) && !isHydrationError(error.message)) {
      void captureError('file-page-error', error);
      // Also report to Sentry: this nested boundary catches the error and renders
      // a fallback, so it never reaches global-error.tsx (the only other place
      // that calls Sentry.captureException).
      Sentry.captureException(error);
    }
  }, [error]);

  return (
    <Box p={8} m={4} borderRadius="md" borderWidth={1} borderColor="border.subtle">
      <VStack align="stretch" gap={3}>
        <Text fontSize="lg" fontWeight="semibold">An error occurred</Text>
        <Text color="fg.muted">
          We couldn&apos;t render this page. Try reloading; if it keeps happening, refresh the browser.
        </Text>
        {IS_DEV && (
          <Box as="pre" p={3} bg="bg.subtle" borderRadius="sm" overflow="auto" fontSize="xs" fontFamily="mono">
            {error.message}
            {error.stack ? `\n\n${error.stack}` : ''}
          </Box>
        )}
        <Box>
          <Button onClick={() => reset()} size="sm">Retry</Button>
        </Box>
      </VStack>
    </Box>
  );
}
