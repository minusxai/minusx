'use client';

import { useSelector } from 'react-redux';
import { Grid, GridItem, VStack } from '@chakra-ui/react';
import { CompletedToolCall } from '@/lib/types';
import { getToolConfig } from '@/lib/api/tool-config';
import type { RootState } from '@/store/store';
import UserInputComponent from './UserInputComponent';
import { DisplayProps } from '@/lib/types';


export default function ToolCallDisplay({ toolCallTuple, databaseName, isCompact, showThinking, markdownContext}: DisplayProps) {
  const [toolCall] = toolCallTuple;
  const functionName = toolCall.function.name;

  // Check if this tool has pending user inputs
  const conversation = useSelector((state: RootState) => {
    // Find conversation containing this tool call
    return Object.values(state.chat.conversations).find(conv =>
      conv.pending_tool_calls.some(p => p.toolCall.id === toolCall.id)
    );
  });

  const pendingTool = conversation?.pending_tool_calls.find(
    p => p.toolCall.id === toolCall.id
  );

  const pendingUserInputs = pendingTool?.userInputs?.filter(
    ui => ui.result === undefined
  );

  // If tool is waiting for user input, show that instead
  if (pendingUserInputs && pendingUserInputs.length > 0) {
    // Extract fileId from agent_args and tool arguments for UserInputComponent
    const fileId = conversation?.agent_args?.file_id;
    const toolArgs = pendingTool?.toolCall.function?.arguments;

    return (
        <GridItem colSpan={12}>
          <VStack gap={2} align="stretch">
            {pendingUserInputs.map(userInput => (
              <UserInputComponent
                key={userInput.id}
                conversationID={conversation!.conversationID}
                tool_call_id={toolCall.id}
                userInput={userInput}
                toolName={functionName}
                toolArgs={toolArgs}
                fileId={fileId}
              />
            ))}
          </VStack>
        </GridItem>
    );
  }

  // Otherwise, render normal tool display
  const config = getToolConfig(functionName);
  const DisplayComponent = config.displayComponent;

  // If no display component, don't render anything
  if (!DisplayComponent) {
    return null;
  }

  return (
        <DisplayComponent
            toolCallTuple={toolCallTuple}
            databaseName={databaseName}
            isCompact={isCompact}
            showThinking={showThinking}
            markdownContext={markdownContext}
        />
    )
}
