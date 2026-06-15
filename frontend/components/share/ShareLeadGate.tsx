'use client';

import { useState } from 'react';
import { Box, Button, Input, Text, VStack } from '@chakra-ui/react';
import { LuMessageCircle } from 'react-icons/lu';

interface ShareLeadGateProps {
  /** Submit captured name/email; resolves once the guest session is upgraded to chat. */
  onSubmit: (name: string, email: string) => Promise<void>;
}

/**
 * Soft lead-capture gate shown over the chat panel until the visitor identifies
 * themselves (or the link carries ?skip_lead). Not a security boundary — chat cost
 * is capped server-side by the rate limiter + kill-switch regardless.
 */
export default function ShareLeadGate({ onSubmit }: ShareLeadGateProps) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  const canSubmit = name.trim().length > 0 && emailValid && !submitting;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(name.trim(), email.trim());
    } catch {
      setError('Something went wrong. Please try again.');
      setSubmitting(false);
    }
  };

  return (
    <Box
      aria-label="Chat sign-in"
      h="100%"
      display="flex"
      flexDirection="column"
      alignItems="center"
      justifyContent="center"
      px={6}
    >
      <VStack gap={4} maxW="320px" w="100%">
        <Box color="accent.primary"><LuMessageCircle size={32} /></Box>
        <VStack gap={1} textAlign="center">
          <Text fontSize="md" fontWeight={700} color="fg.default">Ask about this data</Text>
          <Text fontSize="sm" color="fg.muted">Enter your details to chat with the data.</Text>
        </VStack>
        <Input
          aria-label="Your name"
          placeholder="Your name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          size="sm"
        />
        <Input
          aria-label="Your email"
          placeholder="you@company.com"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit(); }}
          size="sm"
        />
        {error && <Text fontSize="xs" color="accent.danger">{error}</Text>}
        <Button
          aria-label="Start chatting"
          onClick={handleSubmit}
          disabled={!canSubmit}
          loading={submitting}
          colorPalette="blue"
          size="sm"
          w="100%"
        >
          Start chatting
        </Button>
      </VStack>
    </Box>
  );
}
