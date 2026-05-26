'use client';

import { Box, VStack, Text, HStack, Input, IconButton, Button } from '@chakra-ui/react';
import { Tooltip } from '@/components/ui/tooltip';
import { QuestionContent } from '@/lib/types';
import { LuScanSearch, LuSearch, LuPlus, LuType, LuMinus } from 'react-icons/lu';
import { useMemo, useState, useEffect } from 'react';
import { FILE_TYPE_METADATA } from '@/lib/ui/file-metadata';
import { useAppSelector, useAppDispatch } from '@/store/hooks';
import { shallowEqual } from 'react-redux';
import { setFile } from '@/store/filesSlice';
import { FilesAPI } from '@/lib/data/files';
import { pushView } from '@/store/uiSlice';
import { createDraftFile } from '@/lib/api/file-state';

interface QuestionBrowserPanelProps {
  folderPath: string;
  onAddQuestion: (questionId: number) => void;
  onAddTextBlock?: () => void;
  onAddDivider?: () => void;
  excludedIds?: number[];
  title?: string;
  dashboardId?: number;
}

// Local display type that includes metadata (name) + content
interface QuestionDisplay extends QuestionContent {
  id: number;
  name: string;
}

export const QuestionBrowserPanel = ({
  folderPath,
  onAddQuestion,
  onAddTextBlock,
  onAddDivider,
  excludedIds = [],
  title,
  dashboardId,
}: QuestionBrowserPanelProps) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [questionsMap, setQuestionsMap] = useState<Record<number, QuestionDisplay>>({});
  // shallowEqual: skip re-renders when the files bag's top-level ref changes
  // but no actual entry differs (Immer-induced).
  const filesInRedux = useAppSelector(state => state.files.files, shallowEqual);
  const dispatch = useAppDispatch();

  // Load all questions from folder
  useEffect(() => {
    async function loadFolderQuestions() {
      try {
        const { data: questionFiles } = await FilesAPI.getFiles({
          paths: [folderPath],
          type: 'question',
          depth: 999
        });

        const newQuestionsMap: Record<number, QuestionDisplay> = {};
        const missingIds: number[] = [];

        questionFiles.forEach(f => {
          if (filesInRedux[f.id]) {
            const content = filesInRedux[f.id].content as QuestionContent;
            newQuestionsMap[f.id] = {
              id: f.id,
              name: f.name || 'Untitled Question',
              ...content
            };
          } else {
            missingIds.push(f.id);
          }
        });

        if (missingIds.length > 0) {
          const { data: fullQuestions } = await FilesAPI.loadFiles(missingIds);

          fullQuestions.forEach(q => {
            const content = q.content as QuestionContent;
            dispatch(setFile({
              file: { ...q, content },
              references: []
            }));
            newQuestionsMap[q.id] = {
              id: q.id,
              name: q.name || 'Untitled Question',
              ...content
            };
          });
        }

        setQuestionsMap(newQuestionsMap);
      } catch (error) {
        console.error('Failed to load questions from folder:', error);
      }
    }

    loadFolderQuestions();
  }, [folderPath, dispatch]);

  const availableQuestions = useMemo(() => {
    let filtered = Object.entries(questionsMap)
      .filter(([idStr]) => {
        const id = parseInt(idStr, 10);
        return !excludedIds.includes(id);
      })
      .map(([, content]) => content);

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(q =>
        (q.name?.toLowerCase().includes(query) || false) ||
        (q.description?.toLowerCase().includes(query) || false)
      );
    }

    return filtered;
  }, [questionsMap, excludedIds, searchQuery]);

  return (
    <Box
      fontFamily="mono"
      bg="bg.surface"
      borderRadius="md"
      border="1px solid"
      borderColor="border.default"
      overflow="hidden"
      maxW="600px"
      mx="auto"
    >
      {title && (
        <Box px={4} py={2.5} borderBottomWidth="1px" borderColor="border.default" bg="bg.muted">
          <Text fontSize="xs" fontWeight={700} color="fg.muted" textTransform="uppercase" letterSpacing="0.05em">
            {title}
          </Text>
        </Box>
      )}

      <HStack align="stretch" gap={0}>
        {/* Left: nav items — Existing Questions is highlighted, others are instant actions */}
        <VStack
          gap={0}
          align="stretch"
          borderRightWidth="1px"
          borderColor="border.default"
          minW="200px"
          flexShrink={0}
        >
          {/* Existing Questions — active/highlighted item, connects to the right panel */}
          <HStack
            px={3}
            py={2.5}
            gap={2}
            bg="accent.teal/8"
            borderLeftWidth="3px"
            borderColor="accent.teal"
            cursor="default"
          >
            <LuSearch size={12} color="var(--chakra-colors-accent-teal)" />
            <Text fontSize="xs" fontWeight={600} color="accent.teal">
              Existing Questions
            </Text>
          </HStack>

          <Button
            size="xs"
            variant="ghost"
            borderRadius="0"
            px={3}
            py={2.5}
            h="auto"
            fontWeight={500}
            fontSize="xs"
            color="fg.muted"
            justifyContent="flex-start"
            _hover={{ bg: 'bg.muted', color: 'fg.default' }}
            onClick={async (e) => {
              e.stopPropagation();
              if (dashboardId !== undefined) {
                const draftFileId = await createDraftFile('question', { folder: folderPath });
                dispatch(pushView({ type: 'create-question', folderPath, dashboardId, fileId: draftFileId }));
              }
            }}
            aria-label="Create New Question"
          >
            <LuPlus size={12} />
            New Question
          </Button>

          {onAddTextBlock && (
            <Button
              size="xs"
              variant="ghost"
              borderRadius="0"
              px={3}
              py={2.5}
              h="auto"
              fontWeight={500}
              fontSize="xs"
              color="fg.muted"
              justifyContent="flex-start"
              _hover={{ bg: 'bg.muted', color: 'fg.default' }}
              onClick={(e) => { e.stopPropagation(); onAddTextBlock(); }}
              aria-label="Add text block"
            >
              <LuType size={12} />
              Text Block
            </Button>
          )}

          {onAddDivider && (
            <Button
              size="xs"
              variant="ghost"
              borderRadius="0"
              px={3}
              py={2.5}
              h="auto"
              fontWeight={500}
              fontSize="xs"
              color="fg.muted"
              justifyContent="flex-start"
              _hover={{ bg: 'bg.muted', color: 'fg.default' }}
              onClick={(e) => { e.stopPropagation(); onAddDivider(); }}
              aria-label="Add divider"
            >
              <LuMinus size={12} />
              Divider
            </Button>
          )}
        </VStack>

        {/* Right: question browser (always visible) */}
        <Box flex={1} minW={0}>
          {availableQuestions.length > 0 || searchQuery.trim() ? (
            <>
              {/* Search */}
              <Box p={3} borderBottomWidth="1px" borderColor="border.default" bg="bg.muted">
                <Box position="relative">
                  <Box
                    position="absolute"
                    left={2.5}
                    top="50%"
                    transform="translateY(-50%)"
                    color="fg.muted"
                    pointerEvents="none"
                  >
                    <LuSearch size={12} />
                  </Box>
                  <Input
                    placeholder="Search existing questions..."
                    size="xs"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    pl={7}
                    bg="bg.surface"
                    borderColor="border.default"
                    _hover={{ borderColor: 'border.emphasized' }}
                    _focus={{ borderColor: 'accent.primary', boxShadow: '0 0 0 1px var(--chakra-colors-accent-primary)' }}
                    fontSize="xs"
                    borderRadius="md"
                  />
                </Box>
              </Box>

              {/* Question list */}
              <Box maxHeight="240px" overflowY="auto">
                {availableQuestions.length > 0 ? (
                  <VStack align="stretch" gap={0} py={1}>
                    {availableQuestions.map(question => (
                      <QuestionItem
                        key={question.id}
                        question={question}
                        onAddQuestion={onAddQuestion}
                      />
                    ))}
                  </VStack>
                ) : (
                  <Box p={4} textAlign="center">
                    <Text fontSize="xs" color="fg.muted">
                      No questions match your search
                    </Text>
                  </Box>
                )}
              </Box>
            </>
          ) : (
            <Box p={4} display="flex" alignItems="center" justifyContent="center" height="100%">
              <Text fontSize="xs" color="fg.muted">
                All questions have been added
              </Text>
            </Box>
          )}
        </Box>
      </HStack>
    </Box>
  );
};

interface QuestionItemProps {
  question: QuestionDisplay;
  onAddQuestion: (questionId: number) => void;
}

const QuestionItem = ({ question, onAddQuestion }: QuestionItemProps) => {
  const questionColor = FILE_TYPE_METADATA.question.color;

  return (
    <HStack
      role="article"
      aria-label={question.name || 'Untitled Question'}
      px={3}
      py={1.5}
      _hover={{ bg: 'bg.muted' }}
      transition="background 0.1s"
      gap={2}
      cursor="default"
    >
      <Box
        as={LuScanSearch}
        fontSize="xs"
        color={questionColor}
        flexShrink={0}
      />
      <Box flex="1" minWidth={0}>
        <Tooltip content={question.name || 'Untitled Question'}>
          <Text
            fontSize="xs"
            fontWeight={500}
            color="fg.default"
            lineClamp={1}
          >
            {question.name || 'Untitled Question'}
          </Text>
        </Tooltip>
      </Box>
      <IconButton
        onClick={() => onAddQuestion(question.id)}
        aria-label="Add to dashboard"
        size="2xs"
        variant="ghost"
        colorPalette="teal"
      >
        <LuPlus size={12} />
      </IconButton>
    </HStack>
  );
};
