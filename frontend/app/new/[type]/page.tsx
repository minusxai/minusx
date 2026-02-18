'use client';

import { use, useMemo, useState } from 'react';
import { Center, Text, Box, Spinner } from '@chakra-ui/react';
import FileLayout from '@/components/FileLayout';
import FileView from '@/components/FileView';
import { SUPPORTED_FILE_TYPES, FileType } from '@/lib/ui/file-metadata';
import { useAppSelector } from '@/store/hooks';
import { useAppState, useFile } from '@/lib/hooks/file-state-hooks';
import { RightSidebarProps } from "@/components/RightSidebar";
import { ContextContent } from '@/lib/types';

interface NewFilePageProps {
  params: Promise<{ type: string }>;
}

export default function NewFilePage({ params }: NewFilePageProps) {
  // Unwrap params Promise (Next.js 16 requirement)
  const { type: typeParam } = use(params);
  const type = typeParam as FileType;
  const user = useAppSelector(state => state.auth.user);

  // Validate type is supported
  const isValidType = SUPPORTED_FILE_TYPES.includes(type);

  // Get app state (creates virtual file with URL params automatically)
  const { appState, loading: appStateLoading } = useAppState();
  const virtualFileId = appState?.type === 'file' ? appState.id : undefined;

  // Load the virtual file
  const { file, loading, error } = useFile(virtualFileId);

  // Context version selection (admin only)
  const filesState = useAppSelector(state => state.files.files);
  const [selectedVersion, setSelectedVersion] = useState<number | undefined>(undefined);

  // Compute context for the folder path
  const currentContext = useMemo(() => {
    if (!file?.path) return null;

    // Extract parent path from file path
    const pathParts = file.path.split('/');
    pathParts.pop(); // Remove filename
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
  }, [filesState, file?.path]);

  // Check if we should show context selector (admin only)
  const shouldShowContextSelector = user?.role === 'admin';

  // Determine file name
  const fileName = file?.name || '';

  // Extract folder from file path
  const folder = useMemo(() => {
    if (!file?.path) return '/org';
    const pathParts = file.path.split('/');
    pathParts.pop(); // Remove filename
    return pathParts.join('/') || '/';
  }, [file?.path]);

  // Sidebar config based on type - separate useMemo with appState dependency
  const rightSidebar = useMemo(() => {
    const config: RightSidebarProps = {
      filePath: file?.path || '/org',  // Use file's path if available, so selector finds covering context
      title: `${type} Context`,
      showChat: false,
      contextVersion: selectedVersion,
      selectedContextPath: currentContext?.path || null,
      onContextChange: shouldShowContextSelector ? (_path: string | null, version?: number) => {
        setSelectedVersion(version);
      } : undefined,
    };

    if (type === 'question' || type === 'dashboard' || type === 'report' || type === 'alert') {
      config.showChat = true;
    }

    return config;
  }, [type, file?.path, selectedVersion, currentContext?.path, shouldShowContextSelector]);

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

  // Show loading while initializing virtual file
  if (appStateLoading || !virtualFileId) {
    return (
      <Center h="100vh" bg="bg.canvas">
        <Spinner size="lg" />
      </Center>
    );
  }

  return (
    <FileLayout
      filePath={folder}
      fileName={fileName}
      fileType={type}
      rightSidebar={rightSidebar}
    >
      <FileView fileId={virtualFileId!} mode="create" defaultFolder={folder} />
    </FileLayout>
  );
}
