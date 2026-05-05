// Scaffolding tools + agent that exercise the Orchestrator + MXAgent contract
// end-to-end. The base `MXAgent.llm()` (which calls `streamSimple`) is used
// unchanged — pi-ai's faux provider in tests scripts the LLM responses.

import {
  Type,
  registerFauxProvider,
  type Tool,
  type TSchema,
} from '@mariozechner/pi-ai';
import {
  MXAgent,
  MXTool,
  UserInputException,
  type ToolResponse,
} from '@/orchestrator/types';

// ============================================================================
// Faux provider — registered once per process; tests call setResponses() on
// the returned handle per scenario.
// ============================================================================

export const fauxRegistration = registerFauxProvider({
  api: 'faux-test-api',
  provider: 'faux-test',
  models: [{ id: 'stub-model' }],
});
const FAUX_MODEL = fauxRegistration.getModel();

// ============================================================================
// EchoTool — leaf tool that echoes its input
// ============================================================================

const EchoToolParams = Type.Object({
  text: Type.String(),
});

export class EchoTool extends MXTool<typeof EchoToolParams> {
  static readonly schema: Tool<typeof EchoToolParams> = {
    name: 'EchoTool',
    description: 'Echoes its text input back as a tool result.',
    parameters: EchoToolParams,
  };

  async run(): Promise<ToolResponse> {
    return {
      content: [{ type: 'text', text: `echo: ${this.parameters.text}` }],
      isError: false,
    };
  }
}

// ============================================================================
// PendingTool — leaf tool that always throws UserInputException
// ============================================================================

const PendingToolParams = Type.Object({
  prompt: Type.String(),
});

export class PendingTool extends MXTool<typeof PendingToolParams> {
  static readonly schema: Tool<typeof PendingToolParams> = {
    name: 'PendingTool',
    description: 'Signals it requires frontend execution. Always pauses.',
    parameters: PendingToolParams,
  };

  async run(): Promise<ToolResponse> {
    throw new UserInputException(this.id);
  }
}

// ============================================================================
// TestAgent — uses base MXAgent.llm() which calls pi-ai (via faux provider)
// ============================================================================

const TestAgentParams = Type.Object({
  userMessage: Type.String(),
});

export class TestAgent extends MXAgent<typeof TestAgentParams> {
  static readonly schema: Tool<typeof TestAgentParams> = {
    name: 'TestAgent',
    description: 'Test agent. LLM calls go through pi-ai\'s faux provider.',
    parameters: TestAgentParams,
  };
  static readonly tools: Tool<TSchema>[] = [EchoTool.schema, PendingTool.schema];
  static readonly model = FAUX_MODEL;

  protected systemPrompt = 'You are a test agent.';
}
