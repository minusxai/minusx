/**
 * Mock LLM stream — used in place of a real LLM provider when testing.
 *
 * `agentLoop` from `@mariozechner/pi-agent-core` accepts an optional `streamFn`
 * (the function that calls the LLM and returns an AssistantMessageEventStream).
 * Providing a mock streamFn exercises the *real* agentLoop end-to-end — tool-call
 * parsing, parallel execution, beforeToolCall/afterToolCall hooks, conversation
 * building — while feeding pre-configured responses instead of hitting an LLM.
 *
 * Each call to the streamFn corresponds to one LLM turn. Configure with an array
 * where each entry is the `content` blocks of the assistant message for that turn.
 * Everything else (api/provider/model/usage/stopReason/timestamp) is filled from
 * the model arg + derived sensibly.
 */
import { createAssistantMessageEventStream } from '@mariozechner/pi-ai';
import type { AssistantMessage, Model, StreamFunction } from '@mariozechner/pi-ai';

/** The content blocks of one mocked assistant turn — real pi-ai types. */
export type MockTurnContent = AssistantMessage['content'];

const ZERO_USAGE = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

export class MockStreamFn {
  private turns: MockTurnContent[] = [];
  private callCount = 0;

  configure(turns: MockTurnContent[]): void {
    this.turns = turns;
    this.callCount = 0;
  }

  /** How many times the streamFn has been invoked (useful for assertions). */
  get calls(): number {
    return this.callCount;
  }

  asStreamFn(): StreamFunction {
    return ((model: Model<any>) => {
      const content = this.turns[this.callCount++];
      if (!content) {
        throw new Error(
          `MockStreamFn: no more turns configured (call #${this.callCount}). ` +
            `Configure ${this.callCount} or more turns.`,
        );
      }

      const stopReason: AssistantMessage['stopReason'] = content.some((c) => c.type === 'toolCall')
        ? 'toolUse'
        : 'stop';

      const message: AssistantMessage = {
        role: 'assistant',
        content,
        api: model.api,
        provider: model.provider,
        model: model.id,
        usage: ZERO_USAGE,
        stopReason,
        timestamp: 0,
      };

      const stream = createAssistantMessageEventStream();
      // agentLoop only requires `start` followed by `done` (or `error`); per-block
      // delta events are optional UI sugar.
      Promise.resolve().then(() => {
        stream.push({ type: 'start', partial: message });
        stream.push({ type: 'done', reason: stopReason, message });
      });

      return stream;
    }) as StreamFunction;
  }
}
