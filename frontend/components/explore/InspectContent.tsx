'use client';

import { Box, VStack, Text } from '@chakra-ui/react';
import type { InspectPart } from './inspect-content';

/** A labelled, scrollable monospace code block — used for text, markup, query tables, and JSON. */
function CodeBlock({ text }: { text: string }) {
  return (
    <Box
      as="pre"
      m={0}
      p={3}
      bg="bg.canvas"
      border="1px solid"
      borderColor="border.default"
      borderRadius="md"
      fontFamily="mono"
      fontSize="xs"
      lineHeight="1.5"
      whiteSpace="pre-wrap"
      wordBreak="break-word"
      overflowX="auto"
      maxH="360px"
      overflowY="auto"
    >
      {text}
    </Box>
  );
}

function PartLabel({ children }: { children: React.ReactNode }) {
  return (
    <Text fontSize="2xs" fontWeight="600" color="fg.muted" textTransform="uppercase" letterSpacing="wider">
      {children}
    </Text>
  );
}

/** Render one inspect part by its content type. */
function Part({ part }: { part: InspectPart }) {
  switch (part.kind) {
    case 'image':
      return (
        <VStack align="stretch" gap={1}>
          <PartLabel>{part.label}</PartLabel>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={part.url} alt={part.label} style={{ width: '100%', borderRadius: '6px', border: '1px solid var(--chakra-colors-border-default)' }} />
        </VStack>
      );
    case 'markup':
      return (
        <VStack align="stretch" gap={1}>
          <PartLabel>{part.label}</PartLabel>
          <CodeBlock text={part.text} />
        </VStack>
      );
    case 'query':
      return (
        <VStack align="stretch" gap={1}>
          <PartLabel>{part.label}{part.totalRows ? ` · ${part.totalRows} rows` : ''}</PartLabel>
          <CodeBlock text={part.data} />
        </VStack>
      );
    case 'json':
      return (
        <VStack align="stretch" gap={1}>
          <PartLabel>{part.label}</PartLabel>
          <CodeBlock text={JSON.stringify(part.value, null, 2)} />
        </VStack>
      );
    case 'text':
    default:
      return (
        <VStack align="stretch" gap={1}>
          <PartLabel>{part.label}</PartLabel>
          <CodeBlock text={part.text} />
        </VStack>
      );
  }
}

/** Render a list of inspect parts (user message / app state) by content type. */
export default function InspectContent({ parts }: { parts: InspectPart[] }) {
  if (parts.length === 0) {
    return <Text fontSize="sm" color="fg.muted" textAlign="center" py={6}>Nothing to show.</Text>;
  }
  return (
    <VStack align="stretch" gap={3}>
      {parts.map((part, i) => (
        <Part key={i} part={part} />
      ))}
    </VStack>
  );
}
