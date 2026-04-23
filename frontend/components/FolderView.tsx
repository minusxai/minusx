'use client';

/**
 * FolderView Component
 * Generic folder renderer that uses useFolder hook
 *
 * Responsibilities:
 * - Load folder contents using useFolder hook
 * - Handle loading and error states
 * - Display folder title and file/folder counts
 * - Delegate to FilesList for rendering
 */
import { Box, Heading, Text, Spinner, HStack, IconButton, Flex } from '@chakra-ui/react';
import {
  LuDatabase,
  LuSettings,
  LuFileText,
  LuFileSpreadsheet,
  LuMessageSquare,
  LuVideo,
  LuRefreshCw,
  LuFolderOpen,
} from 'react-icons/lu';
import RecentFilesSection from './RecentFilesSection';
import { Tooltip } from '@/components/ui/tooltip';
import { readFolder } from '@/lib/api/file-state';
import type { IconType } from 'react-icons';
import { useFolder } from '@/lib/hooks/file-state-hooks';
import FilesList from './FilesList';
import GettingStartedSection from './GettingStartedSection';
import CreateMenu from './CreateMenu';
import type { FileType } from '@/lib/types';
import type { ReactNode } from 'react';
import { useAppSelector } from '@/store/hooks';
import { isSystemFolder, SYSTEM_FOLDERS, resolvePath } from '@/lib/mode/path-resolver';
import { DEFAULT_MODE, Mode } from '@/lib/mode/mode-types';

function DefaultEmptyState({ currentPath }: { currentPath: string }) {
  return (
    <Box
      display="flex"
      flexDirection="column"
      alignItems="center"
      justifyContent="center"
      minH="60vh"
      px={8}
    >
      <Box
        as={LuFolderOpen}
        fontSize="6xl"
        color="fg.muted"
        opacity={0.4}
        mb={4}
      />
      <Text fontSize="lg" color="fg.muted" fontWeight="500" fontFamily="mono">
        Nothing here yet
      </Text>
      <Text fontSize="sm" color="fg.muted" opacity={0.7} mt={2} mb={6}>
        Create something awesome
      </Text>
      <CreateMenu currentPath={currentPath} variant="button" />
    </Box>
  );
}

/**
 * Get custom empty state message and icon for system folders
 */
function getSystemFolderEmptyState(path: string, mode: Mode): { message: string; icon: IconType } | null {
  const systemFolderStates: Record<string, { message: string; icon: IconType }> = {
    [resolvePath(mode, SYSTEM_FOLDERS.database)]: { message: 'No databases yet', icon: LuDatabase },
    [resolvePath(mode, SYSTEM_FOLDERS.configs)]: { message: 'No configurations yet', icon: LuSettings },
    [resolvePath(mode, SYSTEM_FOLDERS.logs)]: { message: 'No logs yet', icon: LuFileText },
    [resolvePath(mode, SYSTEM_FOLDERS.logsConversations)]: { message: 'No conversations yet', icon: LuMessageSquare },
    [resolvePath(mode, SYSTEM_FOLDERS.recordings)]: { message: 'No recordings yet', icon: LuVideo },
    [resolvePath(mode, SYSTEM_FOLDERS.config)]: { message: 'No configurations yet', icon: LuSettings },
  };
  return systemFolderStates[path] || null;
}

function DatabaseFolderNote() {
  return (
    <HStack
      mb={5}
      px={3.5}
      py={2.5}
      borderRadius="lg"
      bg="accent.teal/8"
      border="1px solid"
      borderColor="accent.teal/20"
      gap={2.5}
      fontSize="sm"
      color="fg.muted"
    >
      <Box
        as={LuFileSpreadsheet}
        boxSize={4}
        flexShrink={0}
        color="accent.teal"
      />
      <Text lineHeight="tall">
        All uploaded{' '}
        <Box
          as="span"
          fontFamily="mono"
          fontWeight="600"
          color="accent.teal"
          px={1}
          py={0.5}
          borderRadius="sm"
          bg="accent.teal/10"
        >
          CSV
        </Box>
        /
        <Box
          as="span"
          fontFamily="mono"
          fontWeight="600"
          color="accent.teal"
          px={1}
          py={0.5}
          borderRadius="sm"
          bg="accent.teal/10"
        >
          XLSX
        </Box>{' '}
        files live under the{' '}
        <Box
          as="span"
          fontFamily="mono"
          fontWeight="600"
          color="accent.teal"
          px={1}
          py={0.5}
          borderRadius="sm"
          bg="accent.teal/10"
        >
          static
        </Box>{' '}
        connection.
      </Text>
    </HStack>
  );
}

export interface FolderViewProps {
  path: string;
  title: string;
  type?: FileType;  // Optional filter by type
  headerRight?: ReactNode;  // Content to show on the right of the header
  showAnalytics?: boolean;  // Show analytics panel alongside file list
}

