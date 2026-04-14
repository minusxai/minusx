'use client';

import { useRef } from 'react';
import { Box, HStack, IconButton, Text } from '@chakra-ui/react';
import { LuChevronLeft, LuChevronRight } from 'react-icons/lu';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import { popView } from '@/store/uiSlice';
import { selectEffectiveName, addQuestionToDashboard, selectFile } from '@/store/filesSlice';
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
  // Build breadcrumb segments from the dashboard's path, skipping the mode root (first segment)
  const breadcrumbSegments = useAppSelector(state => {
    if (dashboardId === undefined) return [];
    const dashFile = selectFile(state, dashboardId);
    const dashName = selectEffectiveName(state, dashboardId) || 'Dashboard';
    if (!dashFile?.path) return [dashName];
    const parts = dashFile.path.split('/').filter(Boolean);
    // parts = ['org', 'Sales', 'Dashboard Name'] — skip mode root (parts[0])
    return parts.slice(1).map((seg, i, arr) =>
      i === arr.length - 1 ? dashName : decodeURIComponent(seg)
    );
  });
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
        gap={1.5}
        bg="bg.surface"
        overflow="hidden"
      >
        <IconButton size="xs" variant="ghost" onClick={handleBack} aria-label="Back to dashboard" flexShrink={0}>
          <LuChevronLeft />
        </IconButton>
        {breadcrumbSegments.map((seg, i) => (
          <HStack key={i} gap={1.5} minW="0" flexShrink={i < breadcrumbSegments.length - 1 ? 1 : 0}>
            <Text fontSize="xs" color="fg.muted" fontFamily="mono" truncate>{seg}</Text>
            <Box color="fg.subtle" flexShrink={0}><LuChevronRight size={10} /></Box>
          </HStack>
        ))}
        {breadcrumbSegments.length === 0 && (
          <>
            <Text fontSize="xs" color="fg.muted" fontFamily="mono">Dashboard</Text>
            <Box color="fg.subtle"><LuChevronRight size={10} /></Box>
          </>
        )}
        <Text fontSize="xs" fontFamily="mono" fontWeight="600" truncate flex="1" minW="0">
          {fileName}
        </Text>
      </HStack>

      {/* Reuse existing container — renders name input + editor + action buttons */}
      <CreateQuestionModalContainer
        isOpen={true}
        onClose={() => dispatch(popView())}
        onQuestionCreated={handleQuestionCreated}
        folderPath={folderPath}
        questionId={fileId}
        onAttemptCloseRef={attemptCloseRef}
        isNewQuestion={isCreateMode}
      />
    </Box>
  );
}
