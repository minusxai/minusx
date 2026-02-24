'use client';

import { use, useState, useMemo, useEffect } from 'react';
import { Box, Spinner, Center, Text } from '@chakra-ui/react';
import FileLayout from '@/components/FileLayout';
import FileView from '@/components/FileView';
import { useFile } from '@/lib/hooks/file-state-hooks';
import { parseFileId } from '@/lib/slug-utils';
import { useAppSelector } from '@/store/hooks';
import FileNotFound from '@/components/FileNotFound';
import { ContextContent } from '@/lib/types';
import { resolveHomeFolderSync } from '@/lib/mode/path-resolver';

interface FilePageProps {
  params: Promise<{ id: string }>;
}

export default function FilePage({ params }: FilePageProps) {
  // Unwrap params Promise (Next.js 16 requirement)
  const { id } = use(params);

  // Parse file ID from URL (supports "1" or "1-sales-dashboard")
  const { intId } = parseFileId(id);

  // Load file using client-side hook
  const { fileState: file } = useFile(intId) ?? {};

  // Context version selection (admin only)
  const user = useAppSelector(state => state.auth.user);

  // ALL HOOKS MUST BE BEFORE EARLY RETURNS
  const filesState = useAppSelector(state => state.files.files);
  const [selectedVersion, setSelectedVersion] = useState<number | undefined>(undefined);

  // Compute context while handling file being undefined (before early returns)
  const currentContext = useMemo(() => {
    if (!file) return null;

    // Extract parent path from file.path (remove filename)
    const pathParts = file.path.split('/');
    pathParts.pop();
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
  }, [filesState, file]);

  // Show full-page spinner only on first-ever load (no cached metadata yet).
  // When file has metadata from a folder listing (updatedAt > 0), render the layout
  // normally — FileView will show the header + a content-area spinner while content loads.
  if (!file || (file.loading && file.updatedAt === 0)) {
    return (
      <Center h="100vh" bg="bg.canvas">
        <Spinner size="xl" color="primary" />
      </Center>
    );
  }

  // Show error state
  if (file?.loadError || !file) {
    return (
      <FileNotFound/>
    );
  }

  // Extract parent path from file.path (now safe, after error check)
  const pathParts = file.path.split('/');
  pathParts.pop(); // Remove filename
  const parentPath = pathParts.join('/') || '/';

  // Check if we should show context selector (admin only)
  const shouldShowContextSelector = user?.role === 'admin';

  // Right sidebar config
  const rightSidebar = {
    showChat: true,
    filePath: file.path,  // Use file's actual path so selector can find covering context
    title: `${file.type} Context`,
    fileId: file.id,
    fileType: file.type,
    contextVersion: selectedVersion,  // Pass selected context version for admin testing
    selectedContextPath: currentContext?.path || null,
    onContextChange: shouldShowContextSelector ? (_path: string | null, version?: number) => {
      setSelectedVersion(version);
    } : undefined
  };

  return (
    <FileLayout
      filePath={parentPath}
      fileName={file.name}
      fileType={file.type}
      fileId={intId}
      rightSidebar={rightSidebar}
    >
      <FileView fileId={intId} mode="view" />
    </FileLayout>
  );
}
