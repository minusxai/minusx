// The orchestrator-owned agent loop (`MXAgent.run()`) must enforce a step cap,
// hard-stop at `maxSteps` with a
// "Maximum iterations (N) reached." reply, and soft-withhold tools once the
// thread reaches `maxSteps − 5` so the model is forced to give a final answer.
// The cap VALUE comes from the concrete agent (static maxSteps); the loop
// mechanism lives in the base agent so every agent is covered uniformly.

import { Type } from 'typebox';
import type { TextContent, Tool } from '@/orchestrator/llm';
import {
  fauxAssistantMessage,
  fauxToolCall,
  registerFauxProvider,
} from '@/orchestrator/llm/testing';
import { Orchestrator } from '@/orchestrator/orchestrator';
import { MXAgent, type AgentContext } from '@/orchestrator/types';
import { EchoTool } from '../test-agent';

const faux = registerFauxProvider({
  api: 'faux-cap-api',
  provider: 'faux-cap',
  models: [{ id: 'cap-model' }],
});
const CAP_MODEL = faux.getModel();

const CappedParams = Type.Object({ userMessage: Type.String() });

// A minimal agent that loops via EchoTool (which resolves locally and continues
// the loop). maxSteps=6 → soft cap at toolThread.length >= 1, hard cap at 6.
class CappedAgent extends MXAgent<typeof CappedParams> {
  static readonly schema: Tool<typeof CappedParams> = {
    name: 'CappedAgent',
    description: 'Loops via EchoTool; exercises the maxSteps cap.',
    parameters: CappedParams,
  };
  static readonly tools = [EchoTool.schema];
  static readonly model = CAP_MODEL;
  static readonly maxSteps = 6;
  protected getSystemPrompt(): string {
    return 'capped';
  }
}

const ctx: AgentContext = { userId: 'u', mode: 'org' };

async function runCapped() {
  const orch = new Orchestrator([EchoTool, CappedAgent]);
  const agent = new CappedAgent(orch, { userMessage: 'go' }, ctx);
  const stream = orch.run(agent);
  for await (const _ of stream) {
    /* drain events */
  }
  return { agent, result: await stream.result() };
}

describe('MXAgent.run() step cap (parity with Python MAX_STEPS_LOWER_LEVEL)', () => {
  it('hard-stops with "Maximum iterations (N) reached." once the thread hits maxSteps', async () => {
    // Model never voluntarily stops — always calls a tool.
    faux.setResponses(
      Array.from({ length: 20 }, () =>
        fauxAssistantMessage([fauxToolCall('EchoTool', { text: 'loop' })], {
          stopReason: 'toolUse',
        }),
      ),
    );

    const { result } = await runCapped();

    expect(result).not.toBeNull();
    expect((result!.content[0] as TextContent).text).toBe('Maximum iterations (6) reached.');
    expect(result!.stopReason).toBe('stop');
  });

  it('soft-withholds tools once the thread reaches maxSteps − 5', async () => {
    const toolsPerCall: number[] = [];
    faux.setResponses(
      Array.from({ length: 20 }, () => (context: { tools?: unknown[] }) => {
        toolsPerCall.push(context.tools?.length ?? 0);
        return fauxAssistantMessage([fauxToolCall('EchoTool', { text: 'loop' })], {
          stopReason: 'toolUse',
        });
      }),
    );

    await runCapped();

    // First call: thread empty (0 < 1) → tool offered. Subsequent calls: thread
    // has grown past maxSteps − 5 (=1) → no tools, forcing the model to answer.
    expect(toolsPerCall[0]).toBe(1);
    expect(toolsPerCall[1]).toBe(0);
  });

  it('returns the model reply unchanged when it stops before the cap', async () => {
    faux.setResponses([fauxAssistantMessage('done', { stopReason: 'stop' })]);
    const { result } = await runCapped();
    expect((result!.content[0] as TextContent).text).toBe('done');
  });
});
