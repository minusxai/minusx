'use client';

import { useEffect } from 'react';
import { showAdminToast } from '@/lib/utils/toast-helpers';
import { Box, Button, Text, VStack } from '@chakra-ui/react';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const isDev = process.env.NODE_ENV === 'development';

  useEffect(() => {
    // Log error to console for debugging
    console.error('Page error:', error);

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
