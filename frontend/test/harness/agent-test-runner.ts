/**
 * JSON-driven agent test harness.
 *
 * Translates plain JSON spec files into Jest `it()` blocks that run a real
 * agent turn and assert on the resulting conversation using JSONPath.
 *
 * Usage (inside a `describe` block):
 *   const specs = loadAgentTestSpecs(path.join(__dirname, 'agent-tests/my-suite.json'));
 *   runAgentTestSpecs(specs, { getStore });
 */

import * as fs from 'fs';
import { JSONPath } from 'jsonpath-plus';
import {
  createConversation,
  sendMessage,
  selectConversation,
} from '@/store/chatSlice';
import type { RootState } from '@/store/store';
import { waitFor } from '@/store/__tests__/test-utils';

// ============================================================================
// Types
// ============================================================================

export type TestAssertion =
  | { type: 'conversation_jsonpath'; expression: string }
  // Future types: { type: 'state_jsonpath'; expression: string }
  //               { type: 'file_jsonpath'; fileId: number; expression: string }
  ;

export interface AgentTestSpec {
  /** Human-readable test name. Defaults to a truncated user_prompt. */
  label?: string;
  user_prompt: string;
  /** Agent name. Defaults to 'AnalystAgent'. */
  agent?: string;
  /** Agent constructor args (e.g. { connection_id: 'test_connection' }). */
  agent_args?: Record<string, unknown>;
  /** All assertions must pass for the spec to pass. */
  test: TestAssertion[];
  /** Timeout in ms. Defaults to 120 000. */
  timeout?: number;
}

// ============================================================================
// Loader
// ============================================================================

/**
 * Load agent test specs from a JSON file.
 * The file must contain a JSON array of AgentTestSpec objects.
 */
export function loadAgentTestSpecs(filePath: string): AgentTestSpec[] {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Agent test spec file not found: ${filePath}`);
  }
  const raw = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(raw) as AgentTestSpec[];
}

// ============================================================================
// Assertion evaluation
// ============================================================================

function evaluateAssertion(assertion: TestAssertion, conv: unknown): boolean {
  if (assertion.type === 'conversation_jsonpath') {
    const results = JSONPath({ path: assertion.expression, json: conv as object });
    return Array.isArray(results) && results.length > 0;
  }
  throw new Error(`Unknown assertion type: "${(assertion as any).type}"`);
}

// ============================================================================
// Runner
// ============================================================================

/**
 * Register one Jest `it()` block per spec.
 * Must be called at describe-scope (not inside beforeEach/it).
 */
export function runAgentTestSpecs(
  specs: AgentTestSpec[],
  opts: { getStore: () => ReturnType<typeof import('@/store/__tests__/test-utils').setupTestStore> }
): void {
  specs.forEach((spec, i) => {
    const name = spec.label ?? `[${i}] ${spec.user_prompt.slice(0, 70)}`;
    const timeout = spec.timeout ?? 120_000;
    const agent = spec.agent ?? 'AnalystAgent';
    const agent_args = spec.agent_args ?? {};

    it(name, async () => {
      const store = opts.getStore();
      const tempId = -(2000 + i);

      // Start conversation
      store.dispatch(createConversation({ conversationID: tempId, agent, agent_args }));
      store.dispatch(sendMessage({ conversationID: tempId, message: spec.user_prompt }));

      // Wait for FINISHED — track fork if conversationID changes
      let realId = tempId;
      await waitFor(() => {
        const temp = selectConversation(store.getState() as RootState, tempId);
        if (temp?.forkedConversationID) realId = temp.forkedConversationID;
        const c = selectConversation(store.getState() as RootState, realId);
        return c?.executionState === 'FINISHED';
      }, timeout - 5_000);

      const conv = selectConversation(store.getState() as RootState, realId);
      if (!conv) throw new Error(`Conversation ${realId} not found in Redux state after FINISHED`);

      // Evaluate every assertion — collect failures so all are reported at once
      const failures: string[] = [];
      for (const assertion of spec.test) {
        const passed = evaluateAssertion(assertion, conv);
        if (!passed) {
          failures.push(
            `Assertion failed: ${JSON.stringify(assertion)}\n` +
            `Conversation snapshot (truncated):\n` +
            JSON.stringify(conv, null, 2).slice(0, 3000)
          );
        }
      }

      if (failures.length > 0) {
        throw new Error(failures.join('\n\n---\n\n'));
      }
    }, timeout);
  });
}
