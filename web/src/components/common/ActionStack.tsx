import React, { useState, useEffect, act } from 'react';
import { Box, HStack, Icon, Spinner, Text, keyframes, VStack, Button } from '@chakra-ui/react'
import { Action } from '../../state/chat/reducer'
import { useSelector } from 'react-redux';
import { RootState } from '../../state/store';
import { BsChevronRight, BsChevronDown } from 'react-icons/bs';
import { BiUndo, BiRedo } from "react-icons/bi";
import { executeAction } from '../../planner/plannerActions'

import {
  MdOutlineIndeterminateCheckBox,
  MdOutlineCheckBox,
  MdOutlineCheckBoxOutlineBlank,
  MdOutlineTimer
} from 'react-icons/md'
import { ChatContent } from './ChatContent';
import { getApp } from "../../helpers/app";
import 'reflect-metadata';
import { parseArguments } from '../../planner/plannerActions';
import { CodeBlock } from './CodeBlock';
import { ActionRenderInfo } from '../../state/chat/types';
import { Markdown } from './Markdown';

// Todo: Vivek: Hardcoding here, need to fix this later
// This is a list of actions that are undo/redoable
const UNDO_REDO_ACTIONS = ['ExecuteSQLClient']


function removeThinkingTags(input: string): string {
  return input ? input.replace(/<thinking>[\s\S]*?<\/thinking>/g, '') : input;
}

function extractMessageContent(input: string): string {
  const match = (input || "").match(/<Message>([\s\S]*?)<\/Message>/);
  return match ? match[1] : "";
}

export type ActionStatusView = Pick<Action, 'finished' | 'function' | 'status'> & {
  renderInfo: ActionRenderInfo
}

const useAppStore = getApp().useStore()

