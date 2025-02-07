import React, { useState, useEffect, useRef } from 'react';
import { Box, HStack, VStack, IconButton, Stack, Text } from '@chakra-ui/react'
import { BsFillHandThumbsUpFill, BsFillHandThumbsDownFill, BsDashCircle } from 'react-icons/bs';
import { dispatch } from '../../state/dispatch'
import { ChatMessage, addReaction, removeReaction, deleteUserMessage, ActionChatMessage } from '../../state/chat/reducer'
import _, { isEmpty } from 'lodash'
import { useSelector } from 'react-redux';
import { RootState } from '../../state/store';
import { ActionStack, ActionStatusView, OngoingActionStack } from './ActionStack';
import { ChatContent } from './ChatContent';
import { getApp } from '../../helpers/app';
import { SettingsBlock } from './SettingsBlock'
import { Markdown } from './Markdown';


// adds tool information like execution status and rendering info
// this stuff is in the 'tool' messages, but we're ony rendering 'assistant' messages
// so this copy needs to be done while rendering.
function addToolInfoToActionPlanMessages(messages: Array<ChatMessage>) {
  const toolMessages = messages.filter(message => message.role == 'tool') as Array<ActionChatMessage>
  const toolMessageMap = new Map(toolMessages.map((message: ActionChatMessage) => [message.action.id, message]))
  return messages.map(message => {
    if (message.role == 'assistant') {
      const toolCalls = message.content.toolCalls.map(toolCall => {
        const toolMessage = toolMessageMap.get(toolCall.id)
        if (toolMessage) {
          return {
            ...toolCall,
            status: toolMessage.action.status,
            renderInfo: toolMessage.content.renderInfo
          }
        } else {
          return toolCall
        }
      })
      return {
        ...message,
        content: {
          ...message.content,
          toolCalls
        }
      }
    } else {
      return message
    }
  })
}

const Chat: React.FC<ReturnType<typeof addToolInfoToActionPlanMessages>[number]> = ({
  index,
  role,
  content,
  feedback,
  debug
}) => {
  const [isHovered, setIsHovered] = useState(false);
  const reaction = feedback?.reaction
  const addPositiveReaction = () => dispatch(addReaction({index, reaction: "positive"}))
  const addNegativeReaction = () => dispatch(addReaction({index, reaction: "negative"}))
  const clearReactions = () => dispatch(removeReaction({index}))
  const clearMessages = () => dispatch(deleteUserMessage(index))
  if (content.type == 'BLANK') {
    return null
  } else if (content.type == 'ACTIONS') {
    if (!content.finished) {
      return null
    }
    const actions: ActionStatusView[] = []
    content.toolCalls.forEach(toolCall => {
      actions.push({
        finished: true,
        function: toolCall.function,
        status: toolCall.status,
        renderInfo: toolCall.renderInfo
      })
    })
    const latency = ('latency' in debug)? Math.round(debug.latency as number /100)/10 : 0
    return <ActionStack content={content.messageContent} actions={actions} status={'FINISHED'} index={index} latency={latency}/>
  }
  return (
    <HStack
      className={`chat ${role}`}
      justifyContent={role == 'user' ? 'end' : 'start'}
      width="100%"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <Box
        className={'bubble-container'}
        width="90%"
        // paddingBottom={1}
        position="relative"
      >
        <Box
          className={'bubble'}
          bg={role == 'user' ? 'minusxBW.300' : 'minusxGreen.800'}
          // bg={role == 'user' ? 'minusxBW.300' : 'minusxBW.600'}
          padding={3}
          borderRadius={role == 'user' ? '10px 10px 0 10px' : '10px 10px 10px 0'}
          color={role == 'user' ? 'minusxBW.900' : 'minusxBW.50'}
          position="relative"
        >
          <ChatContent content={content} />
          
          <Box
            position="absolute"
            bottom="-5px"
            left={role == 'user' ? 'auto' : '0px'}
            right={role == 'user' ? '0px' : 'auto'}
            width="0"
            height="0"
            borderWidth={'3px'}
            borderStyle={"solid"}
            borderTopColor={role == 'user' ? 'minusxBW.300' : 'minusxGreen.800'}
            // borderTopColor={role == 'user' ? 'minusxBW.300' : 'minusxBW.600'}
            borderBottomColor="transparent"
            borderRightColor={role == 'user' ? 'minusxBW.300' : 'transparent'}
            borderLeftColor={role == 'user' ? 'transparent' : 'minusxGreen.800'}
            // borderLeftColor={role == 'user' ? 'transparent' : 'minusxBW.600'}
          />
        </Box>
        {(isHovered || (reaction !== "unrated")) && (role == 'tool') && (
          <Box position="absolute" bottom={-1} right={0}>
            <IconButton
              aria-label="Thumbs up"
              isRound={true}
              icon={<BsFillHandThumbsUpFill />}
              size="xs"
              colorScheme={ reaction === "positive" ? "minusxGreen" : "minusxBW" }
              mr={1}
              onClick={reaction == "positive" ? clearReactions : addPositiveReaction}
            />
            <IconButton
              aria-label="Thumbs down"
              isRound={true}
              icon={<BsFillHandThumbsDownFill />}
              size="xs"
              colorScheme={ reaction === "negative" ? "minusxGreen" : "minusxBW" }
              onClick={reaction == "negative" ? clearReactions : addNegativeReaction}
            />
          </Box>
        )}
        {(isHovered || (reaction !== "unrated")) && (role == 'user') && (
          <Box position="absolute" bottom={-1} right={0}>
            <IconButton
              aria-label="Delete"
              isRound={true}
              icon={<BsDashCircle />}
              size="xs"
              colorScheme={ reaction === "positive" ? "minusxGreen" : "minusxBW" }
              mr={1}
              onClick={clearMessages}
            />
          </Box>
        )}
      </Box>
    </HStack>
  )
}

const useAppStore = getApp().useStore()

const HelperMessage = () => {
  const helperMessage = useAppStore((state) => state.helperMessage)
  if (!helperMessage) {
    return null
  }
  // return <Chat role='user' index={-1} content={{type: 'DEFAULT', text: helperMessage, images: []}} />
  return <SettingsBlock title={"Welcome"}><Markdown content={helperMessage}/></SettingsBlock>
  return 
}

export const ChatSection = () => {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const thread = useSelector((state: RootState) => state.chat.activeThread)
  const activeThread = useSelector((state: RootState) => state.chat.threads[thread])
  const messages = activeThread.messages

  useEffect(() => {
    setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }, 100);
  }, [messages.length]);
  // need to add status information to tool calls of role='assistant' messages
  // just create a map of all role='tool' messages by their id, and for each
  // tool call in each assistant message, add the status from the corresponding
  // tool message
  const messagesWithStatus = addToolInfoToActionPlanMessages(messages)
  const Chats = isEmpty(messagesWithStatus) ?
    <HelperMessage /> :
    messagesWithStatus.map((message, key) => (<Chat key={key} {...message} />))

  return (
  <HStack className='chat-section' wrap="wrap" style={{ overflowY: 'scroll' }} width={'100%'} gap={1.5}>
    {Chats}
    <OngoingActionStack />
    <div style={{ height: '10px', width: '100%' }} />
    <div ref={messagesEndRef} />
  </HStack>
  )
}
