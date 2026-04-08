'use client';

import { useState } from 'react';
import { Box, VStack, HStack, Text, Heading, Button } from '@chakra-ui/react';
import { LuShieldCheck, LuDatabase, LuSearch, LuTable } from 'react-icons/lu';

interface ConsentProps {
  clientOrigin?: string;
  userName?: string;
  userEmail?: string;
  companyName?: string;
  redirectUri?: string;
  codeChallenge?: string;
  codeChallengeMethod?: string;
  state?: string;
  scope?: string;
  error?: string;
}

export default function OAuthConsentForm({
  clientOrigin,
  userName,
  userEmail,
  companyName,
  redirectUri,
  codeChallenge,
  codeChallengeMethod,
  state,
  scope,
  error,
}: ConsentProps) {
  const [loading, setLoading] = useState(false);

  const handleApprove = () => {
    setLoading(true);
    const form = document.createElement('form');
    form.method = 'POST';
    form.action = '/oauth/authorize/approve';

    const fields: Record<string, string> = {
      redirect_uri: redirectUri!,
      code_challenge: codeChallenge!,
      code_challenge_method: codeChallengeMethod || 'S256',
      ...(state ? { state } : {}),
      ...(scope ? { scope } : {}),
    };

    for (const [key, value] of Object.entries(fields)) {
      const input = document.createElement('input');
      input.type = 'hidden';
      input.name = key;
      input.value = value;
      form.appendChild(input);
    }

    document.body.appendChild(form);
    form.submit();
  };

  const handleDeny = () => {
    if (!redirectUri) return;
    const url = new URL(redirectUri);
    url.searchParams.set('error', 'access_denied');
    if (state) url.searchParams.set('state', state);
    window.location.href = url.toString();
  };

  if (error) {
    return (
      <Box display="flex" alignItems="center" justifyContent="center" minH="70vh" p={4}>
        <Box
          w="full"
          maxW="420px"
          p={8}
          bg="bg.surface"
          borderRadius="xl"
          border="1px solid"
          borderColor="border.default"
          textAlign="center"
        >
          <Box
            w={12} h={12} borderRadius="full"
            bg="red.500/10" color="red.400"
            display="flex" alignItems="center" justifyContent="center"
            mx="auto" mb={4} fontSize="xl"
          >
            !
          </Box>
          <Heading size="md" mb={2}>Authorization Failed</Heading>
          <Text fontSize="sm" color="fg.muted">{error}</Text>
        </Box>
      </Box>
    );
  }

  const permissions = [
    { icon: LuSearch, label: 'Search your database schemas and files' },
    { icon: LuDatabase, label: 'Execute SQL queries on your connections' },
    { icon: LuTable, label: 'Read files, query results, and metadata' },
  ];

  return (
    <Box display="flex" alignItems="center" justifyContent="center" minH="70vh" p={4}>
      <Box
        w="full"
        maxW="420px"
        p={8}
        bg="bg.surface"
        borderRadius="xl"
        border="1px solid"
        borderColor="border.default"
        boxShadow="0 20px 60px rgba(0, 0, 0, 0.15)"
      >
        <VStack align="stretch" gap={5}>
          {/* Header */}
          <VStack gap={1}>
            <Box
              w={12} h={12} borderRadius="full"
              bg="accent.teal/10" color="accent.teal"
              display="flex" alignItems="center" justifyContent="center"
              fontSize="xl"
            >
              <LuShieldCheck />
            </Box>
            <Heading size="lg" textAlign="center" fontFamily="mono">
              Authorize access
            </Heading>
            <Text fontSize="sm" color="fg.muted" textAlign="center">
              <Text as="span" color="accent.teal" fontWeight={500}>{clientOrigin}</Text>
              {' '}wants to connect to your workspace
            </Text>
          </VStack>

          {/* Divider */}
          <Box h="1px" bg="border.default" />

          {/* User info */}
          <HStack
            p={3}
            bg="bg.muted"
            borderRadius="lg"
            border="1px solid"
            borderColor="border.default"
            gap={3}
          >
            <Box
              w={10} h={10} borderRadius="lg" flexShrink={0}
              bg="accent.teal" color="white"
              display="flex" alignItems="center" justifyContent="center"
              fontWeight={600} fontSize="md"
            >
              {(userName || '?')[0].toUpperCase()}
            </Box>
            <Box>
              <Text fontSize="sm" fontWeight={500}>{userName}</Text>
              <Text fontSize="xs" color="fg.muted">{userEmail} &middot; {companyName}</Text>
            </Box>
          </HStack>

          {/* Permissions */}
          <Box>
            <Text fontSize="xs" color="fg.muted" fontWeight={500} textTransform="uppercase" letterSpacing="wider" mb={3}>
              This will allow the application to:
            </Text>
            <VStack align="stretch" gap={2.5}>
              {permissions.map((perm, i) => (
                <HStack key={i} gap={2.5}>
                  <Box color="accent.teal" fontSize="sm" flexShrink={0}>
                    <perm.icon />
                  </Box>
                  <Text fontSize="sm" color="fg.default">{perm.label}</Text>
                </HStack>
              ))}
            </VStack>
          </Box>

          {/* Tools */}
          <Box>
            <Text fontSize="xs" color="fg.muted" fontWeight={500} textTransform="uppercase" letterSpacing="wider" mb={2}>
              Available tools
            </Text>
            <HStack gap={2} flexWrap="wrap">
              {['SearchDBSchema', 'ExecuteQuery', 'ListAllConnections', 'SearchFiles', 'ReadFiles'].map((tool) => (
                <Box
                  key={tool}
                  px={2.5}
                  py={1}
                  bg="bg.muted"
                  borderRadius="md"
                  border="1px solid"
                  borderColor="border.default"
                >
                  <Text fontSize="xs" fontFamily="mono" color="fg.muted">{tool}</Text>
                </Box>
              ))}
            </HStack>
          </Box>

          {/* Actions */}
          <HStack gap={3} pt={1}>
            <Button
              variant="outline"
              flex={1}
              onClick={handleDeny}
              disabled={loading}
              size="lg"
              borderColor="border.default"
            >
              Cancel
            </Button>
            <Button
              flex={2}
              onClick={handleApprove}
              disabled={loading}
              size="lg"
              bg="accent.teal"
              color="white"
              _hover={{ bg: 'accent.teal', opacity: 0.9 }}
            >
              {loading ? 'Authorizing...' : 'Authorize'}
            </Button>
          </HStack>

          {/* Footer */}
          <Text fontSize="xs" color="fg.subtle" textAlign="center">
            Authorizing will redirect you to{' '}
            <Text as="span" color="fg.muted" fontWeight={500}>{clientOrigin}</Text>
          </Text>
        </VStack>
      </Box>
    </Box>
  );
}
