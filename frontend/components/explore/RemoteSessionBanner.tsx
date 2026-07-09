'use client';

import { Box, HStack, Text, Button, Icon } from '@chakra-ui/react';
import { LuUnplug, LuCircleStop } from 'react-icons/lu';

interface RemoteSessionBannerProps {
  expiresAt?: string;
  onStop: () => void;
}

/**
 * Shown in place of the chat input affordances while a Remote Agent Session is active: an external
 * agent (e.g. Claude Code) is driving this conversation over HTTP; the input is hard-frozen until
 * the user stops the session (or it expires).
 */
export default function RemoteSessionBanner({ expiresAt, onStop }: RemoteSessionBannerProps) {
  const expiry = expiresAt ? new Date(expiresAt) : null;
  const expiryLabel = expiry && !Number.isNaN(expiry.getTime())
    ? expiry.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : null;

  return (
    <HStack
      aria-label="Remote session banner"
      justify="space-between"
      py={2}
      px={4}
      gap={3}
      borderTop="1px solid"
      borderColor="border.muted"
      fontFamily="mono"
      bg="bg.subtle"
    >
      <HStack gap={2} minW={0}>
        <Icon as={LuUnplug} boxSize={4} color="accent.teal" flexShrink={0} />
        <Box minW={0}>
          <Text fontSize="xs" truncate>
            <Text as="span" fontWeight="semibold">Remote agent connected.</Text>{' '}
            <Text as="span" color="fg.muted">
              An external agent is operating this chat{expiryLabel ? ` · expires ${expiryLabel}` : ''}
            </Text>
          </Text>
        </Box>
      </HStack>
      <Button
        aria-label="Stop remote session"
        onClick={onStop}
        size="xs"
        variant="outline"
        borderColor="accent.danger"
        color="accent.danger"
        fontFamily="mono"
        _hover={{ bg: 'accent.danger', color: 'white' }}
        flexShrink={0}
      >
        <Icon as={LuCircleStop} boxSize={4} mr={1} />
        Stop
      </Button>
    </HStack>
  );
}
