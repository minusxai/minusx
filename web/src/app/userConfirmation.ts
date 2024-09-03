import { dispatch } from "../state/dispatch"
import { getState } from "../state/store"
import { sleep } from "../helpers/utils"
import { toggleUserConfirmation } from "../state/chat/reducer"

export async function getUserConfirmation({content}: {content: string}) {
  const thread = getState().chat.activeThread
  const activeThread = getState().chat.threads[thread]
  const messages = activeThread.messages
  const msgIDX = messages.findLastIndex((message: any) => message.role === 'tool' && message.action.status === 'DOING');
  dispatch(toggleUserConfirmation({'show': true, 'content': content}))
  
  while (true){
    const state = getState()
    const userConfirmation = state.chat.threads[thread].userConfirmation
    if (userConfirmation.show && userConfirmation.userInput != 'NULL'){
      const userApproved = userConfirmation.userInput == 'APPROVE'
      console.log('User approved:', userApproved)
      dispatch(toggleUserConfirmation({'show': false, 'content': ''}))
      return userApproved
    }
    await sleep(100)
  }
}