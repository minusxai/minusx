'use client';

import { useEffect, useState } from 'react';
import { Box, Button, HStack, Text, VStack, Badge } from '@chakra-ui/react';
import { LuPlug, LuCopy, LuCheck, LuChevronDown, LuChevronRight } from 'react-icons/lu';
import { useConfigs, reloadConfigs } from '@/lib/hooks/useConfigs';
import { fetchWithCache } from '@/lib/api/fetch-wrapper';
import { toaster } from '@/components/ui/toaster';

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    void navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Button
      aria-label={label}
      size="xs"
      variant="outline"
      onClick={handleCopy}
    >
      {copied ? <LuCheck size={11} /> : <LuCopy size={11} />}
      {copied ? 'Copied!' : 'Copy'}
    </Button>
  );
}

function McpSetupGuide() {
  const [endpointUrl, setEndpointUrl] = useState<string>('');
  const [isEnabled, setIsEnabled] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState(false);
  const { config } = useConfigs();

  useEffect(() => {
    setIsEnabled(config.mcp?.enabled ?? false);
  }, [config.mcp?.enabled]);

  useEffect(() => {
    fetch('/api/integrations/mcp', { credentials: 'include' })
      .then(r => r.json())
      .then((data: { data?: { endpointUrl?: string } }) => {
        if (data?.data?.endpointUrl) setEndpointUrl(data.data.endpointUrl);
      })
      .catch(() => {});
  }, []);

  const handleToggle = async () => {
    const next = !isEnabled;
    setIsSaving(true);
    try {
      await fetchWithCache('/api/integrations/mcp', {
        method: 'POST',
        skipCache: true,
        body: JSON.stringify({ enabled: next }),
      });
      await reloadConfigs();
      toaster.create({
        title: next ? 'MCP enabled' : 'MCP disabled',
        type: 'success',
      });
    } catch (error) {
      toaster.create({
        title: 'Failed to update MCP settings',
        description: error instanceof Error ? error.message : 'Please try again.',
        type: 'error',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const mcpUrl = endpointUrl || `${typeof window !== 'undefined' ? window.location.origin : ''}/api/mcp`;

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
      {/* Enable / disable */}
      <Box borderWidth="1px" borderColor="border" borderRadius="md" p={4}>
        <HStack justify="space-between" align="center">
          <VStack align="start" gap={1}>
            <Text fontSize="sm" fontWeight="semibold" fontFamily="mono">
              MCP server
            </Text>
            <Text fontSize="xs" color="fg.muted" fontFamily="mono">
              Expose MinusX as an MCP tool server. Clients connect via OAuth 2.1 on first use.
            </Text>
          </VStack>
          <Button
            aria-label={isEnabled ? 'Disable MCP' : 'Enable MCP'}
            size="sm"
            colorPalette={isEnabled ? 'red' : 'teal'}
            variant={isEnabled ? 'outline' : 'solid'}
            onClick={handleToggle}
            loading={isSaving}
          >
            {isEnabled ? 'Disable' : 'Enable'}
          </Button>
        </HStack>
      </Box>

      {/* Connection details — shown only when enabled */}
      {isEnabled && (
        <>
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
        </>
      )}
    </VStack>
  );
}

export function McpIntegration() {
  const [expanded, setExpanded] = useState(false);
  const { config } = useConfigs();
  const isEnabled = config.mcp?.enabled ?? false;

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
              {isEnabled
                ? 'Connected — MCP server active'
                : 'Not connected — click to set up'}
            </Text>
          </Box>
        </HStack>
        <HStack gap={2}>
          {isEnabled && <Badge colorPalette="teal" size="sm">Active</Badge>}
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
