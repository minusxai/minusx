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
 * - Show progressive onboarding via GettingStartedV2
 */
import { Box, Heading, Text, Spinner, HStack } from '@chakra-ui/react';
import {
  LuDatabase,
  LuSettings,
  LuFileText,
  LuMessageSquare,
  LuSparkles,
  LuVideo,
} from 'react-icons/lu';
import type { IconType } from 'react-icons';
import { useFolder } from '@/lib/hooks/useFolder';
import FilesList from './FilesList';
import GettingStartedSection from './GettingStartedSection';
import GettingStartedV2, { DefaultEmptyState } from './GettingStartedV2';
import type { FileType } from '@/lib/types';
import type { ReactNode } from 'react';
import { useAppSelector } from '@/store/hooks';
import { isSystemFolder, SYSTEM_FOLDERS, resolvePath } from '@/lib/mode/path-resolver';
import { DEFAULT_MODE, Mode } from '@/lib/mode/mode-types';

/**
 * Get custom empty state message and icon for system folders
 */
function getSystemFolderEmptyState(path: string, mode: Mode): { message: string; icon: IconType } | null {
  const systemFolderStates: Record<string, { message: string; icon: IconType }> = {
    [resolvePath(mode, SYSTEM_FOLDERS.database)]: { message: 'No databases yet', icon: LuDatabase },
    [resolvePath(mode, SYSTEM_FOLDERS.configs)]: { message: 'No configurations yet', icon: LuSettings },
    [resolvePath(mode, SYSTEM_FOLDERS.logs)]: { message: 'No logs yet', icon: LuFileText },
    [resolvePath(mode, SYSTEM_FOLDERS.logsConversations)]: { message: 'No conversations yet', icon: LuMessageSquare },
    [resolvePath(mode, SYSTEM_FOLDERS.logsLlmCalls)]: { message: 'No LLM calls yet', icon: LuSparkles },
    [resolvePath(mode, SYSTEM_FOLDERS.recordings)]: { message: 'No recordings yet', icon: LuVideo },
    [resolvePath(mode, SYSTEM_FOLDERS.config)]: { message: 'No configurations yet', icon: LuSettings },
  };
  return systemFolderStates[path] || null;
}

export interface FolderViewProps {
  path: string;
  title: string;
  type?: FileType;  // Optional filter by type
  headerRight?: ReactNode;  // Content to show on the right of the header
}

export default function FolderView({ path, title, type, headerRight }: FolderViewProps) {
  // Get user mode for system folder detection
  const user = useAppSelector(state => state.auth.user);
  const mode = user?.mode || DEFAULT_MODE;
  const isThisSystemFolder = isSystemFolder(path, mode);

  // Load folder contents using useFolder hook (no useEffect in component!)
  // Note: useFolder automatically filters files based on user permissions
  // Cache TTL (10 hours) + path dependency handles reloads automatically
  const { files: allFiles, loading, error } = useFolder(path);

  // Filter by type if specified (client-side filtering)
  const files = type ? allFiles.filter(f => f.type === type) : allFiles;

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

      {/* Stats */}
      <Text
        fontSize="lg"
        color="fg.muted"
        mb={6}
        mt={4}
        fontFamily="mono"
      >
        {fileCount} {fileCount === 1 ? 'file' : 'files'}
        <Box as="span" mx={3} display="inline-flex" alignItems="center" justifyContent="center" aria-hidden>
          <Box as="span" w="5px" h="5px" bg="accent.teal" borderRadius="50%" />
        </Box>
        {folderCount} {folderCount === 1 ? 'folder' : 'folders'}
      </Text>

      {/* Getting Started Section - only show in tutorial/demo mode */}
      {!isThisSystemFolder && mode === 'tutorial' && <GettingStartedSection />}

      {/* Progressive onboarding banner - show above files in org mode */}
      {!isThisSystemFolder && mode !== 'tutorial' && files.length > 0 && (
        <GettingStartedV2 variant="banner" />
      )}

      {/* File list or empty state */}
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

        // Non-system folders use progressive onboarding with fallback to default empty state
        return (
          <GettingStartedV2
            variant="empty"
            fallback={<DefaultEmptyState currentPath={path} />}
          />
        );
      })()}
    </Box>
  );
}
