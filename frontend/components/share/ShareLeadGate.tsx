'use client';

import { useState } from 'react';
import { Box, Button, Input, Text, VStack } from '@chakra-ui/react';
import { useAppSelector } from '@/store/hooks';
import { useConfigs } from '@/lib/hooks/useConfigs';
import {
  ExploreBrandHeader,
  SuggestedQuestionsList,
  DEFAULT_SUGGESTED_PROMPTS,
  toSuggestedPrompts,
} from '@/components/explore/message/ExploreWelcome';

interface ShareLeadGateProps {
  /** Submit captured name/email; resolves once the guest session is upgraded to chat. */
  onSubmit: (name: string, email: string) => Promise<void>;
  /** Story-specific questions shown as locked teasers (falls back to generic defaults). */
  suggestedPrompts?: string[];
}

/**
 * Soft lead-capture gate shown over the chat panel until the visitor identifies
 * themselves (or the link carries ?skip_lead). Not a security boundary — chat cost
 * is capped server-side by the rate limiter + kill-switch regardless.
 *
 * Mirrors the MinusX Explore empty-state (shared branding + question cards) so the
 * gate reads as one continuous experience with the chat it unlocks.
 */
export default function ShareLeadGate({ onSubmit, suggestedPrompts }: ShareLeadGateProps) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const colorMode = useAppSelector((state) => state.ui.colorMode);
  const { config } = useConfigs();
  const agentName = config.branding.agentName;

  const prompts = suggestedPrompts && suggestedPrompts.length > 0
    ? toSuggestedPrompts(suggestedPrompts)
    : DEFAULT_SUGGESTED_PROMPTS;

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
    <Box aria-label="Chat sign-in" h="100%" display="flex" flexDirection="column">
      {/* Branding + teaser questions — scrolls if the panel is short. */}
      <Box flex="1" overflowY="auto" px={5} pt={8} pb={4} minH={0}>
        <VStack gap={7} align="stretch" maxW="360px" mx="auto" w="100%">
          <ExploreBrandHeader
            agentName={agentName}
            colorMode={colorMode}
            compact
            subtitle="Sign in below to chat with this data."
          />
          <SuggestedQuestionsList prompts={prompts} locked label="Try asking" />
        </VStack>
      </Box>

      {/* Sign-in form — pinned at the bottom, where the chat input lives once unlocked. */}
      <Box
        flexShrink={0}
        px={5}
        pt={4}
        pb={5}
        borderTop="1px solid"
        borderColor="border.default"
        bg="bg.surface"
      >
        <VStack gap={2.5} align="stretch" maxW="360px" mx="auto" w="100%">
          <Input
            aria-label="Your name"
            placeholder="Your name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            fontFamily="mono"
            size="sm"
          />
          <Input
            aria-label="Your email"
            placeholder="you@company.com"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit(); }}
            fontFamily="mono"
            size="sm"
          />
          {error && <Text fontSize="xs" color="accent.danger" fontFamily="mono">{error}</Text>}
          <Button
            aria-label="Start chatting"
            onClick={handleSubmit}
            disabled={!canSubmit}
            loading={submitting}
            bg="accent.teal"
            color="white"
            fontFamily="mono"
            _hover={{ bg: 'accent.teal', opacity: 0.9 }}
            size="sm"
            w="100%"
          >
            Start chatting
          </Button>
        </VStack>
      </Box>
    </Box>
  );
}
