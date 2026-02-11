'use client';

import { Box, Button, VStack, Heading, Text } from '@chakra-ui/react';
import { useState } from 'react';

/**
 * Test page to manually trigger different types of errors
 * Use this to verify error boundaries and toast notifications work correctly
 *
 * Access at: http://localhost:3000/test-errors
 */
export default function TestErrorsPage() {
  const [, setError] = useState(false);

  const throwRenderError = () => {
    setError(() => {
      throw new Error('Test: Render error in component');
    });
  };

  const throwEventHandlerError = () => {
    throw new Error('Test: Error in event handler');
  };

  const throwAsyncError = () => {
    setTimeout(() => {
      throw new Error('Test: Async error (setTimeout)');
    }, 100);
  };

  const throwPromiseRejection = () => {
    Promise.reject('Test: Unhandled promise rejection');
  };

  return (
    <Box p={8} maxW="800px" mx="auto">
      <VStack gap={6} align="stretch">
        <Box>
          <Heading size="xl" mb={2}>
            Error Handler Test Page
          </Heading>
          <Text color="accent.muted">
            Use these buttons to test different error scenarios. Check the console for error logs.
          </Text>
        </Box>

        <VStack gap={3} align="stretch">
          <Box>
            <Heading size="md" mb={2}>
              React Error Boundary Tests
            </Heading>
            <VStack gap={2} align="stretch">
              <Button
                colorScheme="red"
                onClick={throwRenderError}
              >
                Throw Render Error
              </Button>
              <Text fontSize="sm" color="accent.muted">
                Should trigger error.tsx boundary → Show toast → Attempt recovery
              </Text>
            </VStack>
          </Box>

          <Box>
            <Heading size="md" mb={2}>
              Global Error Handler Tests
            </Heading>
            <VStack gap={2} align="stretch">
              <Button
                colorScheme="orange"
                onClick={throwEventHandlerError}
              >
                Throw Event Handler Error
              </Button>
              <Text fontSize="sm" color="accent.muted">
                Should trigger GlobalErrorHandler → Show toast
              </Text>

              <Button
                colorScheme="orange"
                onClick={throwAsyncError}
              >
                Throw Async Error (setTimeout)
              </Button>
              <Text fontSize="sm" color="accent.muted">
                Should trigger window.error listener → Show toast
              </Text>

              <Button
                colorScheme="orange"
                onClick={throwPromiseRejection}
              >
                Throw Promise Rejection
              </Button>
              <Text fontSize="sm" color="accent.muted">
                Should trigger window.unhandledrejection listener → Show toast
              </Text>
            </VStack>
          </Box>

          <Box bg="blue.50" p={4} borderRadius="md">
            <Heading size="sm" mb={2}>
              Expected Behavior
            </Heading>
            <VStack align="start" gap={1} fontSize="sm">
              <Text>✅ Toasts shown ONLY to admin users</Text>
              <Text>✅ Regular users see no toasts (silent error handling)</Text>
              <Text>✅ Toasts auto-dismiss after 5 seconds</Text>
              <Text>✅ Errors logged to console (all users)</Text>
              <Text>✅ Redux state preserved</Text>
              <Text>✅ Page recovers automatically (except render errors)</Text>
              <Text>✅ No white error screen in production</Text>
            </VStack>
          </Box>
        </VStack>
      </VStack>
    </Box>
  );
}
