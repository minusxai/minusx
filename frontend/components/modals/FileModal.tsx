'use client';

import { useRef } from 'react';
import { Dialog, HStack, Text, Button, Portal, Box, IconButton } from '@chakra-ui/react';
import { LuExternalLink, LuMinimize2, LuMaximize2, LuX } from 'react-icons/lu';
import Link from 'next/link';
import { useAppSelector, useAppDispatch } from '@/store/hooks';
import { selectModalFile, closeFileModal, collapseFileModal, expandFileModal } from '@/store/uiSlice';
import { selectEffectiveName } from '@/store/filesSlice';
import CreateQuestionModalContainer from './CreateQuestionModalContainer';
import { preserveParams } from '@/lib/navigation/url-utils';

/**
 * FileModal - Global file modal controlled by Redux uiSlice.modalFile
 *
 * Opens when openFileModal(fileId) is dispatched from anywhere (tool handlers, UI).
 * Supports ACTIVE (full dialog) and COLLAPSED (bottom bar) states.
 */
export default function FileModal() {
  const dispatch = useAppDispatch();
  const modalFile = useAppSelector(selectModalFile);
  const attemptCloseRef = useRef<(() => void) | null>(null);

  const fileName = useAppSelector(state =>
    modalFile ? selectEffectiveName(state, modalFile.fileId) || 'Question' : 'Question'
  );

  if (!modalFile) return null;

  const { fileId, state } = modalFile;
  const isActive = state === 'ACTIVE';

  const handleClose = () => {
    if (attemptCloseRef.current) {
      attemptCloseRef.current();
    } else {
      dispatch(closeFileModal());
    }
  };

  return (
    <>
      {/* Collapsed bar — shown when state is COLLAPSED */}
      {!isActive && (
        <Box
          position="fixed"
          bottom={0}
          right={4}
          zIndex={99999}
          bg="bg.surface"
          border="1px solid"
          borderColor="border.default"
          borderTopRadius="md"
          px={4}
          py={2}
          display="flex"
          alignItems="center"
          gap={2}
          shadow="lg"
        >
          <Text fontFamily="mono" fontSize="sm" fontWeight="600" maxW="200px" overflow="hidden" textOverflow="ellipsis" whiteSpace="nowrap">
            {fileName}
          </Text>
          <IconButton
            size="xs"
            variant="ghost"
            onClick={() => dispatch(expandFileModal())}
            aria-label="Expand modal"
          >
            <LuMaximize2 />
          </IconButton>
          <IconButton
            size="xs"
            variant="ghost"
            onClick={() => dispatch(closeFileModal())}
            aria-label="Close modal"
          >
            <LuX />
          </IconButton>
        </Box>
      )}

      {/* Full modal dialog — shown when state is ACTIVE */}
      <Portal>
        <Dialog.Root
          open={isActive}
          onOpenChange={(e: { open: boolean }) => { if (!e.open) handleClose(); }}
        >
          <Dialog.Backdrop bg="blackAlpha.600" zIndex={99999} />
          <Dialog.Positioner zIndex={99999}>
            <Dialog.Content
              w="90vw"
              h="95vh"
              maxW="90vw"
              maxH="95vh"
              p={5}
              my={5}
              borderRadius="lg"
              bg="bg.surface"
              display="flex"
              flexDirection="column"
              overflow="hidden"
              border="1px solid"
              borderColor="border.default"
            >
              <Dialog.CloseTrigger />
              <HStack p={3} justify="space-between">
                <Text fontFamily="mono" fontSize="lg">Edit Question</Text>
                <HStack gap={1}>
                  {fileId > 0 && (
                    <Link href={preserveParams(`/f/${fileId}`)} target="_blank">
                      <Button size="xs" variant="ghost">
                        <LuExternalLink />
                        Go to Question
                      </Button>
                    </Link>
                  )}
                  <IconButton
                    size="xs"
                    variant="ghost"
                    onClick={() => dispatch(collapseFileModal())}
                    aria-label="Minimize modal"
                  >
                    <LuMinimize2 />
                  </IconButton>
                </HStack>
              </HStack>
              {isActive && (
                <CreateQuestionModalContainer
                  isOpen={isActive}
                  onClose={() => dispatch(closeFileModal())}
                  onQuestionCreated={() => dispatch(closeFileModal())}
                  folderPath=""
                  questionId={fileId}
                  onAttemptCloseRef={attemptCloseRef}
                />
              )}
            </Dialog.Content>
          </Dialog.Positioner>
        </Dialog.Root>
      </Portal>
    </>
  );
}
