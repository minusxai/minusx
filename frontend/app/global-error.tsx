'use client';

import { useEffect } from 'react';
import { Box, Button, Text, VStack, ChakraProvider } from '@chakra-ui/react';
import { system } from '@/lib/ui/theme';

export default function GlobalError({
  error,
  reset: _reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log error to console for debugging
    console.error('Global error:', error);
  }, [error]);

  return (
    <html>
      <body>
        <ChakraProvider value={system}>
          <Box
            display="flex"
            alignItems="center"
            justifyContent="center"
            minH="100vh"
            p={8}
            bg="gray.50"
          >
            <VStack gap={6} textAlign="center" maxW="md">
              <Text fontSize="4xl" fontWeight="bold">
                Something went wrong
              </Text>
              <Text color="accent.muted" fontSize="lg">
                An unexpected error occurred. Please try refreshing the page or return home.
              </Text>
              <VStack gap={3} w="full">
                <Button
                  size="lg"
                  colorScheme="blue"
                  w="full"
                  onClick={() => window.location.href = '/'}
                >
                  Return Home
                </Button>
                <Button
                  size="lg"
                  variant="outline"
                  w="full"
                  onClick={() => window.location.reload()}
                >
                  Refresh Page
                </Button>
              </VStack>
            </VStack>
          </Box>
        </ChakraProvider>
      </body>
    </html>
  );
}
