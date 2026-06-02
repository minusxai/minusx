/**
 * Types + helpers for Slack interactivity (block_actions) payloads.
 * Kept dependency-free so it can be unit-tested without pulling in the
 * orchestration stack that the interact route depends on.
 */

export interface SlackInteractionPayload {
  type: 'block_actions';
  trigger_id: string;
  user: { id: string; team_id?: string };
  team?: { id: string };
  channel?: { id: string };
  container?: { message_ts?: string; thread_ts?: string };
  message?: { ts: string; thread_ts?: string };
  actions?: Array<{
    action_id: string;
    value?: string;
    type: string;
  }>;
}

/**
 * Resolve the thread the bot should reply in when a button is clicked.
 *
 * - If the button's message is already a threaded reply, continue that thread
 *   (`message.thread_ts`, or `container.thread_ts`).
 * - Otherwise the message itself is the thread root, so reply under it
 *   (`message.ts`).
 *
 * Returns undefined only when the payload carries no message reference at all.
 */
export function resolveThreadTs(payload: SlackInteractionPayload): string | undefined {
  return (
    payload.message?.thread_ts ??
    payload.container?.thread_ts ??
    payload.message?.ts
  );
}
