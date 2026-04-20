'use client';

import React from 'react';
import { useFile } from '@/lib/hooks/file-state-hooks';
import { useAppSelector } from '@/store/hooks';
import { selectMergedContent, selectEffectiveName } from '@/store/filesSlice';
import { QuestionContent, QuestionParameter } from '@/lib/types';
import EmbeddedQuestionContainer from './EmbeddedQuestionContainer';
import { Box, Spinner, Text, HStack, VStack, IconButton, Menu, Portal, Icon } from '@chakra-ui/react';
import { Link } from '@/components/ui/Link';
import { LuEllipsis, LuSparkles, LuExternalLink, LuTrash2, LuPencil } from 'react-icons/lu';
import { useExplainQuestion } from '@/lib/hooks/useExplainQuestion';

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

function SmartEmbeddedQuestionContainerInner({
  questionId,
  externalParameters,
  externalParamValues,
  showTitle = false,
  editMode = false,
  onEdit,
  onRemove,
}: SmartEmbeddedQuestionContainerProps) {
  const { explainQuestion } = useExplainQuestion();

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
    <Box
      position="relative"
      display="flex"
      flexDirection="column"
      flex="1"
      overflow="hidden"
      css={editMode ? {
        '& .edit-actions': { opacity: 0, transition: 'opacity 0.15s' },
        '&:hover .edit-actions': { opacity: 1 },
      } : undefined}
    >
      {showTitle && (
        <Box
          bg={'bg.subtle'}
          px={5}
          pt={3}
          borderColor="border.default"
          display="flex"
          justifyContent="space-between"
          alignItems="center"
        >
          <Box flex="1" mr={2}>
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
          {!editMode && (
            <Box onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}>
              <Menu.Root>
                <Menu.Trigger asChild>
                  <IconButton
                    variant="ghost"
                    size="xs"
                    aria-label="Card actions"
                    color="fg.muted"
                    _hover={{ color: 'fg.default' }}
                    _focusVisible={{ outline: 'none', boxShadow: 'none' }}
                  >
                    <LuEllipsis />
                  </IconButton>
                </Menu.Trigger>
                <Portal>
                  <Menu.Positioner>
                    <Menu.Content
                      minW="180px"
                      bg="bg.surface"
                      borderColor="border.default"
                      shadow="lg"
                      p={1}
                    >
                      <Menu.Item
                        value="explain"
                        cursor="pointer"
                        borderRadius="sm"
                        px={3}
                        py={2}
                        _hover={{ bg: 'bg.muted' }}
                        onClick={() => explainQuestion(questionId)}
                        aria-label="Explain chart"
                      >
                        <HStack gap={2}>
                          <Icon as={LuSparkles} boxSize={4} color="accent.teal" />
                          <span>Explain chart</span>
                        </HStack>
                      </Menu.Item>
                      <Menu.Item
                        value="edit"
                        cursor="pointer"
                        borderRadius="sm"
                        px={3}
                        py={2}
                        _hover={{ bg: 'bg.muted' }}
                        onClick={() => onEdit ? onEdit() : window.open(`/f/${questionId}`, '_blank')}
                        aria-label="Edit question"
                      >
                        <HStack gap={2}>
                          <Icon as={LuExternalLink} boxSize={4} />
                          <span>Edit question</span>
                        </HStack>
                      </Menu.Item>
                      {onRemove && (
                        <Menu.Item
                          value="remove"
                          cursor="pointer"
                          borderRadius="sm"
                          px={3}
                          py={2}
                          _hover={{ bg: 'bg.muted' }}
                          onClick={onRemove}
                          aria-label="Remove from dashboard"
                        >
                          <HStack gap={2}>
                            <Icon as={LuTrash2} boxSize={4} color="accent.danger" />
                            <span>Remove from dashboard</span>
                          </HStack>
                        </Menu.Item>
                      )}
                    </Menu.Content>
                  </Menu.Positioner>
                </Portal>
              </Menu.Root>
            </Box>
          )}
        </Box>
      )}
      <EmbeddedQuestionContainer
        question={mergedContent}
        questionId={questionId}
        filePath={file?.path}
        externalParameters={parametersToUse}
        externalParamValues={externalParamValues}
      />
      {/* Edit mode: overlay makes entire card draggable, blocks chart interaction */}
      {editMode && (
        <>
          <Box
            className="drag-handle"
            position="absolute"
            inset={0}
            cursor="move"
            zIndex={1}
            css={{ clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 24px), calc(100% - 24px) 100%, 0 100%)' }}
          />
          <HStack
            className="edit-actions"
            position="absolute"
            top={2}
            right={2}
            gap={1}
            zIndex={2}
          >
            {onEdit && (
              <IconButton
                onClick={onEdit}
                aria-label="Edit question"
                size="2xs"
                variant="ghost"
                color="accent.primary"
                cursor="pointer"
                _hover={{ transform: 'scale(1.2)' }}
                _focusVisible={{ outline: 'none', boxShadow: 'none' }}
                transition="transform 0.1s ease"
              >
                <LuPencil size={14} />
              </IconButton>
            )}
            {onRemove && (
              <IconButton
                onClick={onRemove}
                aria-label="Remove from dashboard"
                size="2xs"
                variant="ghost"
                color="accent.danger"
                cursor="pointer"
                _hover={{ transform: 'scale(1.2)' }}
                _focusVisible={{ outline: 'none', boxShadow: 'none' }}
                transition="transform 0.1s ease"
              >
                <LuTrash2 size={14} />
              </IconButton>
            )}
          </HStack>
        </>
      )}
    </Box>
  );
}

// Custom comparator: skip re-render when only unstable callback refs change (onEdit/onRemove
// are inline arrow functions in DashboardView's questionGridItems useMemo, so they're always
// new references when hoveredParamKey changes — ignoring them prevents 77-render cascades).
const SmartEmbeddedQuestionContainer = React.memo(SmartEmbeddedQuestionContainerInner, (prev, next) =>
  prev.questionId === next.questionId &&
  prev.externalParameters === next.externalParameters &&
  prev.externalParamValues === next.externalParamValues &&
  prev.showTitle === next.showTitle &&
  prev.editMode === next.editMode &&
  prev.index === next.index
);
export default SmartEmbeddedQuestionContainer;
