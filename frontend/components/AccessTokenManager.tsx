/**
 * AccessTokenManager Component
 *
 * Admin-only component for managing public access tokens for file sharing.
 *
 * Features:
 * - Create new tokens with custom expiration
 * - List existing tokens with metadata
 * - Revoke tokens
 * - Copy token URLs to clipboard
 *
 * Security: Only visible and functional for admin users
 */

'use client';

import {
  Box,
  Button,
  Container,
  Heading,
  Text,
  VStack,
  HStack,
  Input,
  Table,
  IconButton,
  Badge,
  Spinner,
  Card,
  Separator,
} from '@chakra-ui/react';
import { useState } from 'react';
import { AccessToken, AccessTokenAnalytics, User } from '@/lib/types';
import { FiCopy, FiTrash2, FiExternalLink, FiCheck, FiX } from 'react-icons/fi';
import { useFetch, useFetchManual } from '@/lib/api/useFetch';
import { API } from '@/lib/api/declarations';
import { fetchWithCache } from '@/lib/api/fetch-wrapper';

// Extended token type with analytics
interface AccessTokenWithAnalytics extends AccessToken {
  analytics: AccessTokenAnalytics;
}

interface AccessTokenManagerProps {
  fileId: number;
  currentUser: User;
}

export default function AccessTokenManager({ fileId, currentUser }: AccessTokenManagerProps) {
  const [creating, setCreating] = useState(false);

  // Form state
  const [selectedUserId, setSelectedUserId] = useState<string>('');
  const [expirationDays, setExpirationDays] = useState<string>('30');
  const [customExpiration, setCustomExpiration] = useState<string>('');

  // Message state (for inline notifications)
  const [message, setMessage] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);

  // Check if user is admin
  const isAdmin = currentUser.role === 'admin';

  // Fetch tokens with caching (only if admin)
  const { data: tokensData, loading: tokensLoading, refetch: refetchTokens } = useFetch(
    {
      ...API.accessTokens.list,
      url: `${API.accessTokens.list.url}?fileId=${fileId}`
    },
    undefined,
    { enabled: isAdmin }
  );

  // Fetch users with caching (only if admin)
  const { data: usersData, loading: usersLoading } = useFetch(
    API.users.list,
    undefined,
    { enabled: isAdmin }
  );

  const tokens = (tokensData as any)?.data || [];
  const users = (usersData as any)?.data?.users || (usersData as any)?.users || [];
  const loading = tokensLoading || usersLoading;

  async function loadTokens() {
    try {
      await refetchTokens();
    } catch (error) {
      console.error('Error loading tokens:', error);
      setMessage({ type: 'error', text: 'Failed to load access tokens' });
    }
  }


  async function createToken() {
    if (!selectedUserId) {
      setMessage({ type: 'error', text: 'Please select a user to view as' });
      return;
    }

    try {
      setCreating(true);
      setMessage(null);

      // Calculate expiration date
      let expires_at: string | undefined;
      if (expirationDays === 'custom' && customExpiration) {
        expires_at = new Date(customExpiration).toISOString();
      } else if (expirationDays !== 'never') {
        const days = parseInt(expirationDays);
        expires_at = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
      }

      const result = await fetchWithCache('/api/access-tokens', {
        method: 'POST',
        body: JSON.stringify({
          file_id: fileId,
          view_as_user_id: parseInt(selectedUserId),
          expires_at,
        }),
        cacheStrategy: API.accessTokens.create.cache,
      });

      if (result.success) {
        // Copy URL to clipboard
        try {
          await navigator.clipboard.writeText(result.data.url);
          setMessage({ type: 'success', text: 'Token created and URL copied to clipboard' });
        } catch {
          setMessage({ type: 'success', text: 'Token created successfully' });
        }

        // Reload tokens list
        loadTokens();

        // Reset form
        setExpirationDays('30');
        setCustomExpiration('');
      } else {
        const errorMsg = typeof result.error === 'string'
          ? result.error
          : result.error?.message || 'Failed to create access token';
        setMessage({ type: 'error', text: errorMsg });
      }
    } catch (error) {
      console.error('Error creating token:', error);
      setMessage({ type: 'error', text: 'Failed to create access token' });
    } finally {
      setCreating(false);
    }
  }

  async function revokeToken(tokenId: number) {
    if (!confirm('Are you sure you want to revoke this token? This cannot be undone.')) {
      return;
    }

    try {
      const result = await fetchWithCache(`/api/access-tokens/${tokenId}`, {
        method: 'DELETE',
        cacheStrategy: API.accessTokens.delete.cache,
      });

      if (result.success) {
        setMessage({ type: 'success', text: 'Access token has been revoked' });
        loadTokens();
      } else {
        const errorMsg = typeof result.error === 'string'
          ? result.error
          : result.error?.message || 'Failed to revoke token';
        setMessage({ type: 'error', text: errorMsg });
      }
    } catch (error) {
      console.error('Error revoking token:', error);
      setMessage({ type: 'error', text: 'Failed to revoke token' });
    }
  }

  async function copyTokenUrl(token: string) {
    const baseUrl = window.location.origin;
    const url = `${baseUrl}/t/${token}`;

    try {
      await navigator.clipboard.writeText(url);
      setCopiedToken(token);
      setTimeout(() => setCopiedToken(null), 2000);
    } catch (error) {
      console.error('Error copying URL:', error);
      setMessage({ type: 'error', text: 'Failed to copy URL' });
    }
  }

  function formatTokenDisplay(token: string): string {
    if (token.length <= 12) return token;
    return `${token.substring(0, 8)}...${token.substring(token.length - 4)}`;
  }

  function getTokenStatus(token: AccessToken): { label: string; colorScheme: string } {
    if (!token.is_active) {
      return { label: 'Revoked', colorScheme: 'red' };
    }

    const expiresAt = new Date(token.expires_at);
    const now = new Date();

    if (expiresAt < now) {
      return { label: 'Expired', colorScheme: 'orange' };
    }

    return { label: 'Active', colorScheme: 'green' };
  }

  function formatDate(dateString: string): string {
    return new Date(dateString).toLocaleString();
  }

  // Don't render anything if not admin
  if (!isAdmin) {
    return null;
  }

  return (
    <Card.Root>
      <Card.Header>
        <Heading size="md">Public Access Tokens</Heading>
        <Text color="fg.muted" fontSize="sm">
          Share this file with unauthenticated users via secure URLs
        </Text>
      </Card.Header>

      <Card.Body>
        <VStack gap={6} align="stretch">
          {/* Message Display */}
          {message && (
            <Box
              p={3}
              borderRadius="md"
              bg={message.type === 'success' ? 'accent.teal' : message.type === 'error' ? 'accent.danger' : 'blue.50'}
              borderWidth="1px"
              borderColor={message.type === 'success' ? 'accent.teal' : message.type === 'error' ? 'accent.danger' : 'accent.primary'}
            >
              <HStack gap={2}>
                {message.type === 'success' && <FiCheck color="green" />}
                {message.type === 'error' && <FiX color="red" />}
                <Text fontSize="sm" color={message.type === 'success' ? 'accent.teal' : message.type === 'error' ? 'accent.danger' : 'accent.primary'}>
                  {message.text}
                </Text>
              </HStack>
            </Box>
          )}

          {/* Create Token Form */}
          <Box>
            <Heading size="sm" mb={3}>Create New Token</Heading>
            <VStack gap={4} align="stretch">
              <Box>
                <Text fontSize="sm" fontWeight="medium" mb={2}>
                  View as User
                </Text>
                <select
                  value={selectedUserId}
                  onChange={(e) => setSelectedUserId(e.target.value)}
                  disabled={creating}
                  style={{
                    width: '100%',
                    padding: '0.5rem 0.75rem',
                    borderRadius: '0.375rem',
                    border: '1px solid var(--chakra-colors-border-default)',
                    backgroundColor: 'var(--chakra-colors-bg-surface)',
                    color: 'var(--chakra-colors-fg-default)',
                    fontSize: '0.875rem',
                  }}
                >
                  {users.map((user: User) => (
                    <option key={user.id} value={user.id}>
                      {user.name} ({user.email}) - {user.role}
                    </option>
                  ))}
                </select>
                <Text fontSize="xs" color="fg.muted" mt={1}>
                  Recipients will see this file with the selected user's permissions
                </Text>
              </Box>

              <Box>
                <Text fontSize="sm" fontWeight="medium" mb={2}>
                  Expiration
                </Text>
                <HStack gap={3}>
                  <select
                    value={expirationDays}
                    onChange={(e) => setExpirationDays(e.target.value)}
                    disabled={creating}
                    style={{
                      flex: 1,
                      padding: '0.5rem 0.75rem',
                      borderRadius: '0.375rem',
                      border: '1px solid var(--chakra-colors-border-default)',
                      backgroundColor: 'var(--chakra-colors-bg-surface)',
                      color: 'var(--chakra-colors-fg-default)',
                      fontSize: '0.875rem',
                    }}
                  >
                    <option value="7">7 days</option>
                    <option value="30">30 days (default)</option>
                    <option value="90">90 days</option>
                    <option value="never">Never expires</option>
                    <option value="custom">Custom date</option>
                  </select>

                  {expirationDays === 'custom' && (
                    <Input
                      type="datetime-local"
                      value={customExpiration}
                      onChange={(e) => setCustomExpiration(e.target.value)}
                      disabled={creating}
                      flex={1}
                    />
                  )}
                </HStack>
              </Box>

              <Button
                onClick={createToken}
                loading={creating}
                colorScheme="blue"
                alignSelf="flex-start"
              >
                Create Token
              </Button>
            </VStack>
          </Box>

          <Separator />

          {/* Tokens List */}
          <Box>
            <Heading size="sm" mb={3}>Active Tokens</Heading>

            {loading ? (
              <Box textAlign="center" py={8}>
                <Spinner size="lg" />
              </Box>
            ) : tokens.length === 0 ? (
              <Box textAlign="center" py={8}>
                <Text color="fg.muted">No access tokens created yet</Text>
              </Box>
            ) : (
              <Box overflowX="auto">
                <Table.Root size="sm">
                  <Table.Header>
                    <Table.Row>
                      <Table.ColumnHeader>Token</Table.ColumnHeader>
                      <Table.ColumnHeader>View As</Table.ColumnHeader>
                      <Table.ColumnHeader>Status</Table.ColumnHeader>
                      <Table.ColumnHeader>Created</Table.ColumnHeader>
                      <Table.ColumnHeader>Expires</Table.ColumnHeader>
                      <Table.ColumnHeader>Usage</Table.ColumnHeader>
                      <Table.ColumnHeader>Actions</Table.ColumnHeader>
                    </Table.Row>
                  </Table.Header>
                  <Table.Body>
                    {tokens.map((token: AccessTokenWithAnalytics) => {
                      const status = getTokenStatus(token);
                      const viewAsUser = users.find((u: User) => u.id === token.view_as_user_id);

                      return (
                        <Table.Row key={token.id}>
                          <Table.Cell>
                            <Text fontFamily="mono" fontSize="xs">
                              {formatTokenDisplay(token.token)}
                            </Text>
                          </Table.Cell>
                          <Table.Cell>
                            <Text fontSize="sm">
                              {viewAsUser ? `${viewAsUser.name}` : `User ${token.view_as_user_id}`}
                            </Text>
                          </Table.Cell>
                          <Table.Cell>
                            <Badge colorPalette={status.colorScheme}>
                              {status.label}
                            </Badge>
                          </Table.Cell>
                          <Table.Cell>
                            <Text fontSize="xs" color="fg.muted">
                              {formatDate(token.created_at)}
                            </Text>
                          </Table.Cell>
                          <Table.Cell>
                            <Text fontSize="xs" color="fg.muted">
                              {formatDate(token.expires_at)}
                            </Text>
                          </Table.Cell>
                          <Table.Cell>
                            <VStack align="start" gap={0}>
                              <Text fontSize="xs" color="fg.muted">
                                {token.analytics.access_count || 0} views
                              </Text>
                              {token.analytics.last_accessed_at && (
                                <Text fontSize="xs" color="fg.subtle">
                                  Last: {new Date(token.analytics.last_accessed_at).toLocaleDateString()}
                                </Text>
                              )}
                            </VStack>
                          </Table.Cell>
                          <Table.Cell>
                            <HStack gap={1}>
                              <IconButton
                                aria-label="Copy URL"
                                size="xs"
                                onClick={() => copyTokenUrl(token.token)}
                                title={copiedToken === token.token ? "Copied!" : "Copy URL"}
                                colorScheme={copiedToken === token.token ? "green" : undefined}
                              >
                                {copiedToken === token.token ? <FiCheck /> : <FiCopy />}
                              </IconButton>
                              <IconButton
                                aria-label="Open in new tab"
                                size="xs"
                                onClick={() => window.open(`/t/${token.token}`, '_blank')}
                                title="Open in new tab"
                              >
                                <FiExternalLink />
                              </IconButton>
                              <IconButton
                                aria-label="Revoke token"
                                size="xs"
                                colorScheme="red"
                                onClick={() => revokeToken(token.id)}
                                disabled={!token.is_active}
                                title="Revoke token"
                              >
                                <FiTrash2 />
                              </IconButton>
                            </HStack>
                          </Table.Cell>
                        </Table.Row>
                      );
                    })}
                  </Table.Body>
                </Table.Root>
              </Box>
            )}
          </Box>
        </VStack>
      </Card.Body>
    </Card.Root>
  );
}
