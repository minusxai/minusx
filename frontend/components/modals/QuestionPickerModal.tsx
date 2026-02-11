'use client';

import { useState, useMemo, useEffect } from 'react';
import {
  Box,
  VStack,
  HStack,
  Text,
  Input,
  Button,
  Dialog,
  Portal,
  Field,
} from '@chakra-ui/react';
import { useAppSelector } from '@/store/hooks';
import { QuestionContent } from '@/lib/types';
import { FilesAPI } from '@/lib/data/files';
import { slugify } from '@/lib/slug-utils';

interface QuestionPickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (questionId: number, alias: string) => void;
  currentQuestionId: number;
  currentConnectionId?: string;
  excludedIds?: number[];  // Questions already referenced
}

interface QuestionOption {
  id: number;
  name: string;
  database_name?: string;
  hasReferences: boolean;
}

export default function QuestionPickerModal({
  isOpen,
  onClose,
  onSelect,
  currentQuestionId,
  currentConnectionId,
  excludedIds = []
}: QuestionPickerModalProps) {
  const [alias, setAlias] = useState('');
  const [selectedId, setSelectedId] = useState<number>();
  const [questions, setQuestions] = useState<QuestionOption[]>([]);
  const [loading, setLoading] = useState(false);

  const currentQuestion = useAppSelector(state => state.files.files[currentQuestionId]);

  // Load all questions on mount
  useEffect(() => {
    if (!isOpen) return;

    async function loadQuestions() {
      setLoading(true);
      try {
        // Get all questions (metadata only, partial load)
        const { data: allFiles } = await FilesAPI.getFiles({
          type: 'question',
          depth: 999
        });

        // Load full content for questions to check references
        const { data: fullQuestions } = await FilesAPI.loadFiles(
          allFiles.map(f => f.id)
        );

        const questionOptions: QuestionOption[] = fullQuestions.map(q => {
          const content = q.content as QuestionContent;
          return {
            id: q.id,
            name: q.name || 'Untitled Question',
            database_name: content.database_name,
            hasReferences: (content.references?.length ?? 0) > 0
          };
        });

        setQuestions(questionOptions);
      } catch (error) {
        console.error('Failed to load questions:', error);
      } finally {
        setLoading(false);
      }
    }

    loadQuestions();
  }, [isOpen]);

  // Filter available questions
  const availableQuestions = useMemo(() => {
    return questions.filter(q => {
      // Can't reference self
      if (q.id === currentQuestionId) return false;

      // Single-level: Can't reference questions with references
      if (q.hasReferences) return false;

      // No duplicates
      if (excludedIds.includes(q.id)) return false;

      // Same connection only (if currentConnectionId is set)
      if (currentConnectionId && q.database_name !== currentConnectionId) return false;

      return true;
    });
  }, [questions, currentQuestionId, excludedIds, currentConnectionId]);

  const handleSelect = () => {
    if (selectedId && alias.trim()) {
      onSelect(selectedId, alias.trim());
      // Reset state
      setSelectedId(undefined);
      setAlias('');
      onClose();
    }
  };

  const handleOpenChange = (e: { open: boolean }) => {
    if (!e.open) {
      setSelectedId(undefined);
      setAlias('');
      onClose();
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
            maxW="600px"
            p={5}
            borderRadius="lg"
            bg="bg.surface"
            border="1px solid"
            borderColor="border.default"
          >
            <Dialog.CloseTrigger />
            <Dialog.Header>
              <Dialog.Title fontFamily="mono">Add Composed Question</Dialog.Title>
            </Dialog.Header>

            <Dialog.Body>
              <VStack align="stretch" gap={4}>
                {/* Question list */}
                <Box>
                  <Text fontSize="sm" fontWeight="medium" mb={2}>
                    Select a question to reference:
                  </Text>
                  {loading ? (
                    <Text fontSize="sm" color="fg.muted">Loading questions...</Text>
                  ) : availableQuestions.length === 0 ? (
                    <Text fontSize="sm" color="fg.muted">
                      No questions available. Questions must use the same connection and cannot have references.
                    </Text>
                  ) : (
                    <VStack align="stretch" gap={2} maxH="300px" overflowY="auto">
                      {availableQuestions.map(q => (
                        <Box
                          key={q.id}
                          p={3}
                          borderWidth={1}
                          borderRadius="md"
                          cursor="pointer"
                          bg={selectedId === q.id ? 'blue.50' : 'bg.surface'}
                          borderColor={selectedId === q.id ? 'blue.500' : 'border.default'}
                          _hover={{ borderColor: 'blue.300' }}
                          onClick={() => {
                            setSelectedId(q.id);
                            // Auto-suggest alias from question name (slugified, clean)
                            if (!alias) {
                              setAlias(slugify(q.name));
                            }
                          }}
                        >
                          <Text fontWeight="medium" fontSize="sm">{q.name}</Text>
                          {q.database_name && (
                            <Text fontSize="xs" color="fg.muted">
                              Connection: {q.database_name}
                            </Text>
                          )}
                        </Box>
                      ))}
                    </VStack>
                  )}
                </Box>

                {/* Alias input */}
                {selectedId && (
                  <Field.Root>
                    <Field.Label fontSize="sm" fontWeight="medium">
                      Alias (used as @alias in SQL)
                    </Field.Label>
                    <Input
                      value={alias}
                      onChange={e => setAlias(e.target.value)}
                      placeholder="e.g., users, orders, revenue"
                      fontSize="sm"
                      fontFamily="mono"
                    />
                    <Field.HelperText fontSize="xs">
                      Use lowercase with underscores (e.g., user_orders)
                    </Field.HelperText>
                  </Field.Root>
                )}
              </VStack>
            </Dialog.Body>

            <Dialog.Footer>
              <HStack justify="flex-end" gap={2}>
                <Button variant="ghost" onClick={onClose}>
                  Cancel
                </Button>
                <Button
                  colorPalette="blue"
                  disabled={!selectedId || !alias.trim()}
                  onClick={handleSelect}
                >
                  Add Reference
                </Button>
              </HStack>
            </Dialog.Footer>
          </Dialog.Content>
        </Dialog.Positioner>
      </Dialog.Root>
    </Portal>
  );
}
