'use client';

import { useState, useEffect } from 'react';
import { Dialog, Button, VStack, HStack, Text, Box, Portal } from '@chakra-ui/react';
import { SelectRoot, SelectTrigger, SelectContent, SelectItem, SelectValueText } from '@/components/ui/select';
import { createListCollection } from '@chakra-ui/react';
import { moveFile } from '@/lib/api/file-state';
import { useFilesByCriteria } from '@/lib/hooks/file-state-hooks';
import { isUnderSystemFolder } from '@/lib/mode/path-resolver';
import { useAppSelector } from '@/store/hooks';

interface MoveFileModalProps {
  isOpen: boolean;
  onClose: () => void;
  fileId: number;
  fileName: string;
  filePath: string;
}

export default function MoveFileModal({ isOpen, onClose, fileId, fileName, filePath }: MoveFileModalProps) {
  const mode = useAppSelector(state => state.auth.user?.mode ?? 'org');
  const currentParent = filePath.split('/').slice(0, -1).join('/') || '/';
  const [destFolder, setDestFolder] = useState(currentParent);
  const [isMoving, setIsMoving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { files: folderFiles } = useFilesByCriteria({
    criteria: { type: 'folder' },
    skip: !isOpen,
    partial: true,
  });

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
    return Array.from(paths).sort();
  })();

  useEffect(() => {
    if (isOpen) {
      setDestFolder(currentParent);
      setError(null);
    }
  }, [isOpen, currentParent]);

  const handleMove = async () => {
    if (!destFolder) {
      setError('Please select a destination folder');
      return;
    }
    if (destFolder === currentParent) {
      setError('File is already in this folder');
      return;
    }
    try {
      setIsMoving(true);
      setError(null);
      await moveFile(fileId, fileName, `${destFolder}/${fileName}`);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to move file');
    } finally {
      setIsMoving(false);
    }
  };

  const handleClose = () => {
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
        <Dialog.Content maxW="500px" p={6} borderRadius="lg" bg="bg.surface">
          <Dialog.Header>
            <Dialog.Title fontSize="xl" fontWeight="bold">Move File</Dialog.Title>
          </Dialog.Header>

          <Dialog.Body>
            <VStack align="stretch" gap={4}>
              {error && (
                <Box p={3} bg="accent.danger" _dark={{ bg: 'accent.danger/20' }} borderRadius="md">
                  <Text color="accent.danger" fontSize="sm">{error}</Text>
                </Box>
              )}

              <Box>
                <Text fontSize="sm" fontWeight="medium" mb={1}>File</Text>
                <Text fontSize="sm" color="fg.muted" fontFamily="mono">{filePath}</Text>
              </Box>

              <Box>
                <Text fontSize="sm" fontWeight="medium" mb={2}>Destination Folder</Text>
                <SelectRoot
                  collection={pathOptions}
                  value={[destFolder]}
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
              <Button variant="ghost" onClick={handleClose}>Cancel</Button>
              <Button
                onClick={handleMove}
                disabled={isMoving || !destFolder || destFolder === currentParent}
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
