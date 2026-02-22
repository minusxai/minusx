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
import { type FileId } from '@/store/filesSlice';

export interface FileViewProps {
  fileId: FileId;
  mode?: 'view' | 'create';
  defaultFolder?: string;
}

export default function FileView({ fileId, mode = 'view', defaultFolder }: FileViewProps) {
  // Load file using useFile hook (no useEffect in component!)
  const { fileState: file } = useFile(fileId) ?? {};

  // Loading state
  if (!file || file.loading) {
    return (
      <Box display="flex" alignItems="center" justifyContent="center" minH="400px">
        <Spinner size="lg" colorScheme="blue" />
      </Box>
    );
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

  // Render file-specific component
  return (
    <Component
      fileId={fileId}
      mode={mode}
      defaultFolder={defaultFolder}
    />
  );
}
