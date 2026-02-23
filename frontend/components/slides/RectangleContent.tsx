'use client';

import { Box, Image, Text, Spinner } from '@chakra-ui/react';
import Markdown from '../Markdown';
import SmartEmbeddedQuestionContainer from '../containers/SmartEmbeddedQuestionContainer';
import { useState } from 'react';

interface RectangleContentProps {
  contentType: 'text' | 'markdown' | 'image' | 'question' | 'divider';
  content: string;
  textAlign?: 'left' | 'center' | 'right';
  textColor?: string;
}

export default function RectangleContent({
  contentType,
  content,
  textAlign = 'left',
  textColor
}: RectangleContentProps) {
  const [imageLoading, setImageLoading] = useState(true);
  const [imageError, setImageError] = useState(false);

  // Treat 'text' as markdown for rendering
  if (contentType === 'text' || contentType === 'markdown') {
    return (
      <Box
        p={6}
        height="100%"
        overflow="auto"
      >
        <Markdown context="mainpage" textAlign={textAlign} textColor={textColor}>
          {content}
        </Markdown>
      </Box>
    );
  }

  if (contentType === 'image') {
    // Show empty state if no content
    if (!content || content.trim() === '') {
      return (
        <Box
          height="100%"
          width="100%"
          display="flex"
          alignItems="center"
          justifyContent="center"
          bg="bg.muted"
          opacity={0.6}
        >
          <Text fontSize="sm" color="fg.muted" fontStyle="italic">
            Click the edit button to add an image
          </Text>
        </Box>
      );
    }

    return (
      <Box
        height="100%"
        width="100%"
        display="flex"
        alignItems="center"
        justifyContent="center"
        overflow="hidden"
        position="relative"
      >
        {imageLoading && !imageError && (
          <Spinner size="md" color="accent.secondary" />
        )}
        {imageError ? (
          <Box p={4} textAlign="center">
            <Text color="accent.danger" fontSize="sm" mb={1}>
              Failed to load image
            </Text>
            <Text fontSize="xs" color="fg.muted" wordBreak="break-all">
              {content}
            </Text>
          </Box>
        ) : (
          <Image
            src={content}
            alt="Slide image"
            objectFit="contain"
            maxWidth="100%"
            maxHeight="100%"
            onLoad={() => setImageLoading(false)}
            onError={() => {
              setImageLoading(false);
              setImageError(true);
            }}
            display={imageLoading ? 'none' : 'block'}
          />
        )}
      </Box>
    );
  }

  if (contentType === 'question') {
    // Parse question ID from content
    const questionId = parseInt(content, 10);

    if (isNaN(questionId) || questionId <= 0) {
      return (
        <Box
          height="100%"
          width="100%"
          display="flex"
          alignItems="center"
          justifyContent="center"
          bg="bg.muted"
          opacity={0.6}
        >
          <Text fontSize="sm" color="fg.muted" fontStyle="italic">
            Invalid question ID
          </Text>
        </Box>
      );
    }

    return (
      <Box height="100%" width="100%" overflow="auto">
        <SmartEmbeddedQuestionContainer
          questionId={questionId}
          showTitle={true}
          editMode={false}
        />
      </Box>
    );
  }

  return null;
}
