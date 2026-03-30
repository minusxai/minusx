'use client';

import { useState, useEffect } from 'react';
import { Dialog, Button, VStack, HStack, Text, Box, Portal } from '@chakra-ui/react';
import { SelectRoot, SelectTrigger, SelectContent, SelectItem, SelectValueText } from '@/components/ui/select';
import { createListCollection } from '@chakra-ui/react';
import { batchMoveFiles } from '@/lib/api/file-state';
import { useFilesByCriteria } from '@/lib/hooks/file-state-hooks';
import { isUnderSystemFolder } from '@/lib/mode/path-resolver';
import { useAppSelector } from '@/store/hooks';

interface BulkMoveFile {
  id: number;
  name: string;
  path: string;
  type: string;
}

interface BulkMoveFileModalProps {
  isOpen: boolean;
  onClose: () => void;
  files: BulkMoveFile[];
}

export default function BulkMoveFileModal({ isOpen, onClose, files }: BulkMoveFileModalProps) {
  const mode = useAppSelector(state => state.auth.user?.mode ?? 'org');
  const [destFolder, setDestFolder] = useState('');
  const [isMoving, setIsMoving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { files: folderFiles } = useFilesByCriteria({
    criteria: { type: 'folder' },
    skip: !isOpen,
    partial: true,
  });

  // Collect all parent folders of selected files
  const selectedParents = new Set(files.map(f => f.path.split('/').slice(0, -1).join('/') || '/'));
  // Collect paths of selected folders (to exclude them and descendants as destinations)
  const selectedFolderPaths = new Set(files.filter(f => f.type === 'folder').map(f => f.path));

  const folders = (() => {
    const paths = new Set<string>();
    folderFiles.forEach(file => {
      if (isUnderSystemFolder(file.path, mode)) return;
      paths.add(file.path);
      const pathParts = file.path.split('/').filter(Boolean);
      for (let i = 1; i <= pathParts.length - 1; i++) {
        const parent = '/' + pathParts.slice(0, i).join('/');
        if (!isUnderSystemFolder(parent, mode)) {
          paths.add(parent);
        }
      }
    });
    return Array.from(paths)
      .filter(p => {
        // Exclude any selected folder or its descendants
        for (const fp of selectedFolderPaths) {
          if (p === fp || p.startsWith(fp + '/')) return false;
        }
        return true;
      })
      .sort();
  })();

  useEffect(() => {
    if (isOpen) {
      setDestFolder('');
      setError(null);
    }
  }, [isOpen]);

  const handleMove = async () => {
    if (!destFolder) {
      setError('Please select a destination folder');
      return;
    }
    try {
      setIsMoving(true);
      setError(null);
      await batchMoveFiles(
        files.map(f => ({ id: f.id, name: f.name })),
        destFolder
      );
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to move files');
    } finally {
      setIsMoving(false);
    }
  };

  const handleClose = () => {
    if (isMoving) return;
    setError(null);
    onClose();
  };

  const pathOptions = createListCollection({
    items: folders.map(path => ({ label: path, value: path }))
  });

  return (
    <Dialog.Root open={isOpen} onOpenChange={(e) => !e.open && handleClose()}>
      <Portal>
      <Dialog.Backdrop />
      <Dialog.Positioner>
        <Dialog.Content maxW="500px" p={6} borderRadius="lg" bg="bg.surface" aria-label="Move files modal">
          <Dialog.Header>
            <Dialog.Title fontSize="xl" fontWeight="bold">Move {files.length} file{files.length !== 1 ? 's' : ''}</Dialog.Title>
          </Dialog.Header>

          <Dialog.Body>
            <VStack align="stretch" gap={4}>
              {error && (
                <Box p={3} bg="accent.danger" _dark={{ bg: 'accent.danger/20' }} borderRadius="md">
                  <Text color="accent.danger" fontSize="sm">{error}</Text>
                </Box>
              )}

              <Box>
                <Text fontSize="sm" fontWeight="medium" mb={1}>Files</Text>
                <VStack align="stretch" gap={0.5} maxH="150px" overflowY="auto">
                  {files.map(f => (
                    <Text key={f.id} fontSize="xs" color="fg.muted" fontFamily="mono" truncate>
                      {f.path}
                    </Text>
                  ))}
                </VStack>
              </Box>

              <Box>
                <Text fontSize="sm" fontWeight="medium" mb={2}>Destination Folder</Text>
                <SelectRoot
                  collection={pathOptions}
                  value={destFolder ? [destFolder] : []}
                  onValueChange={(e) => setDestFolder(e.value[0])}
                >
                  <SelectTrigger>
                    <SelectValueText placeholder="Select destination folder" />
                  </SelectTrigger>
                  <SelectContent>
                    {folders.map((path) => (
                      <SelectItem key={path} item={path}>
                        {path}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </SelectRoot>
              </Box>

            </VStack>
          </Dialog.Body>

          <Dialog.Footer>
            <HStack gap={3} justify="flex-end">
              <Button variant="ghost" onClick={handleClose} disabled={isMoving}>Cancel</Button>
              <Button
                onClick={handleMove}
                disabled={isMoving || !destFolder}
                loading={isMoving}
                bg="accent.teal"
                color="white"
                _hover={{ bg: 'accent.teal', opacity: 0.9 }}
              >
                Move
              </Button>
            </HStack>
          </Dialog.Footer>

          <Dialog.CloseTrigger />
        </Dialog.Content>
      </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}
