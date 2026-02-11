/**
 * Public File Viewer - Accessible via token without authentication
 * Route: /t/{token}
 *
 * This page allows unauthenticated users to view files via access tokens.
 * The middleware sets the x-public-access-token header, and getEffectiveUser()
 * returns the view_as_user, making all existing permission logic work seamlessly.
 */

import { Box, Text, Center, Container, Heading, VStack } from '@chakra-ui/react';
import { AccessTokenDB } from '@/lib/database/documents-db';
import { loadFile } from '@/lib/data/files.server';
import { getEffectiveUserFromToken } from '@/lib/auth/auth-helpers';
import FileView from '@/components/FileView';
import FilesList from '@/components/FilesList';
import FileNotFound from '@/components/FileNotFound';
import { LuFolderOpen } from 'react-icons/lu';
import type { FolderContent } from '@/lib/types';

interface PublicFilePageProps {
  params: Promise<{ token: string }>;
}

export default async function PublicFilePage({ params }: PublicFilePageProps) {
  const { token } = await params;

  // Load and validate token
  const accessToken = await AccessTokenDB.getByToken(token);

  if (!accessToken) {
    return (
      <Container maxW="container.md" py={20}>
        <Center>
          <Box textAlign="center">
            <Heading size="lg" mb={4}>Token Not Found</Heading>
            <Text color="fg.muted">
              The access token you're using doesn't exist or has been removed.
            </Text>
          </Box>
        </Center>
      </Container>
    );
  }

  // Validate token (active and not expired)
  const validation = AccessTokenDB.validateToken(accessToken);

  if (!validation.isValid) {
    return (
      <Container maxW="container.md" py={20}>
        <Center>
          <Box textAlign="center">
            <Heading size="lg" mb={4}>Access Denied</Heading>
            <Text color="fg.muted" mb={2}>
              {validation.error || 'This token is no longer valid.'}
            </Text>
            {!accessToken.is_active && (
              <Text fontSize="sm" color="fg.subtle">
                Token has been revoked by administrator.
              </Text>
            )}
            {new Date(accessToken.expires_at) < new Date() && (
              <Text fontSize="sm" color="fg.subtle">
                Token expired on {new Date(accessToken.expires_at).toLocaleDateString()}.
              </Text>
            )}
          </Box>
        </Center>
      </Container>
    );
  }

  // Get effective user from token (view_as_user)
  const user = await getEffectiveUserFromToken(token);

  if (!user) {
    return <FileNotFound />;
  }

  // Load the file using token's file_id
  // The file will be loaded with view_as_user's permissions
  // References are loaded automatically
  try {
    const result = await loadFile(accessToken.file_id, user);

    if (!result.data) {
      return <FileNotFound />;
    }

    const file = result.data;

    // Note: Cookie is set by middleware for client-side API requests

    // Render file in simplified public viewer (no sidebar, no editing)
    return (
      <Box minH="100vh" bg="bg.canvas">
        <Container maxW="container.xl" py={8}>
          {/* Simple header */}
          <Box mb={6}>
            <Heading size="lg" mb={2}>{file.name}</Heading>
            <Text color="fg.muted" fontSize="sm">
              Viewing as: {user.name} ({user.email})
            </Text>
          </Box>

          {/* File content */}
          {file.type === 'folder' ? (
            <VStack align="stretch" gap={6}>
              {/* Folder description */}
              {(file.content as FolderContent).description && (
                <Box
                  bg="bg.surface"
                  borderRadius="lg"
                  borderWidth="1px"
                  borderColor="border.default"
                  p={4}
                >
                  <Text color="fg.muted">{(file.content as FolderContent).description}</Text>
                </Box>
              )}

              {/* Folder contents */}
              {result.metadata?.references && result.metadata.references.length > 0 ? (
                <FilesList files={result.metadata.references as any} />
              ) : (
                <Box
                  display="flex"
                  flexDirection="column"
                  alignItems="center"
                  justifyContent="center"
                  minH="60vh"
                  bg="bg.surface"
                  borderRadius="lg"
                  borderWidth="1px"
                  borderColor="border.default"
                  px={8}
                >
                  <LuFolderOpen
                    size="6rem"
                    style={{ color: 'var(--chakra-colors-fg-muted)', opacity: 0.4, marginBottom: '1rem' }}
                  />
                  <Text fontSize="lg" color="fg.muted" fontWeight="500">
                    This folder is empty
                  </Text>
                </Box>
              )}
            </VStack>
          ) : (
            <Box
              bg="bg.surface"
              borderRadius="lg"
              borderWidth="1px"
              borderColor="border.default"
              p={6}
            >
              <FileView fileId={accessToken.file_id} mode="view" />
            </Box>
          )}

          {/* Footer info */}
          <Box mt={6} textAlign="center">
            <Text fontSize="xs" color="fg.subtle">
              This {file.type === 'folder' ? 'folder' : 'file'} is shared via a secure access token.
              {accessToken.expires_at && ` Token expires on ${new Date(accessToken.expires_at).toLocaleDateString()}.`}
            </Text>
          </Box>
        </Container>
      </Box>
    );
  } catch (error) {
    console.error('[PublicFilePage] Error loading file:', error);
    return (
      <Container maxW="container.md" py={20}>
        <Center>
          <Box textAlign="center">
            <Heading size="lg" mb={4}>Error Loading File</Heading>
            <Text color="fg.muted">
              Unable to load the requested file. Please try again or contact support.
            </Text>
          </Box>
        </Center>
      </Container>
    );
  }
}
