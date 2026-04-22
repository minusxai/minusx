'use client';

import { useState } from 'react';
import { useDispatch } from 'react-redux';
import {
  Box, HStack, VStack, Text, Button, Input, Textarea, Icon
} from '@chakra-ui/react';
import { LuBadgeInfo } from 'react-icons/lu';
import { UserInput } from '@/lib/api/user-input-exception';
import { setUserInputResult } from '@/store/chatSlice';
import { useDirtyFiles } from '@/lib/hooks/file-state-hooks';
import PublishModal from '@/components/PublishModal';

function PublishUserInputRenderer({
  fileCount,
  onSubmit,
}: {
  fileCount: number;
  onSubmit: (result: any) => void;
}) {
  const [isOpen, setIsOpen] = useState(true);
  const dirtyFiles = useDirtyFiles();

  const handleClose = () => {
    setIsOpen(false);
    if (dirtyFiles.length === 0) {
      onSubmit({ published: true });
    } else {
      onSubmit({ cancelled: true, remaining: dirtyFiles.length });
    }
  };

  return (
    <>
      <Button
        size="sm"
        bg="accent.teal"
        color="white"
        onClick={() => setIsOpen(true)}
      >
        Review &amp; Publish ({fileCount} {fileCount === 1 ? 'file' : 'files'})
      </Button>
      <PublishModal isOpen={isOpen} onClose={handleClose} />
    </>
  );
}

interface UserInputComponentProps {
  conversationID: number;
  tool_call_id: string;
  userInput: UserInput;
  toolName?: string;
  toolArgs?: Record<string, any>;
  fileId?: number;
}

