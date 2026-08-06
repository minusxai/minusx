'use client';

import { Box, Text, HStack, Code } from '@chakra-ui/react';
import { LuShieldCheck } from 'react-icons/lu';
import { connectionTypeNeedsEgressHint } from '@/lib/ui/egress-hint';

interface EgressIpHintProps {
  /** The connection type being configured; decides whether the hint applies at all. */
  connectionType: string | undefined | null;
  /** Deployment egress IPs. Empty means unset (self-hosted) — nothing renders. */
  ips: string[];
  /** Stronger framing after a failed connection test, where this is a likely cause. */
  emphasis?: boolean;
}

/**
 * Which source IPs to allow through a database firewall.
 *
 * Renders nothing unless the deployment publishes egress IPs AND the engine is
 * one reached over the network — see `lib/ui/egress-hint.ts` for both rules.
 */
export default function EgressIpHint({ connectionType, ips, emphasis = false }: EgressIpHintProps) {
  if (ips.length === 0 || !connectionTypeNeedsEgressHint(connectionType)) return null;

  return (
    <Box
      aria-label="Database firewall allowlist"
      px={3}
      py={2.5}
      borderRadius="md"
      bg={emphasis ? 'accent.amber/10' : 'bg.surface'}
      border="1px solid"
      borderColor={emphasis ? 'accent.amber/30' : 'border.default'}
    >
      <HStack gap={2} align="flex-start">
        <Box pt="2px" color={emphasis ? 'accent.amber' : 'fg.muted'}>
          <LuShieldCheck size={14} />
        </Box>
        <Box>
          <Text fontSize="xs" color="fg.muted">
            {`If your database restricts access by IP, allow ${
              ips.length === 1 ? 'this source address' : 'these source addresses'
            }${emphasis ? ':' : '.'}`}
          </Text>
          <HStack gap={1.5} mt={1.5} wrap="wrap">
            {ips.map(ip => (
              <Code key={ip} fontSize="xs" px={1.5} py={0.5}>
                {ip}
              </Code>
            ))}
          </HStack>
        </Box>
      </HStack>
    </Box>
  );
}
