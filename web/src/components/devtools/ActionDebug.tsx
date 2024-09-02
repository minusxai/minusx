import React, { useEffect, useState } from 'react'
import {
  Box,
  Text,
  Button,
  Textarea,
} from '@chakra-ui/react'
import { ActionPlanChatMessage, ChatMessage } from '../../state/chat/reducer'
import { useSelector } from 'react-redux'
import { RootState } from '../../state/store'
import { getApp } from '../../helpers/app'
import { ActionDescription } from 'apps/types'

interface ExecutableAction {
  function: string
  args: any
}

const executeAction = (action: ExecutableAction) => {
  let args = action.args
  if (typeof args == 'string') {
    try {
      args = JSON.parse(action.args)
    } catch (e) {}
  }
  getApp().actionController.runAction(action.function, args)
}

export const ActionsView: React.FC<null> = () => {
  const activeThread = useSelector((state: RootState) => state.chat.threads[state.chat.activeThread])
  const actionPlans: ActionPlanChatMessage[] = []
  activeThread.messages.forEach((message: ChatMessage) => {
    if (message.role == 'assistant') {
      actionPlans.push(message)
    }
  })
  const allActions = actionPlans.map((actionPlan) => {
    const actions: ExecutableAction[] = []
    actionPlan.content.toolCalls.forEach((tool, index) => {
      actions.push({
        function: tool.function.name,
        args: tool.function.arguments,
      })
    })
    return actions
  })
  const actionButtons = allActions.map((actions, index) => {
    const actionDisplay = actions.map((action, jindex) => {
      return (
        <Box key={jindex}>
          <Text>Function: {action.function}</Text>
          <Text>Args: {action.args}</Text>
          <Button colorScheme={"minusxGreen"} mt={2} onClick={() => executeAction(action)}>Execute</Button>
        </Box>
      )
    })
    return (
      <Box backgroundColor={"minusxBW.300"} p={2} borderRadius={5} mt={2} key={index}>
        <Text>Plan index: {index}</Text>
        {actionDisplay}
      </Box>
    )
  })
  const [allAppActions, setAllAppActions] = useState<ActionDescription[]>([])
  useEffect(() => {
    getApp().getPlannerConfig().then(plannerConfig => {
      if (plannerConfig.type === 'cot') {
        setAllAppActions(plannerConfig.thinkingStage.actionDescriptions)
      } else {
        setAllAppActions(plannerConfig.actionDescriptions)
      }
    })
  }, [setAllAppActions])
  const customActions = allAppActions.map((rawAction, index) => {
    const action: ExecutableAction = {
      function: rawAction.name,
      args: JSON.stringify(Object.keys(rawAction.args)),
    }
    return <ActionDebug key={index} action={action} />
  })
  return (
    <Box>
      <Text fontSize="lg" fontWeight="bold">Action History</Text>
      {actionButtons}
      <Text fontSize="lg" fontWeight="bold">Custom Actions</Text>
      {customActions}
    </Box>
  )
}

const ActionDebug: React.FC<{action: ExecutableAction}> = ({ action }) => {
  const [args, setArgs] = useState<string>(action.args)
  const [result, setResult] = useState<string>('')
  const execute = async () => {
    const result = await executeAction({
      ...action,
      args: args
    })
    setResult(JSON.stringify(result))
  }
  return (
    <Box>
      <Text>Function: {action.function}</Text>
      <Textarea placeholder="args" value={args} onChange={e => setArgs(e.target.value)}/>
      <Text>Result: {result}</Text>
      <Button colorScheme={"minusxGreen"} mt={2} onClick={execute}>Execute</Button>
    </Box>
  )
}