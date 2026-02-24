'use client';

/**
 * FileView Component - Phase 2 Implementation
 * Generic file renderer that uses type → component mapping
 *
 * Responsibilities:
 * - Load file using useFile hook (with automatic reference loading)
 * - Handle loading, error, and not-found states
 * - Delegate to type-specific component via mapping
 * - Support virtual files (string IDs) for create mode
 */
import { Box, Spinner, Text } from '@chakra-ui/react';
import { useFile } from '@/lib/hooks/file-state-hooks';
import { getFileComponent, hasFileComponent } from '@/lib/ui/fileComponents';
import { isSystemFileType, type FileType } from '@/lib/ui/file-metadata';
import { type FileId } from '@/store/filesSlice';
import FileHeader from './FileHeader';

export interface FileViewProps {
  fileId: FileId;
  mode?: 'view' | 'create';
  defaultFolder?: string;
  /** When true, suppresses FileHeader (e.g., PublishModal preview pane is read-only). */
  hideHeader?: boolean;
}

export default function FileView({ fileId, mode = 'view', defaultFolder, hideHeader }: FileViewProps) {
  // Load file using useFile hook (no useEffect in component!)
  const { fileState: file } = useFile(fileId) ?? {};

  // Loading state
  if (!file || file.loading) {
    const spinner = (
      <Box display="flex" alignItems="center" justifyContent="center" minH="400px">
        <Spinner size="lg" colorScheme="blue" />
      </Box>
    );

    // If we've loaded this file before (updatedAt > 0), the type is real — show the header
    // while content reloads so it doesn't flash away. On first load (placeholder, updatedAt=0),
    // fall through to full-page spinner.
    const canShowHeader = !hideHeader
      && file && file.updatedAt > 0
      && typeof fileId === 'number'
      && !isSystemFileType(file.type as FileType);

    if (canShowHeader) {
      return (
        <>
          <Box px={3} pt={3} pb={0} borderBottomWidth="1px" borderColor="border.muted">
            <FileHeader fileId={fileId as number} fileType={file.type} mode={mode} />
          </Box>
          {spinner}
        </>
      );
    }

    return spinner;
  }

  // Error state
  if (file?.loadError) {
    return (
      <Box p={8}>
        <Text fontSize="lg" color="accent.danger" fontWeight="semibold">
          Failed to load file
        </Text>
        <Text fontSize="sm" color="fg.muted" mt={2}>
          {file.loadError.message}
        </Text>
      </Box>
    );
  }

  // Not found state (file is a placeholder but no content — shouldn't normally reach here)
  if (!file) {
    return (
      <Box p={8}>
        <Text fontSize="lg" fontWeight="semibold">
          File not found
        </Text>
        <Text fontSize="sm" color="fg.muted" mt={2}>
          The file with ID {fileId} does not exist or you don't have permission to access it.
        </Text>
      </Box>
    );
  }

  // Check if component exists for this file type
  if (!hasFileComponent(file.type)) {
    return (
      <Box p={8}>
        <Text fontSize="lg" fontWeight="semibold">
          Unsupported file type
        </Text>
        <Text fontSize="sm" color="fg.muted" mt={2}>
          No viewer available for file type: <Text as="span" fontFamily="mono">{file.type}</Text>
        </Text>
        <Text fontSize="sm" color="fg.muted" mt={2}>
          Supported types: question, dashboard, presentation
        </Text>
      </Box>
    );
  }

  // Get component for file type
  const Component = getFileComponent(file.type);

  if (!Component) {
    // This should never happen if hasFileComponent returned true
    return (
      <Box p={8}>
        <Text fontSize="lg" color="accent.danger" fontWeight="semibold">
          Internal error: Component not found
        </Text>
      </Box>
    );
  }

  // Render common header for user files (non-system types with a numeric fileId)
  const showFileHeader = !hideHeader && typeof fileId === 'number' && !isSystemFileType(file.type as FileType);

  // Render file-specific component
  return (
    <>
      {showFileHeader && (
        <Box px={3} pt={3} pb={0} borderBottomWidth="1px" borderColor="border.muted">
          <FileHeader fileId={fileId as number} fileType={file.type} mode={mode} />
        </Box>
      )}
      <Component
        fileId={fileId}
        mode={mode}
        defaultFolder={defaultFolder}
      />
    </>
  );
}
