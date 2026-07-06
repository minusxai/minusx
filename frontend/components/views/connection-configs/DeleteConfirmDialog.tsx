'use client';

import {
  Text,
  Button,
  Dialog,
  Portal,
} from '@chakra-ui/react';
import { LuTrash2 } from 'react-icons/lu';

// ─── Delete confirmation dialog ────────────────────────────────────────────────

export interface DeleteConfirmDialogProps {
  /** The item pending deletion; dialog is open whenever this is non-null. */
  target: { name: string } | null;
  onCancel: () => void;
  onConfirm: () => void;
}

export function DeleteConfirmDialog({ target, onCancel, onConfirm }: DeleteConfirmDialogProps) {
  return (
    <Dialog.Root open={!!target} onOpenChange={(e) => { if (!e.open) onCancel(); }}>
      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content bg="bg.surface" borderRadius="lg" border="1px solid" borderColor="border.default">
            <Dialog.Header px={6} py={4} borderBottom="1px solid" borderColor="border.default">
              <Dialog.Title fontSize="md" fontWeight="700">Delete Table</Dialog.Title>
            </Dialog.Header>
            <Dialog.Body px={6} py={5}>
              <Text fontSize="sm">
                Are you sure you want to delete <Text as="span" fontWeight="700" fontFamily="mono">{target?.name}</Text>? This will be saved immediately.
              </Text>
            </Dialog.Body>
            <Dialog.Footer px={6} py={4} gap={3} borderTop="1px solid" borderColor="border.default" justifyContent="flex-end">
              <Dialog.ActionTrigger asChild>
                <Button variant="outline" size="sm">Cancel</Button>
              </Dialog.ActionTrigger>
              <Button bg="accent.danger" color="white" size="sm" onClick={onConfirm}>
                <LuTrash2 size={14} /> Delete
              </Button>
            </Dialog.Footer>
            <Dialog.CloseTrigger />
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}
