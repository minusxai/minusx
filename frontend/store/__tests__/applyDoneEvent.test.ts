// Regression test for the "blank success" bug: when the server embeds an error
// inside the `done` SSE frame (data.error) instead of emitting a separate
// `error` frame, the streaming consumer must surface it as an error rather than
// applying it as a successful (empty) turn. See applyDoneEvent in chatListener.

import { applyDoneEvent } from '@/store/chatListener';

describe('applyDoneEvent — error carried in the done frame', () => {
  const baseDone = {
    conversationID: 5,
    log_index: 1,
    completed_tool_calls: [],
    pending_tool_calls: [],
    debug: [],
  };

  it('throws (surfacing the error) when doneData.error is set, without applying the success path', () => {
    const dispatch = vi.fn();
    const done = { ...baseDone, error: 'rate_limit_error: out of credits' };

    expect(() => applyDoneEvent(done, 5, 'stable-1', dispatch as never)).toThrow(
      'rate_limit_error: out of credits',
    );
    // Must NOT have applied the conversation update as if it succeeded.
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('applies the conversation update normally when there is no error', () => {
    const dispatch = vi.fn();

    expect(() => applyDoneEvent(baseDone, 5, 'stable-2', dispatch as never)).not.toThrow();
    // clearStreamingContent + updateConversation
    expect(dispatch).toHaveBeenCalledTimes(2);
  });
});