export default function UserInputComponent({
  conversationID,
  tool_call_id,
  userInput,
  toolName,
  toolArgs,
  fileId
}: UserInputComponentProps) {
  const dispatch = useDispatch();
  const { props } = userInput;

  // Local state for form inputs
  const [textValue, setTextValue] = useState('');
  const [choiceValues, setChoiceValues] = useState<any[]>([]);
  const [formValues, setFormValues] = useState<Record<string, any>>({});
  const [otherText, setOtherText] = useState('');  // For "Other" option text input
  const [showDeclineReason, setShowDeclineReason] = useState(false);

  const handleSubmit = (result: any) => {
    dispatch(setUserInputResult({
      conversationID,
      tool_call_id,
      userInputId: userInput.id,
      result
    }));
  };

  // Render based on type
  const renderInput = () => {
    switch (props.type) {
      case 'confirmation':
        return showDeclineReason ? (
          <VStack gap={2} align="stretch">
            <HStack gap={2}>
              <Input
                placeholder="Tell the agent why (optional)..."
                value={textValue}
                onChange={(e) => setTextValue(e.target.value)}
                fontFamily="mono"
                fontSize="sm"
                autoFocus
              />
              <Button
                size="sm"
                variant="outline"
                borderColor="border.default"
                color="fg.muted"
                fontFamily="mono"
                flexShrink={0}
                onClick={() => handleSubmit({ declined: true, reason: textValue.trim() || undefined })}
              >
                Decline
              </Button>
            </HStack>
          </VStack>
        ) : (
          <VStack gap={2} align="stretch">
            <HStack gap={2} justify="flex-end">
              <Button
                size="sm"
                variant="outline"
                borderColor="border.default"
                color="fg.muted"
                fontFamily="mono"
                onClick={() => handleSubmit({ declined: true })}
              >
                Decline
              </Button>
              <Button
                size="sm"
                bg="accent.teal"
                color="white"
                fontFamily="mono"
                onClick={() => handleSubmit(true)}
              >
                Allow
              </Button>
            </HStack>
            <Text
              fontSize="xs"
              color="fg.muted"
              fontFamily="mono"
              cursor="pointer"
              textAlign="right"
              _hover={{ color: 'fg.default' }}
              onClick={() => setShowDeclineReason(true)}
            >
              decline with reason…
            </Text>
          </VStack>
        );

      case 'text':
        return (
          <VStack gap={2} align="stretch">
            {props.multiline ? (
              <Textarea
                placeholder={props.placeholder}
                value={textValue}
                onChange={(e) => setTextValue(e.target.value)}
                fontFamily="mono"
                fontSize="sm"
                rows={4}
              />
            ) : (
              <Input
                placeholder={props.placeholder}
                value={textValue}
                onChange={(e) => setTextValue(e.target.value)}
                fontFamily="mono"
                fontSize="sm"
              />
            )}
            <Button
              size="sm"
              bg="accent.primary"
              color="white"
              onClick={() => handleSubmit(textValue)}
              disabled={!textValue.trim()}
              alignSelf="flex-end"
            >
              Submit
            </Button>
          </VStack>
        );

      case 'choice':
        const isMultiSelect = props.multiSelect;
        const isCancellable = props.cancellable;
        // Special options for clarification
        const FIGURE_IT_OUT = '__figure_it_out__';
        const OTHER = '__other__';

        // Use label as identifier (value is optional)
        const getOptionKey = (opt: { label: string; value?: any }) => opt.value ?? opt.label;
        const isSelected = (opt: { label: string; value?: any }) => choiceValues.includes(getOptionKey(opt));
        const isOtherSelected = choiceValues.includes(OTHER);
        const isFigureItOutSelected = choiceValues.includes(FIGURE_IT_OUT);

        const toggleSelection = (opt: { label: string; value?: any }) => {
          const key = getOptionKey(opt);
          if (isMultiSelect) {
            // Multi-select: toggle value in array
            setChoiceValues(prev =>
              prev.includes(key)
                ? prev.filter(v => v !== key)
                : [...prev, key]
            );
          } else {
            // Single-select: replace array with single value
            setChoiceValues([key]);
            // Clear other text if not selecting "Other"
            if (key !== OTHER) {
              setOtherText('');
            }
          }
        };

        // Find full option objects for submission
        const getSelectedOptions = () => {
          return props.options?.filter(opt => choiceValues.includes(getOptionKey(opt))) || [];
        };

        // Determine submit value
        const getSubmitValue = () => {
          if (isFigureItOutSelected) {
            return { label: 'Figure it out', figureItOut: true };
          }
          if (isOtherSelected) {
            return { label: 'Other', other: true, text: otherText };
          }
          return isMultiSelect ? getSelectedOptions() : getSelectedOptions()[0];
        };

        const canSubmit = choiceValues.length > 0 && (!isOtherSelected || otherText.trim());

        return (
          <VStack gap={2} align="stretch">
            {/* Options as compact stacked rows */}
            <VStack gap={1} align="stretch">
              {props.options?.map((option, i) => {
                const selected = isSelected(option);
                return (
                  <HStack
                    key={i}
                    as="button"
                    aria-label={option.label}
                    onClick={() => toggleSelection(option)}
                    gap={2}
                    px={3}
                    py={1.5}
                    borderRadius="md"
                    border="1px solid"
                    borderColor={selected ? 'accent.teal' : 'border.default'}
                    bg={selected ? 'accent.teal/8' : 'transparent'}
                    cursor="pointer"
                    transition="all 0.15s"
                    _hover={{ borderColor: 'accent.teal', bg: 'accent.teal/8' }}
                    textAlign="left"
                  >
                    {/* Radio/checkbox indicator */}
                    <Box
                      w="14px" h="14px" borderRadius={isMultiSelect ? 'sm' : 'full'}
                      border="2px solid" borderColor={selected ? 'accent.teal' : 'fg.subtle'}
                      bg={selected ? 'accent.teal' : 'transparent'}
                      flexShrink={0}
                      display="flex" alignItems="center" justifyContent="center"
                    >
                      {selected && (
                        <Box w="6px" h="6px" borderRadius={isMultiSelect ? '1px' : 'full'} bg="white" />
                      )}
                    </Box>
                    <VStack gap={0} align="start" flex={1} minW={0}>
                      <Text fontSize="xs" fontFamily="mono" fontWeight="500" color={selected ? 'accent.teal' : 'fg.default'}>
                        {option.label}
                      </Text>
                      {option.description && (
                        <Text fontSize="2xs" fontFamily="mono" color="fg.subtle">
                          {option.description}
                        </Text>
                      )}
                    </VStack>
                  </HStack>
                );
              })}
            </VStack>

            {/* Special options — side by side */}
            {isCancellable && (
              <HStack gap={1.5}>
                <Box
                  as="button"
                  aria-label="Figure it out"
                  onClick={() => toggleSelection({ label: 'Figure it out', value: FIGURE_IT_OUT })}
                  flex={1}
                  px={3}
                  py={1.5}
                  borderRadius="md"
                  border="1px solid"
                  borderColor={isFigureItOutSelected ? 'accent.teal' : 'border.default'}
                  bg="transparent"
                  cursor="pointer"
                  transition="all 0.15s"
                  _hover={{ borderColor: 'accent.teal', bg: 'accent.teal/8' }}
                  textAlign="left"
                >
                  <Text fontSize="xs" fontFamily="mono" fontWeight="500" color={isFigureItOutSelected ? 'accent.teal' : 'fg.muted'}>
                    Figure it out
                  </Text>
                </Box>

                <Box
                  as="button"
                  aria-label="Other"
                  onClick={() => toggleSelection({ label: 'Other', value: OTHER })}
                  flex={1}
                  px={3}
                  py={1.5}
                  borderRadius="md"
                  border="1px solid"
                  borderColor={isOtherSelected ? 'accent.secondary' : 'border.default'}
                  bg="transparent"
                  cursor="pointer"
                  transition="all 0.15s"
                  _hover={{ borderColor: 'accent.secondary', bg: 'accent.secondary/8' }}
                  textAlign="left"
                >
                  <Text fontSize="xs" fontFamily="mono" fontWeight="500" color={isOtherSelected ? 'accent.secondary' : 'fg.muted'}>
                    Other
                  </Text>
                </Box>
              </HStack>
            )}

            {/* Text input for "Other" option */}
            {isOtherSelected && (
              <Input
                placeholder="Enter your response..."
                value={otherText}
                onChange={(e) => setOtherText(e.target.value)}
                fontFamily="mono"
                fontSize="sm"
                size="sm"
              />
            )}

            <HStack gap={2} justify="flex-end">
              {isCancellable && (
                <Button
                  size="xs"
                  variant="outline"
                  fontFamily="mono"
                  onClick={() => handleSubmit({ cancelled: true })}
                >
                  Cancel
                </Button>
              )}
              <Button
                size="xs"
                bg="accent.teal"
                color="white"
                fontFamily="mono"
                onClick={() => handleSubmit(getSubmitValue())}
                disabled={!canSubmit}
              >
                Submit
              </Button>
            </HStack>
          </VStack>
        );

      case 'form':
        return (
          <VStack gap={3} align="stretch">
            {props.fields?.map((field, i) => (
              <Box key={i}>
                <Text fontSize="sm" fontWeight="500" mb={1}>
                  {field.label} {field.required && <Text as="span" color="accent.danger">*</Text>}
                </Text>
                <Input
                  type={field.type}
                  placeholder={field.placeholder}
                  value={formValues[field.name] || ''}
                  onChange={(e) => setFormValues({
                    ...formValues,
                    [field.name]: e.target.value
                  })}
                  fontFamily="mono"
                  fontSize="sm"
                />
              </Box>
            ))}
            <Button
              size="sm"
              bg="accent.primary"
              color="white"
              onClick={() => handleSubmit(formValues)}
              alignSelf="flex-end"
            >
              Submit
            </Button>
          </VStack>
        );

      case 'publish':
        return (
          <PublishUserInputRenderer
            fileCount={props.fileCount || 0}
            onSubmit={handleSubmit}
          />
        );

      default:
        return <Text color="accent.danger">Unknown input type: {props.type}</Text>;
    }
  };

  return (
    <Box
      py={2.5}
      px={3}
      border="1px solid"
      borderColor="border.default"
      borderRadius="lg"
      bg="transparent"
      my={1}
    >
      <VStack gap={2} align="stretch">
        {/* Header */}
        <HStack gap={1.5}>
          <Icon as={LuBadgeInfo} boxSize={3.5} color="accent.teal" />
          <Text fontWeight="600" fontSize="sm" color="fg.default" fontFamily="mono">{props.title}</Text>
        </HStack>

        {/* Message */}
        {props.message && (
          <Text fontSize="xs" color="fg.muted" fontFamily="mono">
            {props.message}
          </Text>
        )}

        {/* Input UI */}
        {renderInput()}
      </VStack>
    </Box>
  );
}
