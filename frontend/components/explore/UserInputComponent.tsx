'use client';

import { useState, useEffect } from 'react';
import { useDispatch } from 'react-redux';
import {
  Box, HStack, VStack, Text, Button, Input, Textarea, Icon
} from '@chakra-ui/react';
import { LuTriangleAlert } from 'react-icons/lu';
import { UserInput } from '@/lib/api/user-input-exception';
import { setUserInputResult } from '@/store/chatSlice';
import { setProposedQuery, clearProposedQuery } from '@/store/uiSlice';

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

  // Set proposed query on mount, clear on unmount (for SQL diff view)
  useEffect(() => {
    if (toolName === 'ExecuteSQLQueryForeground' && fileId && toolArgs?.query) {
      dispatch(setProposedQuery({ fileId, query: toolArgs.query }));
    }

    return () => {
      // Clear proposed query on unmount
      if (fileId) {
        dispatch(clearProposedQuery(fileId));
      }
    };
  }, [toolName, fileId, toolArgs?.query, dispatch]);

  const handleSubmit = (result: any) => {
    // Clear proposed query when user responds
    if (fileId) {
      dispatch(clearProposedQuery(fileId));
    }

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
        return (
          <HStack gap={2} justify="flex-end">
            <Button
              size="sm"
              variant="outline"
              bg="accent.danger/80"
              onClick={() => handleSubmit(false)}
            >
              {props.cancelText || 'Cancel'}
            </Button>
            <Button
              size="sm"
              bg="accent.teal"
              color="white"
              variant="outline"
              onClick={() => handleSubmit(true)}
            >
              {props.confirmText || 'Confirm'}
            </Button>
          </HStack>
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
            {props.options?.map((option, i) => (
              <Button
                key={i}
                variant={isSelected(option) ? 'solid' : 'outline'}
                bg={isSelected(option) ? 'accent.primary' : 'transparent'}
                color={isSelected(option) ? 'white' : 'fg.default'}
                borderColor="border.default"
                onClick={() => toggleSelection(option)}
                justifyContent="flex-start"
                height="auto"
                py={3}
                px={4}
                whiteSpace="normal"
                textAlign="left"
              >
                <VStack gap={0} align="start" w="100%">
                  <Text fontSize="sm" fontWeight="500" wordBreak="break-word">{option.label}</Text>
                  {option.description && (
                    <Text fontSize="xs" color={isSelected(option) ? 'whiteAlpha.800' : 'fg.muted'} wordBreak="break-word">
                      {option.description}
                    </Text>
                  )}
                </VStack>
              </Button>
            ))}

            {/* Special options for clarification */}
            {isCancellable && (
              <>
                <Box borderTop="1px solid" borderColor="border.default" my={1} />

                {/* Figure it out option */}
                <Button
                  variant={isFigureItOutSelected ? 'solid' : 'outline'}
                  bg={isFigureItOutSelected ? 'accent.teal' : 'transparent'}
                  color={isFigureItOutSelected ? 'white' : 'fg.muted'}
                  borderColor="border.default"
                  onClick={() => toggleSelection({ label: 'Figure it out', value: FIGURE_IT_OUT })}
                  justifyContent="flex-start"
                  height="auto"
                  py={3}
                  px={4}
                  whiteSpace="normal"
                  textAlign="left"
                >
                  <VStack gap={0} align="start" w="100%">
                    <Text fontSize="sm" fontWeight="500">Figure it out</Text>
                    <Text fontSize="xs" color={isFigureItOutSelected ? 'whiteAlpha.800' : 'fg.muted'}>
                      Let the agent decide based on context
                    </Text>
                  </VStack>
                </Button>

                {/* Other option */}
                <Button
                  variant={isOtherSelected ? 'solid' : 'outline'}
                  bg={isOtherSelected ? 'accent.secondary' : 'transparent'}
                  color={isOtherSelected ? 'white' : 'fg.muted'}
                  borderColor="border.default"
                  onClick={() => toggleSelection({ label: 'Other', value: OTHER })}
                  justifyContent="flex-start"
                  height="auto"
                  py={3}
                  px={4}
                  whiteSpace="normal"
                  textAlign="left"
                >
                  <VStack gap={0} align="start" w="100%">
                    <Text fontSize="sm" fontWeight="500">Other</Text>
                    <Text fontSize="xs" color={isOtherSelected ? 'whiteAlpha.800' : 'fg.muted'}>
                      Provide your own response
                    </Text>
                  </VStack>
                </Button>

                {/* Text input for "Other" option */}
                {isOtherSelected && (
                  <Input
                    placeholder="Enter your response..."
                    value={otherText}
                    onChange={(e) => setOtherText(e.target.value)}
                    fontFamily="mono"
                    fontSize="sm"
                    mt={1}
                  />
                )}
              </>
            )}

            <HStack gap={2} justify="flex-end" mt={2}>
              {isCancellable && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleSubmit({ cancelled: true })}
                >
                  Cancel
                </Button>
              )}
              <Button
                size="sm"
                bg="accent.primary"
                color="white"
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

      default:
        return <Text color="accent.danger">Unknown input type: {props.type}</Text>;
    }
  };

  return (
    <Box
      border="1px solid"
      borderColor="accent.warning"
      borderRadius="md"
      bg="bg.surface"
      p={4}
      my={4}
    >
      <VStack gap={3} align="stretch">
        {/* Header */}
        <HStack gap={2}>
          <Icon as={LuTriangleAlert} boxSize={5} color="accent.warning" />
          <Text fontWeight="600" fontSize="sm">{props.title}</Text>
        </HStack>

        {/* Message */}
        {props.message && (
          <HStack gap={2} p={2} bg="accent.warning/25" borderRadius="sm">
            <Text fontSize="md" fontFamily={'mono'}>{props.message}</Text>
          </HStack>
        )}

        {/* Input UI */}
        {renderInput()}
      </VStack>
    </Box>
  );
}
