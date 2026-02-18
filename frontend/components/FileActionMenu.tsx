'use client';

import { Box, IconButton, Menu, Portal, HStack, Icon, Button, Text, Dialog, CloseButton } from '@chakra-ui/react';
import { LuEllipsis, LuExternalLink, LuCopy, LuTrash2 } from 'react-icons/lu';
import { useRouter } from '@/lib/navigation/use-navigation';
import { useState } from 'react';
import { useAccessRules } from '@/lib/auth/access-rules.client';
import { FileType } from '@/lib/types';

interface FileActionMenuProps {
  fileId: number;
  fileName: string;
  filePath: string;
  fileType: FileType;
  size?: 'xs' | 'sm';
}

export default function FileActionMenu({ fileId, fileName, filePath, fileType, size = 'sm' }: FileActionMenuProps) {
  const router = useRouter();
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const { canDeleteFileType } = useAccessRules();
  const canDelete = canDeleteFileType(fileType);

  const handleDeleteClick = () => {
    setIsDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = async () => {
    try {
      const { deleteFile } = await import('@/lib/api/file-state');
      await deleteFile({ fileId });

      setIsDeleteDialogOpen(false);
      // Refresh the page to show updated list
      router.refresh();
    } catch (error) {
      console.error('Error deleting file:', error);
      setIsDeleteDialogOpen(false);
    }
  };
  return (
    <Box
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      <Menu.Root>
        <Menu.Trigger asChild>
          <IconButton
            variant="ghost"
            size={size}
            aria-label="More actions"
          >
            <LuEllipsis />
          </IconButton>
        </Menu.Trigger>
        <Portal>
          <Menu.Positioner>
          <Menu.Content
            minW="160px"
            bg="bg.surface"
            borderColor="border.default"
            shadow="lg"
            p={1}
          >
            {/* <Menu.Item
              value="open"
              cursor="pointer"
              borderRadius="sm"
              px={3}
              py={2}
              _hover={{ bg: 'bg.muted' }}
            >
              <HStack gap={2}>
                <Icon as={LuExternalLink} boxSize={4} />
                <span>Open</span>
              </HStack>
            </Menu.Item>
            <Menu.Item
              value="duplicate"
              cursor="pointer"
              borderRadius="sm"
              px={3}
              py={2}
              _hover={{ bg: 'bg.muted' }}
            >
              <HStack gap={2}>
                <Icon as={LuCopy} boxSize={4} />
                <span>Duplicate</span>
              </HStack>
            </Menu.Item> */}
            {canDelete && (
              <Menu.Item
                value="delete"
                color="fg.error"
                cursor="pointer"
                borderRadius="sm"
                px={3}
                py={2}
                _hover={{ bg: 'bg.muted' }}
                onClick={handleDeleteClick}
              >
                <HStack gap={2}>
                  <Icon as={LuTrash2} boxSize={4} />
                  <span>Delete</span>
                </HStack>
              </Menu.Item>
            )}
          </Menu.Content>
        </Menu.Positioner>
        </Portal>
      </Menu.Root>

      {/* Delete Confirmation Dialog */}
      <Dialog.Root open={isDeleteDialogOpen} onOpenChange={(e) => setIsDeleteDialogOpen(e.open)}>
        <Portal>
          <Dialog.Backdrop />
          <Dialog.Positioner>
            <Dialog.Content
              bg="bg.surface"
              borderRadius="lg"
              border="1px solid"
              borderColor="border.default"
              shadow="xl"
              p={0}
              my={12}
            >
              <Dialog.Header
                px={6}
                py={4}
                borderBottom="1px solid"
                borderColor="border.default"
              >
                <Dialog.Title fontSize="lg" fontWeight="700" fontFamily="mono">Delete File</Dialog.Title>
              </Dialog.Header>
              <Dialog.Body px={6} py={5}>
                <Text fontSize="sm" lineHeight="1.6">
                  Are you sure you want to delete <Text as="span" fontWeight="600" fontFamily="mono">"{fileName}"</Text>? This action cannot be undone.
                </Text>
              </Dialog.Body>
              <Dialog.Footer
                px={6}
                py={4}
                gap={3}
                borderTop="1px solid"
                borderColor="border.default"
                justifyContent="flex-end"
              >
                <Dialog.ActionTrigger asChild>
                  <Button px={4} variant="outline" fontFamily="mono">Cancel</Button>
                </Dialog.ActionTrigger>
                <Button px={4} bg="fg.error" color="white" onClick={handleDeleteConfirm} _hover={{ opacity: 0.9 }} fontFamily="mono">
                  Delete
                </Button>
              </Dialog.Footer>
              <Dialog.CloseTrigger asChild>
                <CloseButton size="sm" top={4} right={4} />
              </Dialog.CloseTrigger>
            </Dialog.Content>
          </Dialog.Positioner>
        </Portal>
      </Dialog.Root>
    </Box>
  );
}
