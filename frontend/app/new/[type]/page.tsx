'use client';

import { use, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Center, Text, Box } from '@chakra-ui/react';
import FileLayout from '@/components/FileLayout';
import FileView from '@/components/FileView';
import { SUPPORTED_FILE_TYPES, FileType } from '@/lib/ui/file-metadata';
import { useAppSelector } from '@/store/hooks';
import { useNewFile } from '@/lib/hooks/useNewFile';
import { RightSidebarProps } from "@/components/RightSidebar";
import { selectAppState } from '@/lib/appState';
import { useFile } from '@/lib/hooks/useFile';
import { resolveHomeFolderSync } from '@/lib/mode/path-resolver';
import { ContextContent } from '@/lib/types';

interface NewFilePageProps {
  params: Promise<{ type: string }>;
}

export default function NewFilePage({ params }: NewFilePageProps) {
  const searchParams = useSearchParams();
  const user = useAppSelector(state => state.auth.user);

  // Unwrap params Promise (Next.js 16 requirement)
  const { type: typeParam } = use(params);
  const type = typeParam as FileType;
  const folderParam = searchParams.get('folder');
  const databaseName = searchParams.get('databaseName');
  const queryB64 = searchParams.get('queryB64');
  const queryRaw = searchParams.get('query');
  // Support base64-encoded query (queryB64) for safe URL transport, fall back to plain query
  const query = queryB64
    ? new TextDecoder().decode(Uint8Array.from(atob(queryB64), c => c.charCodeAt(0)))
    : queryRaw;
  const virtualIdParam = searchParams.get('virtualId');

  // Validate type is supported
  const isValidType = SUPPORTED_FILE_TYPES.includes(type);

  // Determine folder path (resolve home_folder with mode)
  const folder = useMemo(() => {
    if (folderParam) return folderParam;
    if (!user) return '/org';
    return resolveHomeFolderSync(user.mode, user.home_folder || '');
  }, [folderParam, user]);

  // Parse virtualId from URL (used by Navigate tool to coordinate)
  const virtualId = useMemo(() => {
    if (virtualIdParam) {
      const parsed = parseInt(virtualIdParam, 10);
      if (!isNaN(parsed) && parsed < 0) return parsed;
    }
    return undefined;
  }, [virtualIdParam]);

  // Create virtual file using hook
  const virtualFileId = useNewFile(type, {
    folder,
    databaseName: databaseName || undefined,
    query: query || undefined,
    virtualId
  });
  const { file, loading, error } = useFile(virtualFileId);
  const appState = useAppSelector(state => selectAppState(state, virtualFileId));

  // Context version selection (admin only)
  const filesState = useAppSelector(state => state.files.files);
  const [selectedVersion, setSelectedVersion] = useState<number | undefined>(undefined);

  // Compute context for the folder path
  const currentContext = useMemo(() => {
    const targetPath = file?.path || folder;

    // Extract parent path (for files) or use folder directly
    const pathParts = targetPath.split('/');
    if (file?.path) pathParts.pop(); // Remove filename if we have a file path
    const parentPath = pathParts.join('/') || '/';

    const contextFile = Object.values(filesState).find(f => {
      if (f.type !== 'context' || f.id <= 0) return false;
      const contextDir = f.path.substring(0, f.path.lastIndexOf('/')) || '/';
      return parentPath.startsWith(contextDir + '/') || parentPath === contextDir;
    });

    if (!contextFile) return null;

    return {
      id: contextFile.id,
      name: contextFile.name,
      path: contextFile.path,
      content: contextFile.content as ContextContent
    };
  }, [filesState, file?.path, folder]);

  // Check if we should show context selector (admin only)
  const shouldShowContextSelector = user?.role === 'admin';

  // Show error for invalid type
  if (!isValidType) {
    return (
      <Center h="100vh" bg="bg.canvas">
        <Box textAlign="center">
          <Text fontSize="xl" fontWeight="bold" mb={2}>
            Invalid File Type
          </Text>
          <Text color="fg.muted">
            The file type "{type}" is not supported.
          </Text>
        </Box>
      </Center>
    );
  }

  // Determine file name
  const fileName = file?.name || '';

  // Sidebar config based on type - separate useMemo with appState dependency
  const rightSidebar = useMemo(() => {
    const config: RightSidebarProps = {
      appState: appState,
      filePath: file?.path || folder,  // Use file's path if available, so selector finds covering context
      title: `${type} Context`,
      showChat: false,
      contextVersion: selectedVersion,
      selectedContextPath: currentContext?.path || null,
      onContextChange: shouldShowContextSelector ? (_path: string | null, version?: number) => {
        setSelectedVersion(version);
      } : undefined,
    };

    if (type === 'question' || type === 'dashboard' || type === 'report') {
      config.showChat = true;
    }

    return config;
  }, [type, folder, appState, virtualFileId, file?.path, selectedVersion, currentContext?.path, shouldShowContextSelector]);

  return (
    <FileLayout
      filePath={folder}
      fileName={fileName}
      fileType={type}
      rightSidebar={rightSidebar}
    >
      <FileView fileId={virtualFileId} mode="create" defaultFolder={folder} />
    </FileLayout>
  );
}
