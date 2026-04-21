'use client';

import { Box, HStack, VStack, Text, Icon, Badge, GridItem } from '@chakra-ui/react';
import { LuCheck, LuX, LuBadgeInfo } from 'react-icons/lu';
import { DisplayProps, ClarifyDetails, contentToDetails } from '@/lib/types';
import { type DetailCardProps, parseToolArgs, parseToolContent, isToolSuccess } from './DetailCarousel';
import { useMemo } from 'react';
import { useSelector } from 'react-redux';
import type { RootState } from '@/store/store';
import { makeSelectConversationByToolCallId } from '@/store/chatSlice';
import UserInputComponent from '../UserInputComponent';

// ─── Shared helpers ───────────────────────────────────────────────

function parseClarifySelection(content: any): { success: boolean; selection: any; message: string } {
  const success = content?.success !== false;
  const selection = content?.details?.selection || content?.selection || null;
  const message = content?.details?.message || content?.message || '';
  return { success, selection, message };
}

function getSelectedLabels(selection: any): Set<string> {
  if (!selection) return new Set();
  if (selection.figureItOut || selection.other) return new Set();
  if (Array.isArray(selection)) {
    return new Set(selection.map((s: any) => s.label || String(s)));
  }
  return new Set([selection.label || String(selection)]);
}

// ─── Detail card for AgentTurnContainer carousel ──────────────────

export function ClarifyDetailCard({ msg }: DetailCardProps) {
  const toolMsg = msg as any;
  const toolCallId = toolMsg.tool_call_id;
  const args = parseToolArgs(msg);
  const rawContent = toolMsg.content;
  const isPending = !rawContent || rawContent === '(executing...)';
  const content = isPending ? {} : parseToolContent(msg);
  const { success, selection, message } = parseClarifySelection(content);
  const { question, options = [] } = args;

  // Check for pending user input in Redux (interactive clarification)
  const selectConversation = useMemo(() => makeSelectConversationByToolCallId(), []);
  const conversation = useSelector((state: RootState) => selectConversation(state, toolCallId));
  const pendingTool = conversation?.pending_tool_calls.find(p => p.toolCall.id === toolCallId);
  const pendingUserInputs = pendingTool?.userInputs?.filter(ui => ui.result === undefined);

  // If there's a pending user input, render the interactive UI
  if (pendingUserInputs && pendingUserInputs.length > 0 && conversation) {
    return (
      <Box mx={3} mb={2}>
        {pendingUserInputs.map(userInput => (
          <UserInputComponent
            key={userInput.id}
            conversationID={conversation.conversationID}
            tool_call_id={toolCallId}
            userInput={userInput}
            toolName={toolMsg.function?.name}
            toolArgs={args}
          />
        ))}
      </Box>
    );
  }

  const selectedLabels = getSelectedLabels(selection);
  const isFigureItOut = selection?.figureItOut;
  const isOther = selection?.other;

  const getStatusMessage = () => {
    if (isPending) return 'Waiting for response…';
    if (!success) return message || 'Cancelled';
    if (isFigureItOut) return 'Agent will figure it out';
    if (isOther) return `Other: "${selection.text}"`;
    return `Selected: ${Array.from(selectedLabels).join(', ')}`;
  };

  // Completed or non-interactive pending state
  return (
    <Box mx={3} mb={2} py={3} px={4} border="1px solid" borderColor="border.default" borderRadius="md" bg="bg.subtle">
      <VStack gap={2} align="stretch">
        {/* Question */}
        {question && (
          <Text fontSize="sm" color="fg.default" fontFamily="mono" fontWeight="600">
            {question}
          </Text>
        )}

        {/* Options */}
        {options.length > 0 && (
          <HStack gap={1} flexWrap="wrap">
            {options.map((opt: any, idx: number) => {
              const isSelected = !isPending && selectedLabels.has(opt.label);
              return (
                <Badge
                  key={idx}
                  bg={isSelected ? 'accent.teal/20' : 'bg.muted'}
                  color={isSelected ? 'accent.teal' : 'fg.muted'}
                  px={2} py={0.5} borderRadius="full" fontSize="xs" fontWeight="medium" fontFamily="mono"
                  opacity={isPending ? 0.8 : (!success ? 0.5 : (isSelected ? 1 : 0.6))}
                  display="flex" alignItems="center" whiteSpace="normal"
                >
                  {isSelected && <Icon as={LuCheck} boxSize={2.5} mr={1} flexShrink={0} />}
                  {opt.label}
                </Badge>
              );
            })}
            {!isPending && success && isFigureItOut && (
              <Badge bg="accent.teal/20" color="accent.teal" px={2} py={0.5} borderRadius="full"
                fontSize="xs" fontWeight="medium" fontFamily="mono" display="flex" alignItems="center">
                <Icon as={LuCheck} boxSize={2.5} mr={1} flexShrink={0} />Figure it out
              </Badge>
            )}
            {!isPending && success && isOther && (
              <Badge bg="accent.teal/20" color="accent.teal" px={2} py={0.5} borderRadius="full"
                fontSize="xs" fontWeight="medium" fontFamily="mono" display="flex" alignItems="center">
                <Icon as={LuCheck} boxSize={2.5} mr={1} flexShrink={0} />Other
              </Badge>
            )}
          </HStack>
        )}

        {/* Status */}
        <HStack gap={1}>
          <Icon as={isPending ? LuBadgeInfo : (success ? LuCheck : LuX)} boxSize={3}
            color={isPending ? 'fg.subtle' : (success ? 'accent.teal' : 'fg.muted')} />
          <Text fontSize="xs" fontFamily="mono"
            color={isPending ? 'fg.subtle' : (success ? 'accent.teal' : 'fg.muted')}
            fontStyle={isPending || !success ? 'italic' : 'normal'}>
            {getStatusMessage()}
          </Text>
        </HStack>
      </VStack>
    </Box>
  );
}

