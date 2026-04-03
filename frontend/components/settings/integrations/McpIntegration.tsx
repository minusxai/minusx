'use client';

import { useState } from 'react';
import { Box, HStack, Text, VStack, Badge } from '@chakra-ui/react';
import { LuPlug, LuCopy, LuCheck, LuChevronDown, LuChevronRight } from 'react-icons/lu';

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    void navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Box
      as="button"
      aria-label={label}
      display="inline-flex"
      alignItems="center"
      gap={1}
      px={2}
      py={1}
      fontSize="xs"
      fontFamily="mono"
      borderWidth="1px"
      borderColor="border"
      borderRadius="md"
      cursor="pointer"
      _hover={{ bg: 'bg.subtle' }}
      onClick={handleCopy}
    >
      {copied ? <LuCheck size={11} /> : <LuCopy size={11} />}
      {copied ? 'Copied!' : 'Copy'}
    </Box>
  );
}

function McpSetupGuide() {
  const mcpUrl = `${typeof window !== 'undefined' ? window.location.origin : ''}/api/mcp`;

  const claudeDesktopConfig = JSON.stringify(
    {
      mcpServers: {
        minusx: {
          url: mcpUrl,
          transport: 'streamable-http',
        },
      },
    },
    null,
    2,
  );

  return (
    <VStack align="stretch" gap={4}>
      {/* Endpoint URL */}
      <Box borderWidth="1px" borderColor="border" borderRadius="md" p={4}>
        <Text fontSize="xs" fontWeight="semibold" fontFamily="mono" color="fg.muted" mb={2} textTransform="uppercase" letterSpacing="wide">
          MCP Endpoint
        </Text>
        <HStack gap={2}>
          <Box
            flex={1}
            bg="bg.subtle"
            borderWidth="1px"
            borderColor="border"
            borderRadius="md"
            px={3}
            py={2}
            fontFamily="mono"
            fontSize="xs"
            overflowX="auto"
            whiteSpace="nowrap"
          >
            {mcpUrl}
          </Box>
          <CopyButton text={mcpUrl} label="Copy MCP endpoint URL" />
        </HStack>
      </Box>

      {/* Claude Desktop */}
      <Box borderWidth="1px" borderColor="border" borderRadius="md" p={4}>
        <HStack justify="space-between" mb={2}>
          <Text fontSize="xs" fontWeight="semibold" fontFamily="mono" color="fg.muted" textTransform="uppercase" letterSpacing="wide">
            Claude Desktop config
          </Text>
          <CopyButton text={claudeDesktopConfig} label="Copy Claude Desktop config" />
        </HStack>
        <Text fontSize="xs" color="fg.muted" fontFamily="mono" mb={3}>
          Paste into{' '}
          <Box as="span" fontFamily="mono" bg="bg.subtle" px={1} borderRadius="sm">
            claude_desktop_config.json
          </Box>{' '}
          under{' '}
          <Box as="span" fontFamily="mono" bg="bg.subtle" px={1} borderRadius="sm">
            mcpServers
          </Box>
          .
        </Text>
        <Box
          as="pre"
          fontSize="2xs"
          fontFamily="mono"
          bg="bg.subtle"
          borderRadius="md"
          p={3}
          borderWidth="1px"
          borderColor="border"
          whiteSpace="pre"
        >
          {claudeDesktopConfig}
        </Box>
      </Box>

      {/* Other clients */}
      <Box borderWidth="1px" borderColor="border" borderRadius="md" p={4}>
        <Text fontSize="xs" fontWeight="semibold" fontFamily="mono" color="fg.muted" mb={2} textTransform="uppercase" letterSpacing="wide">
          Other clients (Cursor, Windsurf, etc.)
        </Text>
        <Text fontSize="xs" color="fg.muted" fontFamily="mono">
          Point any MCP-compatible client to the endpoint above using the{' '}
          <Box as="span" fontFamily="mono" bg="bg.subtle" px={1} borderRadius="sm">streamable-http</Box>{' '}
          transport. Clients authenticate automatically via OAuth 2.1 on first connection — no tokens to paste.
        </Text>
      </Box>
    </VStack>
  );
}

export function McpIntegration() {
  const [expanded, setExpanded] = useState(false);

  return (
    <Box borderWidth="1px" borderColor="border" borderRadius="md" overflow="hidden">
      <HStack
        p={4}
        justify="space-between"
        cursor="pointer"
        onClick={() => setExpanded(!expanded)}
        _hover={{ bg: 'bg.subtle' }}
        transition="background 0.15s ease"
      >
        <HStack gap={3}>
          <LuPlug size={18} />
          <Box>
            <Text fontWeight="semibold" fontFamily="mono" fontSize="sm">MCP</Text>
            <Text fontSize="xs" color="fg.muted" fontFamily="mono">
              Expose MinusX as an MCP tool server
            </Text>
          </Box>
        </HStack>
        <HStack gap={2}>
          <Badge colorPalette="teal" size="sm">Active</Badge>
          {expanded ? <LuChevronDown size={16} /> : <LuChevronRight size={16} />}
        </HStack>
      </HStack>
      {expanded && (
        <Box p={4} borderTopWidth="1px" borderTopColor="border">
          <McpSetupGuide />
        </Box>
      )}
    </Box>
  );
}
