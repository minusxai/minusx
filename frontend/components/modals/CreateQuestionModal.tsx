'use client';

import { useRef } from 'react';
import { Dialog, HStack, Text, Button, Portal } from '@chakra-ui/react';
import { LuExternalLink } from 'react-icons/lu';
import Link from 'next/link';
import CreateQuestionModalContainer from './CreateQuestionModalContainer';
import { preserveParams } from '@/lib/navigation/url-utils';

interface CreateQuestionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onQuestionCreated: (id: number) => void;
  folderPath: string;
  questionId?: number;  // Optional: if provided, edit existing question instead of creating new
}

/**
 * Modal shell for creating OR editing questions inline in dashboard
 * Large modal (80vw x 80vh) with full question editing UI
 */
export default function CreateQuestionModal({
  isOpen,
  onClose,
  onQuestionCreated,
  folderPath,
  questionId,
}: CreateQuestionModalProps) {
  // Ref to hold the container's attempt-close handler (checks for unsaved changes)
  const attemptCloseRef = useRef<(() => void) | null>(null);

  const handleOpenChange = (e: { open: boolean }) => {
    if (!e.open) {
      // Use the container's attemptClose if available (checks dirty state)
      if (attemptCloseRef.current) {
        attemptCloseRef.current();
      } else {
        onClose();
      }
    }
  };

  return (
    <Portal>
      <Dialog.Root
        open={isOpen}
        onOpenChange={handleOpenChange}
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
          {/* Header with title and link to question page */}
          <HStack p={3} justify="space-between">
            <Text fontFamily="mono" fontSize="lg">{questionId ? "Edit Question" : "Create Question"}</Text>
            {questionId && questionId > 0 && (
              <Link href={preserveParams(`/f/${questionId}`)} target="_blank">
                <Button size="xs" variant="ghost">
                  <LuExternalLink />
                  Go to Question
                </Button>
              </Link>
            )}
          </HStack>
          {isOpen && (
            <CreateQuestionModalContainer
              isOpen={isOpen}
              onClose={onClose}
              onQuestionCreated={onQuestionCreated}
              folderPath={folderPath}
              questionId={questionId}
              onAttemptCloseRef={attemptCloseRef}
            />
          )}
        </Dialog.Content>
        </Dialog.Positioner>
      </Dialog.Root>
    </Portal>
  );
}