export const ActionStack: React.FC<{status: string, actions: Array<ActionStatusView>, index:number, content: string, latency: number}> = ({
  actions,
  status,
  index,
  content,
  latency
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const currentTool = useSelector((state: RootState) => state.settings.iframeInfo.tool)
  const controller = getApp().actionController
  const pageType = useAppStore((state) => state.toolContext.pageType) || '';
  const getActionLabels = (action: string, attr: string) => {
    if (controller) {
      const metadata = Reflect.getMetadata('actionMetadata', controller, action);
      if (metadata) {
        return metadata[attr];
      }
    }
    return action;
  }

  let title: string = "";
  if (status == 'FINISHED') {
    let titles = actions.map(action => getActionLabels(action.function.name, 'labelDone')) 
    title = [...new Set(titles)].join(', ')

  } else {
    let titles = actions.map(action => getActionLabels(action.function.name, 'labelRunning'))
    title = [...new Set(titles)].join(', ')

  }
  let preExpanderText = actions.map(action => {
    const { text } = action.renderInfo || {}
    return text || ''
  }).filter(text => text !== '').join(', ')


const UndoRedo: React.FC<{fn: string, sql: string, type: 'undo' | 'redo'}> = ({fn, sql, type}) => {
    const urHandler = (event: React.MouseEvent, fn: string, sql: string) => {
        event.preventDefault();
        event.stopPropagation();
        executeAction({
            index: -1,
            function: fn,
            args: {sql: sql},
        });
    };
    
    return <Button
            size="xs"
            leftIcon={ type === 'undo' ? <BiUndo /> : <BiRedo /> }
            variant={'solid'}
            colorScheme="minusxGreen"
            onClick={(event) => urHandler(event, fn, sql)}>
                {type === 'undo' ? 'Undo' : 'Redo'}
            </Button>
};

const PreExpanderUndo: React.FC = () => {
    return (
        <>
            {actions.map(action => {
                const { code, oldCode } = action.renderInfo || {}
                return UNDO_REDO_ACTIONS.includes(action.function.name) && (
                    <HStack>
                        {oldCode && <UndoRedo fn={action.function.name} sql={oldCode} type={'undo'}/> }
                        {code && <UndoRedo fn={action.function.name} sql={code} type={'redo'}/> }
                    </HStack>
                )
            })}
        </>
    );
};


  const toggleExpand = () => {
    setIsExpanded(!isExpanded)
  }

  return (
    <HStack aria-label="thinking-block" className={'action-stack'} justifyContent={'start'} maxWidth={"100%"} width={isExpanded ? "100%" : ""}> 
      <Box
        aria-label="thinking-block-container"
        // bg={'minusxGreen.800'}
        bg={'minusxBW.200'}
        // p={2}
        px={2}
        py={1}
        my={0}
        borderRadius={5}
        // color={'minusxBW.50'}
        color={'minusxGreen.800'}
        border={'1px'}
        width={'100%'}
        position="relative"
      > 
        {content && <>
          <ChatContent content={{
            type: "DEFAULT",
            images: [],
            text: extractMessageContent(content)
          }} />
          <br />
        </>}
        <HStack
          // add border only if actions are present
        //   paddingBottom={actions.length && isExpanded ? 1 : 0}
          p={0}
        >
          <VStack alignItems={"start"} flex={1} spacing={0}>
            {preExpanderText !== '' && 
            // <Text marginBottom={2} borderBottomWidth={1} borderBottomColor={'minusxGreen.800'} style={{ hyphens: 'auto' }} p={2} w={"100%"}>{"Thinking..."}<br/>{preExpanderText}</Text>
            <Box aria-label="thinking-content" borderBottomWidth={1} mb={1} borderBottomColor={'minusxGreen.800'}>
            <Markdown content={`Thinking...
                ${preExpanderText}`}></Markdown>
                </Box>

            }
            <HStack
              aria-label="thinking-header"
              paddingBottom={actions.length && isExpanded ? 1 : 0}
            marginBottom={actions.length && isExpanded ? 1 : 0}
          borderBottomWidth={ actions.length && isExpanded ? '1px' : '0px'}
        //   borderBottomColor={'minusxBW.50'}
          borderBottomColor={'minusxGreen.800'}
          justifyContent={'space-between'}
          onClick={toggleExpand} cursor={"pointer"}
            width={"100%"}
          >
            <HStack>
                {isExpanded ? <BsChevronDown strokeWidth={1}/> : <BsChevronRight strokeWidth={1}/>}
                <Box flex={5}>
                <Text>{title}</Text>
                </Box>
                { status != 'FINISHED' ? <Spinner size="xs" speed={'0.75s'} color="minusxBW.100" mx={3} /> : null }
            </HStack>
            {/* { isExpanded ? <Text fontSize={"12px"} flexDirection={"row"} display={"flex"} justifyContent={"center"} alignItems={"center"}><MdOutlineTimer/>{latency}{"s"}</Text> : null } */}
            {pageType && pageType == 'sql' && <PreExpanderUndo />}
            </HStack>
          </VStack>
        </HStack>
        {isExpanded && actions.map((action, index) => {
          const { text, code, oldCode, language } = action.renderInfo || {}
          return (
          <VStack className={'action'} padding={'2px'} key={index} alignItems={"start"}>
            <HStack>
              <Icon
                as={
                  !action.finished
                    ? MdOutlineCheckBoxOutlineBlank
                    : (action.status == 'SUCCESS' ?  MdOutlineCheckBox : MdOutlineIndeterminateCheckBox)
                }
                boxSize={5}
              />
              {/* <Text>{action.function.name}{text ? " | " : ""}{text}</Text> */}
                <Text>{action.function.name}</Text>
            </HStack>
            
            { code && <Box width={"100%"} p={2} bg={"#1e1e1e"} borderRadius={5}>
              <CodeBlock code={code || ""} tool={currentTool} oldCode={oldCode} language={language} />
             </Box>
            }
            
          </VStack>
        )})}
        {/* {isHovered && isExpanded && configs.IS_DEV && index >= 0 && (
        <Box position="absolute" top={-1} right={0}>
          <IconButton
            aria-label="Debug Info"
            isRound={true}
            icon={<BsBugFill />}
            size="xs"
            colorScheme={"minusxBW"}
            mr={1}
            onClick={showDebugInfo}
          />
        </Box>
        )} */}
      </Box>
    </HStack>
  )
}

export const OngoingActionStack: React.FC = () => {
  const thread = useSelector((state: RootState) => state.chat.activeThread)
  const activeThread = useSelector((state: RootState) => state.chat.threads[thread])
  
  if (activeThread.status == 'FINISHED') {
    return null
  }
  else if (activeThread.status == 'PLANNING') {
    return <PlanningActionStack/>
  } 
  else {
    const messages = activeThread.messages
    const lastMessage = messages[messages.length - 1]
    if (lastMessage.role != 'tool') {
      return null
    }
    const actionPlan = messages[lastMessage.action.planID]
    if (actionPlan.role != 'assistant') {
      return null
    }
    const actions: ActionStatusView[] = []
    actionPlan.content.actionMessageIDs.forEach((messageID: string) => {
      const message = messages[messageID]
      if (message.role == 'tool') {
        actions.push(message.action)
      }
    })
    return <ActionStack actions={actions} content={actionPlan.content.messageContent} status={activeThread.status} index={-1} latency={0}/>
  }
}

const scrollUp = keyframes`
  from {
    transform: translateY(100%);
    opacity: 0;
  }
  to {
    transform: translateY(0%);
    opacity: 1;
  }
  `;

const PlanningActionStack: React.FC = () => {
  const planningActions = ['Planning next steps', 'Thinking about the question', 'Understanding App state', 'Finalizing Actions', 'Validating Answers']
  const [currentTitleIndex, setCurrentTitleIndex] = useState(0);
  useEffect(() => {
    const intervalId = setInterval(() => {
      setCurrentTitleIndex((prevIndex) => (prevIndex + 1) % planningActions.length);
    }, 3000);
    return () => clearInterval(intervalId);
  }, []);

  return (
  <HStack aria-label={"planning"} className={'action-stack'} justifyContent={'start'} width={"100%"}> 
    <Box
      bg={'minusxGreen.800'}
      p={2}
      borderRadius={5}
      color={'minusxBW.50'}
      width={"100%"}
      display={"flex"}
      justifyContent={"center"}
    >
      <HStack>
        <Box>
          <Text key={currentTitleIndex} animation={currentTitleIndex > 0 ? `${scrollUp} 0.5s ease-in-out` : ""} >{planningActions[currentTitleIndex]}</Text>
        </Box>
        <Spinner size="xs" speed={'0.75s'} color="minusxBW.100" />
      </HStack>
    </Box>
  </HStack>
)}
