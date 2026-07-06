import { Type } from 'typebox';
import { coerceParameters, normalizeParameters, validateParameters } from '../utils';
import { runAgentTestSpec, type TestSpec } from './support/test-spec-runner';
import {
  EchoTool,
  TypedTool,
  PendingTool,
  ErrorTool,
  TestAgent,
  fauxRegistration,
} from '@/agents/test-agent/test-agent';

// Models occasionally emit tool-call arguments with the wrong primitive types —
// every value stringified — even on the native Anthropic API, e.g.
//   { fileIds: "[2158]", maxChars: "3000", runQueries: "false" }
// instead of { fileIds: [2158], maxChars: 3000, runQueries: false }.
// These args are stored verbatim in the conversation log and fed to tools, which
// then crash (e.g. a chat display doing `args.fileIds.map(...)` on a string).
// Coercion must normalize them to their schema types at ingestion.

const ReadFilesParams = Type.Object({
  fileIds: Type.Array(Type.Number()),
  maxChars: Type.Optional(Type.Number()),
  runQueries: Type.Optional(Type.Boolean()),
});

describe('coerceParameters', () => {
  it('parses a stringified JSON array into a real array of numbers', () => {
    const out = coerceParameters(ReadFilesParams, { fileIds: '[2158]' });
    expect(out.fileIds).toEqual([2158]);
  });

  it('coerces stringified number and boolean primitives', () => {
    const out = coerceParameters(ReadFilesParams, {
      fileIds: '[1, 2]',
      maxChars: '3000',
      runQueries: 'false',
    });
    expect(out.fileIds).toEqual([1, 2]);
    expect(out.maxChars).toBe(3000);
    expect(out.runQueries).toBe(false);
  });

  it('coerces a JSON array of stringified numbers to numbers', () => {
    const out = coerceParameters(ReadFilesParams, { fileIds: '["7", "8"]' });
    expect(out.fileIds).toEqual([7, 8]);
  });

  it('leaves already well-typed args unchanged', () => {
    const out = coerceParameters(ReadFilesParams, { fileIds: [5], maxChars: 10, runQueries: true });
    expect(out.fileIds).toEqual([5]);
    expect(out.maxChars).toBe(10);
    expect(out.runQueries).toBe(true);
  });

  it('does NOT JSON-parse args whose schema type is string', () => {
    const StringParams = Type.Object({ query: Type.String(), connectionId: Type.String() });
    const out = coerceParameters(StringParams, { query: '[1]', connectionId: '42' });
    expect(out.query).toBe('[1]');
    expect(out.connectionId).toBe('42');
  });
});

describe('normalizeParameters', () => {
  it('coerces stringified args AND applies schema defaults', () => {
    const WithDefault = Type.Object({
      fileIds: Type.Array(Type.Number()),
      maxChars: Type.Optional(Type.Number({ default: 10000 })),
    });
    const out = normalizeParameters(WithDefault, { fileIds: '[2158]' });
    expect(out.fileIds).toEqual([2158]);
    expect(out.maxChars).toBe(10000);
  });
});

describe('validateParameters', () => {
  it('accepts stringified-but-coercible args as valid', () => {
    const res = validateParameters(ReadFilesParams, {
      fileIds: '[2158]',
      maxChars: '3000',
      runQueries: 'false',
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.fileIds).toEqual([2158]);
      expect(res.value.maxChars).toBe(3000);
      expect(res.value.runQueries).toBe(false);
    }
  });

  it('still rejects genuinely invalid args', () => {
    const res = validateParameters(ReadFilesParams, { fileIds: 'not-an-array' });
    expect(res.ok).toBe(false);
  });
});

describe('orchestrator dispatch coerces stringified tool-call args', () => {
  it('stores typed args in the log AND hands the tool typed values', async () => {
    const spec: TestSpec = {
      name: 'coerce_stringified_args',
      agent: 'TestAgent',
      parameters: { userMessage: 'go' },
      context: { userId: 'u', mode: 'org' },
      fauxResponses: [
        // Model emits every arg stringified — the exact shape seen in prod.
        { type: 'toolUse', toolCalls: [{ name: 'TypedTool', args: { ids: '[2158]', count: '3000', flag: 'false' } }] },
        { type: 'stop', text: 'done' },
      ],
      assertions: [{ kind: 'stopReached' }],
    };

    const { pass, failures, log } = await runAgentTestSpec(
      spec,
      [EchoTool, TypedTool, PendingTool, ErrorTool, TestAgent],
      (steps) => fauxRegistration.setResponses(steps),
    );
    expect(failures).toEqual([]);
    expect(pass).toBe(true);

    // 1) Stored log: the assistant tool_use block's arguments are coerced — this
    //    is what the chat UI reads and `.map()`s, so it must be a real array.
    const storedArgs = log
      .flatMap((e) => ('role' in e && e.role === 'assistant' ? e.content : []))
      .find((c) => (c as { type?: string; name?: string }).type === 'toolCall'
        && (c as { name?: string }).name === 'TypedTool') as { arguments: Record<string, unknown> } | undefined;
    expect(storedArgs).toBeDefined();
    expect(storedArgs!.arguments.ids).toEqual([2158]);
    expect(storedArgs!.arguments.count).toBe(3000);
    expect(storedArgs!.arguments.flag).toBe(false);

    // 2) Execution: the tool itself received schema-typed values.
    const toolResult = log.find(
      (e) => 'role' in e && e.role === 'toolResult'
        && (e as { toolName?: string }).toolName === 'TypedTool',
    ) as { content: { type: string; text: string }[] } | undefined;
    expect(toolResult).toBeDefined();
    const echoed = JSON.parse(toolResult!.content[0].text);
    expect(echoed).toEqual({
      idsIsArray: true,
      idsElemTypes: ['number'],
      countType: 'number',
      flagType: 'boolean',
    });
  });
});
