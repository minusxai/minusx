'use client';

import { useFile } from '@/lib/hooks/file-state-hooks';
import { useAppSelector } from '@/store/hooks';
import { selectMergedContent, selectEffectiveName } from '@/store/filesSlice';
import { QuestionContent, QuestionParameter } from '@/lib/types';
import EmbeddedQuestionContainer from './EmbeddedQuestionContainer';
import { Box, Spinner, Text, HStack, VStack, IconButton } from '@chakra-ui/react';
import { Link } from '@/components/ui/Link';
import { LuX, LuPencil } from 'react-icons/lu';
import ExplainButton from '@/components/ExplainButton';

interface SmartEmbeddedQuestionContainerProps {
  questionId: number;
  externalParameters?: QuestionParameter[];  // Optional: parameters from parent (e.g., dashboard)
  externalParamValues?: Record<string, any>;  // Optional: runtime parameter values from parent
  showTitle?: boolean;  // Show question title header
  editMode?: boolean;   // Enable edit mode UI (drag handle, edit button, remove button)
  onEdit?: () => void;  // Callback for edit button
  onRemove?: () => void;  // Callback for remove button
  index?: number;  // Optional index for numbering (e.g., #01, #02)
}

export default function SmartEmbeddedQuestionContainer({
  questionId,
  externalParameters,
  externalParamValues,
  showTitle = false,
  editMode = false,
  onEdit,
  onRemove,
  index
}: SmartEmbeddedQuestionContainerProps) {
  // Load question file
  const { fileState: file } = useFile(questionId) ?? {};
  const loading = !file || file.loading;

  // Get merged content (includes any edits)
  const mergedContent = useAppSelector(state =>
    selectMergedContent(state, questionId)
  ) as QuestionContent | undefined;

  // Use effective name so pending renames are reflected immediately in the dashboard card
  const effectiveName = useAppSelector(state => selectEffectiveName(state, questionId));

  // Show loading state while file loads
  if (loading || !file || !mergedContent) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minH="200px">
        <Spinner size="lg" />
      </Box>
    );
  }

  // Use external parameters (from dashboard) or fall back to question's own parameters
  const parametersToUse = externalParameters ?? mergedContent?.parameters ?? [];

  // Render embedded question container with loaded content
  return (
    <>
      {showTitle && (
        <Box
          bg={'bg.muted'}
          px={4}
          py={2}
          borderBottom="2px solid"
          borderColor={editMode ? 'accent.teal' : 'border.default'}
          display="flex"
          justifyContent="space-between"
          alignItems="center"
          transition="all 0.2s"
          _hover={{ bg: editMode ? '#16a085' : 'bg.elevated' }}
        >
          <Box
            className={editMode ? "drag-handle" : ""}
            cursor={editMode ? 'move' : 'default'}
            flex="1"
            mr={2}
          >
            <Link
              href={`/f/${questionId}`}
              prefetch={true}
              onClick={(e) => {
                if (editMode) {
                  e.preventDefault();
                  e.stopPropagation();
                }
              }}
              style={{ pointerEvents: editMode ? 'none' : 'auto' }}
            >
              <Text
                fontSize="sm"
                fontWeight="600"
                color="fg.default"
                lineClamp={1}
                fontFamily="mono"
                cursor={editMode ? 'move' : 'pointer'}
                _hover={{ color: editMode ? 'fg.default' : 'accent.primary', textDecoration: editMode ? 'none' : 'underline' }}
              >
                {effectiveName || file.name}
              </Text>
            </Link>
          </Box>
          <HStack gap={2} alignItems={"stretch"}>
            {index !== undefined && !editMode && (
              <ExplainButton questionId={questionId} size="xs" />
            )}
            {editMode && onEdit && (
              <IconButton
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  onEdit();
                }}
                aria-label="Edit question"
                size="xs"
                variant="solid"
                bg="accent.primary"
                color="white"
              >
                <LuPencil />
              </IconButton>
            )}
            {editMode && onRemove && (
              <IconButton
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  onRemove();
                }}
                aria-label="Remove question"
                size="xs"
                variant="solid"
                bg="accent.danger"
                color="white"
              >
                <LuX />
              </IconButton>
            )}
          </HStack>
        </Box>
      )}
      <EmbeddedQuestionContainer
        question={mergedContent}
        questionId={questionId}
        externalParameters={parametersToUse}
        externalParamValues={externalParamValues}
      />
    </>
  );
}