export default function FolderView({ path, title, type, headerRight, showAnalytics }: FolderViewProps) {
  // Get user mode for system folder detection
  const user = useAppSelector(state => state.auth.user);
  const mode = user?.mode || DEFAULT_MODE;
  const isThisSystemFolder = isSystemFolder(path, mode);

  // Load folder contents using useFolder hook (no useEffect in component!)
  // Note: useFolder automatically filters files based on user permissions
  // Cache TTL (10 hours) + path dependency handles reloads automatically
  const { files: allFiles, loading, error } = useFolder(path);

  // Filter by type if specified (client-side filtering)
  // In system folders, hide context (Knowledge Base) files — they can't be created there
  const files = (() => {
    let result = type ? allFiles.filter(f => f.type === type) : allFiles;
    if (isThisSystemFolder) result = result.filter(f => f.type !== 'context');
    return result;
  })();

  // Loading state
  if (loading) {
    return (
      <Box display="flex" alignItems="center" justifyContent="center" minH="400px">
        <Spinner size="lg" colorScheme="blue" />
      </Box>
    );
  }

  // Error state
  if (error) {
    return (
      <Box>
        <Heading
          fontSize={{ base: '3xl', md: '4xl', lg: '5xl' }}
          fontWeight="900"
          letterSpacing="-0.03em"
          mt={2}
          mb={2}
          color="fg.default"
        >
          {title}
        </Heading>
        <Text fontSize="lg" color="accent.danger" fontWeight="semibold" mt={4}>
          Failed to load folder
        </Text>
        <Text fontSize="sm" color="fg.muted" mt={2}>
          {error.message}
        </Text>
      </Box>
    );
  }

  // Calculate counts
  const fileCount = files.filter(f => f.type !== 'folder').length;
  const folderCount = files.filter(f => f.type === 'folder').length;
  const showDatabaseFolderNote = path === resolvePath(mode, SYSTEM_FOLDERS.database);

  return (
    <Box>
      {/* Folder header */}
      <HStack justify="space-between" align="flex-start" mt={10} mb={2}>
        <Heading
          fontSize={{ base: '3xl', md: '4xl', lg: '5xl' }}
          fontWeight="900"
          letterSpacing="-0.03em"
          color="fg.default"
        >
          {title}
        </Heading>
        {headerRight}
      </HStack>

      {/* Stats + Reload */}
      <HStack mb={6} mt={2} gap={2} align="center">
        <Text fontSize="xs" color="fg.subtle" fontFamily="mono">
          {fileCount} {fileCount === 1 ? 'file' : 'files'}
          <Box as="span" mx={3} display="inline-flex" alignItems="center" justifyContent="center" aria-hidden>
            <Box as="span" w="5px" h="5px" bg="accent.teal" borderRadius="50%" />
          </Box>
          {folderCount} {folderCount === 1 ? 'folder' : 'folders'}
        </Text>
        <Tooltip content="Reload folder" positioning={{ placement: 'bottom' }}>
          <IconButton
            variant="ghost"
            size="xs"
            aria-label="Reload folder"
            onClick={() => readFolder(path, { forceLoad: true }).catch(() => {})}
            color="fg.muted"
            _hover={{ bg: 'bg.muted', color: 'fg.default' }}
            borderRadius="md"
          >
            <LuRefreshCw />
          </IconButton>
        </Tooltip>
      </HStack>

      {showDatabaseFolderNote && <DatabaseFolderNote />}

      {/* Getting Started Section - only show in tutorial/demo mode */}
      {!isThisSystemFolder && mode === 'tutorial' && <GettingStartedSection />}

      {/* File list (with optional analytics right column) */}
      <Flex gap={6} align="flex-start">
        {/* File list or empty state */}
        <Box flex="1" minW={0}>
          {files.length > 0 ? (
            <FilesList files={files as any} />
          ) : (() => {
            // System folders use their own empty state
            const systemState = getSystemFolderEmptyState(path, mode);
            if (systemState) {
              return (
                <Box
                  display="flex"
                  flexDirection="column"
                  alignItems="center"
                  justifyContent="center"
                  minH="60vh"
                  px={8}
                >
                  <Box
                    as={systemState.icon}
                    fontSize="6xl"
                    color="fg.muted"
                    opacity={0.4}
                    mb={4}
                  />
                  <Text fontSize="lg" color="fg.muted" fontWeight="500" fontFamily="mono">
                    {systemState.message}
                  </Text>
                </Box>
              );
            }

            // Non-system folders: default empty state
            return <DefaultEmptyState currentPath={path} />;
          })()}
        </Box>

        {showAnalytics && <RecentFilesSection />}
      </Flex>

    </Box>
  );
}