// ─── Compact display (existing) ───────────────────────────────────

export default function ClarifyDisplay({ toolCallTuple }: DisplayProps) {
  const [toolCall, toolMessage] = toolCallTuple;

  // Parse tool arguments to get question and options
  let args: any = {};
  try {
    args = typeof toolCall.function?.arguments === 'string'
      ? JSON.parse(toolCall.function.arguments)
      : toolCall.function?.arguments || {};
  } catch {
    args = {};
  }

  const { question, options = [] } = args;

  const { success, message, selection } = contentToDetails<ClarifyDetails>(toolMessage);

  // Check for special selections
  const isFigureItOut = selection?.figureItOut;
  const isOther = selection?.other;

  // Get selected labels for highlighting
  const getSelectedLabels = (): Set<string> => {
    if (!selection) return new Set();
    if (isFigureItOut || isOther) return new Set(); // Special options not in original list
    if (Array.isArray(selection)) {
      return new Set(selection.map(s => s.label || String(s)));
    }
    return new Set([selection.label || String(selection)]);
  };

  const selectedLabels = getSelectedLabels();

  // Format status message
  const getStatusMessage = () => {
    if (!success) return message || 'Cancelled';
    if (isFigureItOut) return 'Agent will figure it out';
    if (isOther) return `Other: "${selection.text}"`;
    return `Selected: ${Array.from(selectedLabels).join(', ')}`;
  };

  return (
    <GridItem colSpan={12} my={2}>
    <Box py={3} px={4} border="1px solid" borderColor="border.default" borderRadius="md" bg="bg.subtle">
      <VStack gap={3} align="stretch">
        {/* Header */}
        <HStack gap={2}>
          <Icon as={LuBadgeInfo} boxSize={4} fill="accent.teal" color="bg.subtle" />
          <Text fontSize="md" fontWeight="600" color="fg.default" fontFamily="mono">Clarification</Text>
        </HStack>

        {/* Question */}
        {question && (
          <Text fontSize="sm" color="fg.muted" fontFamily="mono">
            {question}
          </Text>
        )}

        {/* Options with selection state */}
        <VStack gap={1} align="stretch">
          {options.map((opt: any, idx: number) => {
            const isSelected = selectedLabels.has(opt.label);
            return (
              <Badge
                key={idx}
                bg={isSelected ? 'accent.teal/20' : 'bg.muted'}
                color={isSelected ? 'accent.teal' : 'fg.muted'}
                px={3}
                py={1}
                borderRadius="full"
                fontSize="sm"
                fontWeight="medium"
                fontFamily="mono"
                opacity={!success ? 0.5 : (isSelected ? 1 : 0.6)}
                display="flex"
                alignItems="center"
                whiteSpace="normal"
              >
                {isSelected && <Icon as={LuCheck} boxSize={3} mr={1} flexShrink={0} />}
                {opt.label}
              </Badge>
            );
          })}

          {/* Show special selection badges */}
          {success && isFigureItOut && (
            <Badge
              bg="accent.teal/20"
              color="accent.teal"
              px={3}
              py={1}
              borderRadius="full"
              fontSize="sm"
              fontWeight="medium"
              fontFamily="mono"
              display="flex"
              alignItems="center"
              whiteSpace="normal"
            >
              <Icon as={LuCheck} boxSize={3} mr={1} flexShrink={0} />
              Figure it out
            </Badge>
          )}
          {success && isOther && (
            <Badge
              bg="accent.teal/20"
              color="accent.teal"
              px={3}
              py={1}
              borderRadius="full"
              fontSize="sm"
              fontWeight="medium"
              fontFamily="mono"
              display="flex"
              alignItems="center"
              whiteSpace="normal"
            >
              <Icon as={LuCheck} boxSize={3} mr={1} flexShrink={0} />
              Other
            </Badge>
          )}
        </VStack>

        {/* Status message */}
        <HStack gap={1}>
          <Icon
            as={success ? LuCheck : LuX}
            boxSize={3}
            color={success ? 'accent.teal' : 'fg.muted'}
          />
          <Text fontSize="xs" color={success ? 'accent.teal' : 'fg.muted'} fontStyle={!success ? 'italic' : 'normal'} fontFamily="mono">
            {getStatusMessage()}
          </Text>
        </HStack>
      </VStack>
    </Box>
    </GridItem>
  );
}
