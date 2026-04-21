import { MessageWithFlags } from './messageHelpers';

/**
 * A "turn" groups a user message with all subsequent agent/tool messages
 * until the next user message. This is the unit of rendering in compact mode.
 */
export interface Turn {
  /** The user message that initiated this turn (undefined for the first turn if it starts with agent messages) */
  userMessage?: MessageWithFlags;
  /** All agent/tool/debug messages in this turn */
  agentMessages: MessageWithFlags[];
}

/**
 * Groups a flat list of messages into turns.
 * Each turn starts with a user message (except possibly the first turn)
 * and contains all subsequent non-user messages.
 */
export function groupIntoTurns(messages: MessageWithFlags[]): Turn[] {
  const turns: Turn[] = [];
  let currentTurn: Turn = { agentMessages: [] };

  for (const msg of messages) {
    if (msg.role === 'user') {
      // Flush current turn if it has content
      if (currentTurn.userMessage || currentTurn.agentMessages.length > 0) {
        turns.push(currentTurn);
      }
      // Start new turn with this user message
      currentTurn = { userMessage: msg, agentMessages: [] };
    } else {
      currentTurn.agentMessages.push(msg);
    }
  }

  // Flush final turn
  if (currentTurn.userMessage || currentTurn.agentMessages.length > 0) {
    turns.push(currentTurn);
  }

  return turns;
}
