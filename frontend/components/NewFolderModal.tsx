'use client';

import { useState, useEffect } from 'react';
import { Dialog, Input, Button, VStack, HStack, Text, Box } from '@chakra-ui/react';
import { useRouter } from '@/lib/navigation/use-navigation';
import { SelectRoot, SelectTrigger, SelectContent, SelectItem, SelectValueText } from '@/components/ui/select';
import { createListCollection } from '@chakra-ui/react';
import { createFolder } from '@/lib/api/file-state';
import { useFilesByCriteria } from '@/lib/hooks/file-state-hooks';

interface NewFolderModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultParentPath?: string;
}

export default function NewFolderModal({ isOpen, onClose, defaultParentPath = '/' }: NewFolderModalProps) {
  const router = useRouter();
  const [folderName, setFolderName] = useState('');
  const [parentPath, setParentPath] = useState(defaultParentPath);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load folders using centralized hook
  const { files: folderFiles } = useFilesByCriteria({
    criteria: { type: 'folder' },
    skip: !isOpen,
  });

  // Extract unique folder paths from loaded files
  const folders = (() => {
    const paths = new Set<string>();
    paths.add('/'); // Always include root

    folderFiles.forEach(file => {
      paths.add(file.path);
      // Also add parent directories
      const pathParts = file.path.split('/').filter(Boolean);
      for (let i = 1; i <= pathParts.length - 1; i++) {
        paths.add('/' + pathParts.slice(0, i).join('/'));
      }
    });

    return Array.from(paths).sort();
  })();

  // Update parent path when defaultParentPath changes
  useEffect(() => {
    if (isOpen) {
      setParentPath(defaultParentPath);
    }
  }, [isOpen, defaultParentPath]);

  const handleCreate = async () => {
    if (!folderName.trim()) {
      setError('Folder name is required');
      return;
    }

    try {
      setIsCreating(true);
      setError(null);

      // Use centralized createFolder function from file-state.ts
      const result = await createFolder(folderName.trim(), parentPath);

      // Close modal and navigate to new folder
      onClose();
      setFolderName('');
      setError(null);
      router.push(`/p${result.path}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create folder');
    } finally {
      setIsCreating(false);
    }
  };

  const handleClose = () => {
    setFolderName('');
    setError(null);
    onClose();
  };

  const pathOptions = createListCollection({
    items: folders.map(path => ({ label: path, value: path }))
  });

  return (
    <Dialog.Root open={isOpen} onOpenChange={(e) => !e.open && handleClose()}>
      <Dialog.Backdrop />
      <Dialog.Positioner>
        <Dialog.Content
          maxW="500px"
          p={6}
          borderRadius="lg"
          bg="bg.surface"
        >
          <Dialog.Header>
            <Dialog.Title fontSize="xl" fontWeight="bold">Create New Folder</Dialog.Title>
          </Dialog.Header>

          <Dialog.Body>
            <VStack align="stretch" gap={4}>
              {error && (
                <Box p={3} bg="accent.danger" _dark={{ bg: 'accent.danger/20' }} borderRadius="md">
                  <Text color="accent.danger" _dark={{ color: 'accent.danger' }} fontSize="sm">
                    {error}
                  </Text>
                </Box>
              )}

              <Box>
                <Text fontSize="sm" fontWeight="medium" mb={2}>Folder Name</Text>
                <Input
                  placeholder="Enter folder name"
                  value={folderName}
                  onChange={(e) => setFolderName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      handleCreate();
                    }
                  }}
                  autoFocus
                />
              </Box>

              <Box>
                <Text fontSize="sm" fontWeight="medium" mb={2}>Parent Path</Text>
                <SelectRoot
                  collection={pathOptions}
                  value={[parentPath]}
                  onValueChange={(e) => setParentPath(e.value[0])}
                >
                  <SelectTrigger>
                    <SelectValueText placeholder="Select parent path" />
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
              <Button variant="ghost" onClick={handleClose}>
                Cancel
              </Button>
              <Button
                onClick={handleCreate}
                disabled={isCreating || !folderName.trim()}
                loading={isCreating}
                bg="accent.teal"
                color="white"
                _hover={{ bg: 'accent.teal', opacity: 0.9 }}
              >
                Create
              </Button>
            </HStack>
          </Dialog.Footer>

          <Dialog.CloseTrigger />
        </Dialog.Content>
      </Dialog.Positioner>
    </Dialog.Root>
  );
}
