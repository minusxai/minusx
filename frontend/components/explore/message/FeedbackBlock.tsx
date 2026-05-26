'use client';

import { useState } from 'react';
import { Box, HStack, IconButton, Textarea, Button, Text, Dialog, VStack } from '@chakra-ui/react';
import { LuThumbsUp, LuThumbsDown, LuCheck } from 'react-icons/lu';

interface FeedbackBlockProps {
  conversationID: number;
  userMessageLogIndex: number;
  markdownContext?: 'sidebar' | 'mainpage';
}

const POSITIVE_TAGS = [
  'Accurate',
  'Well explained',
  'Correct SQL',
  'Right visualization',
  'Fast',
  'Followed instructions',
] as const;

const NEGATIVE_TAGS = [
  'Inaccurate',
  'SQL too complex',
  'Slow',
  'Ignored context',
  'Wrong visualization',
  'Hallucinated data',
] as const;

type FeedbackState = 'idle' | 'submitted';

export default function FeedbackBlock({ conversationID, userMessageLogIndex, markdownContext = 'mainpage' }: FeedbackBlockProps) {
  const [state, setState] = useState<FeedbackState>('idle');
  const [submittedRating, setSubmittedRating] = useState<'positive' | 'negative' | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalRating, setModalRating] = useState<'positive' | 'negative'>('positive');
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());
  const [comment, setComment] = useState('');

  const sendFeedback = (rating: 'positive' | 'negative', tags: string[], feedbackComment?: string) => {
    fetch('/api/chat/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        conversationId: conversationID,
        userMessageLogIndex,
        rating,
        tags,
        ...(feedbackComment ? { comment: feedbackComment } : {}),
      }),
    }).catch(() => { /* fire-and-forget */ });
  };

  const openModal = (rating: 'positive' | 'negative') => {
    if (state === 'submitted') return;
    setModalRating(rating);
    setSelectedTags(new Set());
    setComment('');
    setModalOpen(true);
  };

  const toggleTag = (tag: string) => {
    setSelectedTags(prev => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });
  };

  const handleSubmit = () => {
    sendFeedback(modalRating, Array.from(selectedTags), comment || undefined);
    setSubmittedRating(modalRating);
    setState('submitted');
    setModalOpen(false);
  };

  const handleDismiss = () => {
    sendFeedback(modalRating, [], undefined);
    setSubmittedRating(modalRating);
    setState('submitted');
    setModalOpen(false);
  };

  const isSmall = markdownContext === 'sidebar';
  const tags = modalRating === 'positive' ? POSITIVE_TAGS : NEGATIVE_TAGS;
  const accentColor = modalRating === 'positive' ? 'accent.teal' : 'accent.danger';

  return (
    <Box mt={isSmall ? '3' : '4'}>
      {/* Thin divider */}
      <Box h="1px" bg="border.default" mb={isSmall ? '2' : '2.5'} opacity={0.6} />

      {state === 'submitted' ? (
        /* ── Thank-you state ── */
        <HStack
          gap="1.5"
          css={{
            animation: 'feedbackFadeIn 0.3s ease-out',
            '@keyframes feedbackFadeIn': {
              from: { opacity: 0, transform: 'translateY(4px)' },
              to: { opacity: 1, transform: 'translateY(0)' },
            },
          }}
        >
          <Box
            display="flex"
            alignItems="center"
            justifyContent="center"
            w="16px"
            h="16px"
            borderRadius="full"
            bg={submittedRating === 'positive' ? 'accent.teal/12' : 'accent.danger/12'}
            color={submittedRating === 'positive' ? 'accent.teal' : 'accent.danger'}
          >
            <LuCheck size={10} strokeWidth={3} />
          </Box>
          <Text fontSize="2xs" color="fg.subtle" fontFamily="mono">
            Thanks for your feedback
          </Text>
        </HStack>
      ) : (
        /* ── Idle state ── */
        <HStack gap="1" alignItems="center">
          <IconButton
            aria-label="Thumbs up"
            size="2xs"
            variant="ghost"
            borderRadius="full"
            onClick={() => openModal('positive')}
            color="fg.subtle"
            css={{
              transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
              '&:hover': {
                color: 'var(--chakra-colors-accent-teal)',
                background: 'color-mix(in srgb, var(--chakra-colors-accent-teal) 8%, transparent)',
                transform: 'scale(1.15)',
              },
              '&:active': { transform: 'scale(0.92)' },
            }}
          >
            <LuThumbsUp size={isSmall ? 11 : 13} />
          </IconButton>

          <IconButton
            aria-label="Thumbs down"
            size="2xs"
            variant="ghost"
            borderRadius="full"
            onClick={() => openModal('negative')}
            color="fg.subtle"
            css={{
              transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
              '&:hover': {
                color: 'var(--chakra-colors-accent-danger)',
                background: 'color-mix(in srgb, var(--chakra-colors-accent-danger) 8%, transparent)',
                transform: 'scale(1.15)',
              },
              '&:active': { transform: 'scale(0.92)' },
            }}
          >
            <LuThumbsDown size={isSmall ? 11 : 13} />
          </IconButton>

          <Text
            fontSize="2xs"
            color="fg.subtle"
            fontFamily="mono"
            ml="0.5"
            opacity={0.7}
            letterSpacing="0.01em"
          >
            Feedback helps the agent adapt to you
          </Text>
        </HStack>
      )}

      {/* ── Feedback modal ── */}
      <Dialog.Root open={modalOpen} onOpenChange={(e) => { if (!e.open) handleDismiss(); }} placement="center">
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content maxW="420px" p={0} borderRadius="lg" bg="bg.surface">
            <Dialog.Header px={5} pt={5} pb={3}>
              <HStack gap="2" alignItems="center">
                <Box
                  display="flex"
                  alignItems="center"
                  justifyContent="center"
                  w="28px"
                  h="28px"
                  borderRadius="full"
                  bg={`${accentColor}/12`}
                  color={accentColor}
                >
                  {modalRating === 'positive'
                    ? <LuThumbsUp size={14} />
                    : <LuThumbsDown size={14} />
                  }
                </Box>
                <Dialog.Title fontSize="sm" fontWeight="600" fontFamily="mono">
                  Share Feedback
                </Dialog.Title>
              </HStack>
            </Dialog.Header>

            <Dialog.Body px={5} pb={4}>
              <VStack gap="4" align="stretch">
                {/* Tag grid */}
                <Box display="flex" flexWrap="wrap" gap="2">
                  {tags.map(tag => {
                    const isSelected = selectedTags.has(tag);
                    return (
                      <Box
                        key={tag}
                        as="button"
                        aria-label={`Tag: ${tag}`}
                        px="2.5"
                        py="1"
                        borderRadius="full"
                        fontSize="2xs"
                        fontFamily="mono"
                        fontWeight="500"
                        cursor="pointer"
                        border="1px solid"
                        borderColor={isSelected ? accentColor : 'border.default'}
                        bg={isSelected ? `${accentColor}/10` : 'transparent'}
                        color={isSelected ? accentColor : 'fg.muted'}
                        transition="all 0.15s ease"
                        _hover={{
                          borderColor: accentColor,
                          bg: `${accentColor}/6`,
                        }}
                        onClick={() => toggleTag(tag)}
                      >
                        <HStack gap="1" display="inline-flex">
                          {isSelected && <LuCheck size={10} strokeWidth={3} />}
                          <Text fontSize="2xs" fontFamily="mono">{tag}</Text>
                        </HStack>
                      </Box>
                    );
                  })}
                </Box>

                {/* Optional comment */}
                <Textarea
                  aria-label="Feedback comment"
                  placeholder="Anything else? (optional)"
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  fontSize="2xs"
                  fontFamily="mono"
                  rows={2}
                  resize="none"
                  border="1px solid"
                  borderColor="border.default"
                  borderRadius="md"
                  _focus={{
                    borderColor: 'accent.teal',
                    boxShadow: '0 0 0 1px var(--chakra-colors-accent-teal)',
                    outline: 'none',
                  }}
                  _placeholder={{ color: 'fg.subtle', opacity: 0.5 }}
                />
              </VStack>
            </Dialog.Body>

            <Dialog.Footer px={5} pb={5} pt={0}>
              <HStack gap="2" justify="flex-end" w="100%">
                <Button
                  aria-label="Cancel feedback"
                  size="xs"
                  variant="ghost"
                  fontSize="2xs"
                  fontFamily="mono"
                  color="fg.muted"
                  onClick={handleDismiss}
                >
                  Cancel
                </Button>
                <Button
                  aria-label="Submit feedback"
                  size="xs"
                  fontSize="2xs"
                  fontFamily="mono"
                  fontWeight="500"
                  bg={accentColor}
                  color="white"
                  borderRadius="md"
                  px="4"
                  onClick={handleSubmit}
                  css={{
                    transition: 'all 0.15s ease',
                    '&:hover': { opacity: 0.85 },
                    '&:active': { transform: 'scale(0.97)' },
                  }}
                >
                  Submit
                </Button>
              </HStack>
            </Dialog.Footer>

            <Dialog.CloseTrigger />
          </Dialog.Content>
        </Dialog.Positioner>
      </Dialog.Root>
    </Box>
  );
}
