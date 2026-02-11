'use client';

import { Box, VStack, Text, HStack, Input, IconButton, Button } from '@chakra-ui/react';
import { Tooltip } from '@/components/ui/tooltip';
import { QuestionContent } from '@/lib/types';
import { LuScanSearch, LuSearch, LuPlus } from 'react-icons/lu';
import { useMemo, useState, useEffect } from 'react';
import { FILE_TYPE_METADATA } from '@/lib/ui/file-metadata';
import { useAppSelector, useAppDispatch } from '@/store/hooks';
import { setFile } from '@/store/filesSlice';
import { FilesAPI } from '@/lib/data/files';
import CreateQuestionModal from './modals/CreateQuestionModal';

interface QuestionBrowserPanelProps {
  folderPath: string;
  onAddQuestion: (questionId: number) => void;
  excludedIds?: number[];
}

// Local display type that includes metadata (name) + content
interface QuestionDisplay extends QuestionContent {
  id: number;
  name: string;
}

export const QuestionBrowserPanel = ({
  folderPath,
  onAddQuestion,
  excludedIds = []
}: QuestionBrowserPanelProps) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [questionsMap, setQuestionsMap] = useState<Record<number, QuestionDisplay>>({});
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const filesInRedux = useAppSelector(state => state.files.files);
  const dispatch = useAppDispatch();

  // Load all questions from folder
  useEffect(() => {
    async function loadFolderQuestions() {
      try {
        // Get lightweight FileInfo list for all questions in folder
        const { data: questionFiles } = await FilesAPI.getFiles({
          paths: [folderPath],
          type: 'question',
          depth: 999  // All subfolders
        });

        // Separate questions already in Redux vs missing ones
        const newQuestionsMap: Record<number, QuestionDisplay> = {};
        const missingIds: number[] = [];

        questionFiles.forEach(f => {
          if (filesInRedux[f.id]) {
            // Reuse from Redux if already loaded
            const content = filesInRedux[f.id].content as QuestionContent;
            newQuestionsMap[f.id] = {
              id: f.id,
              name: f.name || 'Untitled Question',  // Use file name (metadata), not content.name
              ...content
            };
          } else {
            // Track missing IDs to fetch
            missingIds.push(f.id);
          }
        });

        // Only fetch missing questions from database
        if (missingIds.length > 0) {
          const { data: fullQuestions } = await FilesAPI.loadFiles(missingIds);

          // Dispatch to Redux (like useFile does)
          fullQuestions.forEach(q => {
            const content = q.content as QuestionContent;
            // No need to validate - name is in file.name (metadata), not content
            dispatch(setFile({
              file: { ...q, content },
              references: []
            }));
            newQuestionsMap[q.id] = {
              id: q.id,
              name: q.name || 'Untitled Question',  // Use file name (metadata), not content.name
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

  // Convert map to array and filter out questions that are already in the dashboard and apply search
  const availableQuestions = useMemo(() => {
    // Convert map to array - content already includes id
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
    <VStack
      bg="bg.surface"
      align="stretch"
      gap={0}
      overflowY="auto"
      borderRadius={5}
    >
      {/* Create Question Button */}
      <Box p={3} borderBottom="1px solid" borderColor="border.default">
        <Button
          type="button"
          size="sm"
          width="100%"
          onClick={(e) => {
            e.stopPropagation();
            setCreateModalOpen(true);
          }}
          colorPalette="teal"
          gap={2}
        >
          <LuPlus /> Create New Question
        </Button>
      </Box>

      {/* Header */}
      <Box
        p={4}
        borderBottom="1px solid"
        borderColor="border.default"
        bg="bg.muted"
      >
        <Text
          fontSize="xs"
          fontWeight="700"
          color="fg.subtle"
          textTransform="uppercase"
          letterSpacing="0.1em"
          mb={3}
          fontFamily={"mono"}
        >
          Available Questions ({availableQuestions.length})
        </Text>

        {/* Search Bar */}
        <Box position="relative">
          <Box
            position="absolute"
            left={3}
            top="50%"
            transform="translateY(-50%)"
            color="fg.muted"
            pointerEvents="none"
          >
            <LuSearch size={14} />
          </Box>
          <Input
            placeholder="Search questions..."
            size="sm"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            pl={2}
            bg="bg.surface"
            fontFamily={"mono"}
            borderColor="border.default"
            _hover={{ borderColor: 'border.emphasized' }}
            _focus={{ borderColor: 'accent.primary', boxShadow: '0 0 0 1px var(--chakra-colors-accent-primary)' }}
            fontSize="xs"
          />
        </Box>
      </Box>

      {/* Questions List */}
      <Box p={3}>
        {availableQuestions.length > 0 ? (
          <VStack align="stretch" gap={2}>
            {availableQuestions.map(question => (
              <QuestionItem
                key={question.id}
                question={question}
                onAddQuestion={onAddQuestion}
              />
            ))}
          </VStack>
        ) : (
          <Box
            p={4}
            borderRadius="md"
            border="1px dashed"
            borderColor="border.muted"
            textAlign="center"
          >
            <Text fontSize="xs" color="fg.muted">
              {searchQuery.trim() ? 'No questions match your search' : 'All questions have been added'}
            </Text>
          </Box>
        )}
      </Box>

      {/* Create Question Modal */}
      <CreateQuestionModal
        isOpen={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        onQuestionCreated={onAddQuestion}
        folderPath={folderPath}
      />
    </VStack>
  );
};

interface QuestionItemProps {
  question: QuestionDisplay;
  onAddQuestion: (questionId: number) => void;
}

const QuestionItem = ({ question, onAddQuestion }: QuestionItemProps) => {
  const questionColor = FILE_TYPE_METADATA.question.color;

  return (
    <Box
      p={3}
      bg="bg.surface"
      borderRadius="md"
      border="1px solid"
      borderColor="border.default"
      _hover={{
        bg: 'bg.muted',
        borderColor: questionColor,
        boxShadow: '0 0 12px rgba(41, 128, 185, 0.15)'
      }}
      transition="all 0.15s ease"
    >
      <HStack gap={2.5} align="flex-start">
        <Box
          as={LuScanSearch}
          fontSize="md"
          color={questionColor}
          flexShrink={0}
          mt={0.5}
        />
        <VStack align="stretch" gap={1} flex="1" minWidth={0}>
          <Tooltip content={question.name || 'Untitled Question'}>
            <Text
              fontSize="sm"
              fontWeight="600"
              color="fg.default"
              lineClamp={1}
              fontFamily="mono"
            >
              {question.name || 'Untitled Question'}
            </Text>
          </Tooltip>
          {question.description && (
            <Tooltip content={question.description}>
              <Text
                fontSize="xs"
                color="fg.muted"
                lineClamp={2}
                lineHeight="1.4"
              >
                {question.description}
              </Text>
            </Tooltip>
          )}
        </VStack>
        <IconButton
          onClick={() => onAddQuestion(question.id)}
          aria-label="Add question to dashboard"
          size="xs"
          variant="ghost"
          colorPalette="teal"
          px={2}
        >
          <LuPlus />
          Add
        </IconButton>
      </HStack>
    </Box>
  );
};
