import { describe, it, expect } from 'vitest';
import { resolveThreadTs, type SlackInteractionPayload } from '@/lib/integrations/slack/interactions';

function payload(message?: SlackInteractionPayload['message'], container?: SlackInteractionPayload['container']): SlackInteractionPayload {
  return {
    type: 'block_actions',
    trigger_id: 't',
    user: { id: 'U1' },
    message,
    container,
  };
}

describe('resolveThreadTs', () => {
  it('continues the existing thread when the button message is a threaded reply', () => {
    expect(resolveThreadTs(payload({ ts: '200.2', thread_ts: '100.1' }))).toBe('100.1');
  });

  it('falls back to container.thread_ts when message.thread_ts is absent', () => {
    expect(resolveThreadTs(payload({ ts: '200.2' }, { thread_ts: '100.1' }))).toBe('100.1');
  });

  it('uses the message ts as the thread root when the message is not in a thread', () => {
    expect(resolveThreadTs(payload({ ts: '100.1' }))).toBe('100.1');
  });

  it('returns undefined when there is no message reference', () => {
    expect(resolveThreadTs(payload())).toBeUndefined();
  });
});
