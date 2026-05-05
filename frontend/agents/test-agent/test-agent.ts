
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

export const fauxRegistration = registerFauxProvider({
  api: 'faux-test-api',
  provider: 'faux-test',
  models: [{ id: 'stub-model' }],
});
const FAUX_MODEL = fauxRegistration.getModel();

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

const NestedAgentParams = Type.Object({
  userMessage: Type.String(),
});

export class NestedAgent extends MXAgent<typeof NestedAgentParams> {
  static readonly schema: Tool<typeof NestedAgentParams> = {
    name: 'NestedAgent',
    description: 'A nested test agent that finishes after one LLM turn.',
    parameters: NestedAgentParams,
  };
  static readonly tools: Tool<TSchema>[] = [EchoTool.schema];
  static readonly model = FAUX_MODEL;

  protected systemPrompt = 'You are a nested test agent.';
}

const TestAgentParams = Type.Object({
  userMessage: Type.String(),
});

export class TestAgent extends MXAgent<typeof TestAgentParams> {
  static readonly schema: Tool<typeof TestAgentParams> = {
    name: 'TestAgent',
    description: 'Test agent. LLM calls go through pi-ai\'s faux provider.',
    parameters: TestAgentParams,
  };
  static readonly tools: Tool<TSchema>[] = [
    EchoTool.schema,
    PendingTool.schema,
    NestedAgent.schema,
  ];
  static readonly model = FAUX_MODEL;

  protected systemPrompt = 'You are a test agent.';
}
