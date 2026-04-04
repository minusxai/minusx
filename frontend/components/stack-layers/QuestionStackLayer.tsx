'use client';

import { useRef } from 'react';
import { Box, HStack, IconButton, Text } from '@chakra-ui/react';
import { LuChevronLeft } from 'react-icons/lu';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import { popView } from '@/store/uiSlice';
import { selectEffectiveName, addQuestionToDashboard } from '@/store/filesSlice';
import CreateQuestionModalContainer from '@/components/modals/CreateQuestionModalContainer';

interface QuestionStackLayerProps {
  fileId: number;
  folderPath: string;
  isCreateMode: boolean;
  dashboardId?: number;  // required when isCreateMode=true
}

export default function QuestionStackLayer({ fileId, folderPath, isCreateMode, dashboardId }: QuestionStackLayerProps) {
  const dispatch = useAppDispatch();
  const fileName = useAppSelector(state =>
    fileId > 0 ? selectEffectiveName(state, fileId) || 'Question' : 'New Question'
  );
  const attemptCloseRef = useRef<(() => void) | null>(null);

  const handleBack = () => {
    if (attemptCloseRef.current) {
      attemptCloseRef.current();  // triggers handleCancel in container (clears changes + pops)
    } else {
      dispatch(popView());
    }
  };

  const handleQuestionCreated = (virtualId: number) => {
    if (dashboardId !== undefined) {
      dispatch(addQuestionToDashboard({ dashboardId, questionId: virtualId }));
    }
    // Don't popView here — CreateQuestionModalContainer calls onClose() right after,
    // which dispatches popView(). Popping twice would break the stack.
  };

  return (
    <Box
      display="flex"
      flexDirection="column"
      h="100%"
      bg="bg.canvas"
      overflow="hidden"
      aria-label={isCreateMode ? 'Create question' : 'Edit question'}
    >
      {/* Navigation breadcrumb bar */}
      <HStack
        px={4}
        py={2}
        borderBottomWidth="1px"
        borderColor="border.default"
        flexShrink={0}
        gap={2}
        bg="bg.surface"
      >
        <IconButton size="xs" variant="ghost" onClick={handleBack} aria-label="Back to dashboard">
          <LuChevronLeft />
        </IconButton>
        <Text fontSize="xs" color="fg.muted" fontFamily="mono">Dashboard</Text>
        <Text fontSize="xs" color="fg.muted">/</Text>
        <Text fontSize="xs" fontFamily="mono" fontWeight="600" flex="1" truncate>
          {fileName}
        </Text>
      </HStack>

      {/* Reuse existing container — renders name input + editor + action buttons */}
      <CreateQuestionModalContainer
        isOpen={true}
        onClose={() => dispatch(popView())}
        onQuestionCreated={handleQuestionCreated}
        folderPath={folderPath}
        questionId={isCreateMode ? undefined : fileId}
        onAttemptCloseRef={attemptCloseRef}
      />
    </Box>
  );
}
