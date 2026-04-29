'use client';

import { Box, HStack, VStack, Text, Icon, Link } from '@chakra-ui/react';
import { LuExternalLink } from 'react-icons/lu';

export interface WebSearchResult {
  url: string;
  title: string;
  cited_text?: string;
}

interface WebSearchDetailCardProps {
  results: WebSearchResult[];
  icon: React.ComponentType;
}

function getDomain(url: string): string {
  try {
    return new URL(url).hostname.replace('www.', '');
  } catch {
    return url;
  }
}

function getFaviconUrl(url: string): string {
  try {
    const domain = new URL(url).hostname;
    return `https://www.google.com/s2/favicons?domain=${domain}&sz=16`;
  } catch {
    return '';
  }
}

export function WebSearchDetailCard({ results, icon }: WebSearchDetailCardProps) {
  return (
    <Box px={3} py={2}>
      {/* Header */}
      <HStack gap={1.5} mb={2}>
        <Icon as={icon} boxSize={3} color="fg.muted" />
        <Text fontSize="2xs" fontFamily="mono" color="fg.subtle" fontWeight="600" textTransform="uppercase">
          {results.length} {results.length === 1 ? 'source' : 'sources'}
        </Text>
      </HStack>

      {/* Chips grid */}
      <Box display="flex" flexWrap="wrap" gap={1.5}>
        {results.map((r, idx) => (
          <Link
            key={idx}
            href={r.url}
            target="_blank"
            rel="noopener noreferrer"
            _hover={{ textDecoration: 'none' }}
          >
            <HStack
              gap={1.5}
              px={2} py={1}
              bg="accent.teal/8"
              border="1px solid"
              borderColor="accent.teal/15"
              borderRadius="full"
              cursor="pointer"
              _hover={{ bg: 'accent.teal/15', borderColor: 'accent.teal/30' }}
              transition="all 0.15s"
              maxW="260px"
            >
              <img
                src={getFaviconUrl(r.url)}
                width={14} height={14}
                style={{ flexShrink: 0, borderRadius: '2px' }}
                alt=""
              />
              <Text fontSize="2xs" fontFamily="mono" color="accent.teal" fontWeight="600" flexShrink={0}>
                {idx + 1}
              </Text>
              <Text fontSize="xs" fontFamily="mono" color="fg.default" fontWeight="500" truncate>
                {getDomain(r.url)}
              </Text>
            </HStack>
          </Link>
        ))}
      </Box>
    </Box>
  );
}

export default function WebSearchDisplay() {
  return null;
}
