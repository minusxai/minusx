import {
  fauxAssistantMessage,
  fauxToolCall,
  type FauxResponseStep,
  type TextContent,
  type ToolCall,
} from '@mariozechner/pi-ai';
import { Orchestrator } from './orchestrator';
import type {
  AgentContext,
  ConversationLog,
  ConversationLogEntry,
  RegistrableClass,
} from './types';

export type ArgPredicateOp = '=' | '!=' | '~' | '!~' | '>' | '>=' | '<' | '<=' | 'contains';

export interface ArgPredicate {
  arg: string;
  op: ArgPredicateOp;
  value: unknown;
}

export type Assertion =
  | { kind: 'toolCalled'; name: string; args?: ArgPredicate[] }
  | { kind: 'oneOf'; names: string[] }
  | { kind: 'noToolCalled'; name: string }
  | { kind: 'callOrder'; names: string[] }
  | { kind: 'stopReached' }
  | { kind: 'finalText'; op: '~' | 'contains' | '='; value: string }
  | { kind: 'maxTurns'; n: number };

export type SpecResponse =
  | { type: 'toolUse'; toolCalls: { name: string; args: Record<string, unknown> }[] }
  | { type: 'stop'; text: string };

export interface TestSpec {
  name: string;
  agent: string;
  parameters: Record<string, unknown>;
  context: AgentContext;
  fauxResponses?: SpecResponse[];
  assertions: Assertion[];
}

export interface SpecResult {
  pass: boolean;
  failures: string[];
  log: ConversationLog;
}

export async function runAgentTestSpec(
  spec: TestSpec,
  registrables: RegistrableClass[],
  setFauxResponses?: (steps: FauxResponseStep[]) => void,
): Promise<SpecResult> {
  if (spec.fauxResponses) {
    if (!setFauxResponses) {
      throw new Error(`runAgentTestSpec: spec '${spec.name}' has fauxResponses but no setFauxResponses callback was provided`);
    }
    setFauxResponses(spec.fauxResponses.map(toFauxStep));
  }

  const Cls = registrables.find((r) => r.schema.name === spec.agent);
  if (!Cls) throw new Error(`runAgentTestSpec: agent '${spec.agent}' not in registrables`);

  const orch = new Orchestrator(registrables);
  const agent = new Cls(orch, spec.parameters, spec.context);
  const stream = orch.run(agent as Parameters<Orchestrator['run']>[0]);
  for await (const _ of stream) {/* drain */}
  await stream.result();

  const failures: string[] = [];
  for (const a of spec.assertions) {
    const err = evalAssertion(a, orch.log, agent.id);
    if (err) failures.push(err);
  }
  return { pass: failures.length === 0, failures, log: orch.log };
}

function toFauxStep(r: SpecResponse): FauxResponseStep {
  if (r.type === 'toolUse') {
    return fauxAssistantMessage(
      r.toolCalls.map((tc) => fauxToolCall(tc.name, tc.args)),
      { stopReason: 'toolUse' },
    );
  }
  return fauxAssistantMessage(r.text, { stopReason: 'stop' });
}

function evalAssertion(a: Assertion, log: ConversationLog, rootId: string): string | null {
  switch (a.kind) {
    case 'toolCalled': {
      const calls = collectToolCalls(log, a.name);
      if (calls.length === 0) return `toolCalled: '${a.name}' was never called`;
      if (a.args) {
        const matches = calls.some((tc) => a.args!.every((p) => evalArgPredicate(tc.arguments, p)));
        if (!matches) {
          return `toolCalled: '${a.name}' called but no invocation matched all args predicates ${JSON.stringify(a.args)}`;
        }
      }
      return null;
    }
    case 'oneOf': {
      const matched = a.names.filter((n) => collectToolCalls(log, n).length > 0);
      if (matched.length === 0) return `oneOf: none of [${a.names.join(', ')}] were called`;
      if (matched.length > 1) return `oneOf: expected exactly one of [${a.names.join(', ')}], got ${matched.join(', ')}`;
      return null;
    }
    case 'noToolCalled': {
      const calls = collectToolCalls(log, a.name);
      if (calls.length > 0) return `noToolCalled: '${a.name}' was called ${calls.length} time(s)`;
      return null;
    }
    case 'callOrder': {
      const sequence: string[] = [];
      for (const e of log) {
        if ('role' in e && e.role === 'assistant') {
          for (const c of e.content) {
            if (c.type === 'toolCall') sequence.push(c.name);
          }
        }
      }
      let i = 0;
      for (const name of sequence) {
        if (i < a.names.length && name === a.names[i]) i += 1;
      }
      if (i < a.names.length) {
        return `callOrder: expected [${a.names.join(' → ')}] in order, observed [${sequence.join(' → ')}]`;
      }
      return null;
    }
    case 'stopReached': {
      const stopReached = log.some(
        (e) => 'role' in e && e.role === 'assistant' && e.parent_id === rootId && e.stopReason === 'stop',
      );
      if (!stopReached) return 'stopReached: root never produced a stop AssistantMessage';
      return null;
    }
    case 'finalText': {
      const last = [...log]
        .reverse()
        .find(
          (e): e is typeof e & { role: 'assistant'; content: { type: string; text?: string }[]; stopReason: string } =>
            'role' in e && e.role === 'assistant' && e.parent_id === rootId && e.stopReason === 'stop',
        );
      if (!last) return 'finalText: no final stop AssistantMessage from root';
      const text = last.content
        .filter((c): c is TextContent => c.type === 'text')
        .map((c) => c.text)
        .join('\n');
      const pred: ArgPredicate = { arg: '_text', op: a.op, value: a.value };
      if (!evalArgPredicate({ _text: text }, pred)) {
        return `finalText: '${text}' did not satisfy op='${a.op}' value='${String(a.value)}'`;
      }
      return null;
    }
    case 'maxTurns': {
      const turns = log.filter(
        (e) => 'role' in e && e.role === 'assistant' && e.parent_id === rootId,
      ).length;
      if (turns > a.n) return `maxTurns: root produced ${turns} AssistantMessages, max allowed ${a.n}`;
      return null;
    }
  }
}

function collectToolCalls(log: ConversationLog, name: string): ToolCall[] {
  const out: ToolCall[] = [];
  for (const e of log) {
    if (!('role' in e) || e.role !== 'assistant') continue;
    for (const c of e.content) {
      if (c.type === 'toolCall' && c.name === name) out.push(c);
    }
  }
  return out;
}

function evalArgPredicate(args: Record<string, unknown>, p: ArgPredicate): boolean {
  const actual = args[p.arg];
  switch (p.op) {
    case '=': return actual === p.value || JSON.stringify(actual) === JSON.stringify(p.value);
    case '!=': return actual !== p.value && JSON.stringify(actual) !== JSON.stringify(p.value);
    case '~': return typeof actual === 'string' && new RegExp(p.value as string).test(actual);
    case '!~': return typeof actual === 'string' && !new RegExp(p.value as string).test(actual);
    case '>': return typeof actual === 'number' && actual > (p.value as number);
    case '>=': return typeof actual === 'number' && actual >= (p.value as number);
    case '<': return typeof actual === 'number' && actual < (p.value as number);
    case '<=': return typeof actual === 'number' && actual <= (p.value as number);
    case 'contains': {
      if (typeof actual === 'string') return actual.includes(p.value as string);
      if (Array.isArray(actual)) return actual.includes(p.value);
      return false;
    }
  }
}

// Re-export so tests can use the type narrowly.
export type { ConversationLogEntry };
