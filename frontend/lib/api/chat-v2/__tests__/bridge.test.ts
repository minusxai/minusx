// bridgePendingTools: take orchestrator pending events → drive registered
// frontend handlers against real Redux → return pi-ai ToolResultMessage[].
//
// Two tests:
//   1. Drives a registered handler that ACTUALLY mutates Redux state, then
//      verifies (a) the bridge returns the right TRM shape and (b) the
//      Redux mutation was applied (proves real dispatch path).
//   2. Returns isError=true TRM when the registered handler throws — bridge
//      should never bubble errors so the orchestrator can recover.

vi.mock('@/lib/database/db-config', () => ({
  PGLITE_DATA_DIR: undefined,
  DB_PATH: undefined,
  DB_DIR: undefined,
  getDbType: () => 'pglite' as const,
}));

import { makeStore } from '@/store/store';
import { bridgePendingTools } from '../bridge';
import { registerFrontendTool } from '@/lib/api/tool-handlers';
import { setShowAdvanced } from '@/store/uiSlice';
import type { PendingToolCall } from '@/orchestrator/types';
import type { DatabaseWithSchema } from '@/lib/types';

const STUB_DB: DatabaseWithSchema = { databaseName: '', schemas: [] };

// Register two test-only frontend tools. registerFrontendTool mutates a
// module-level registry; these names won't collide with production ones.
registerFrontendTool('BridgeTestMutate', async (args, ctx) => {
  // Real Redux dispatch — proves the bridge plumbed dispatch through.
  ctx.dispatch?.(setShowAdvanced(args.value as boolean));
  return { content: `mutated to ${args.value}`, details: { success: true } };
});

registerFrontendTool('BridgeTestThrow', async () => {
  throw new Error('bridge test forced error');
});

describe('bridgePendingTools', () => {
  it('drives a registered handler against real Redux and returns a well-formed ToolResultMessage', async () => {
    const store = makeStore();
    expect(store.getState().ui.showAdvanced).toBe(false);

    const pending: PendingToolCall[] = [
      {
        id: 'p_mutate_1',
        name: 'BridgeTestMutate',
        parameters: { value: true },
        context: {},
        parent_id: 'parent_a',
      },
    ];

    const results = await bridgePendingTools(
      pending,
      store.dispatch,
      store.getState(),
      STUB_DB,
    );

    // (a) TRM shape is correct.
    expect(results).toHaveLength(1);
    expect(results[0].role).toBe('toolResult');
    expect(results[0].toolCallId).toBe('p_mutate_1');
    expect(results[0].toolName).toBe('BridgeTestMutate');
    expect(results[0].isError).toBe(false);
    expect(results[0].content[0]).toMatchObject({
      type: 'text',
      text: 'mutated to true',
    });

    // (b) Real Redux state actually mutated — handler.dispatch landed.
    expect(store.getState().ui.showAdvanced).toBe(true);
  });

  it('returns isError=true with the error message when a handler throws (orchestrator can recover)', async () => {
    const store = makeStore();
    const pending: PendingToolCall[] = [
      {
        id: 'p_throw_1',
        name: 'BridgeTestThrow',
        parameters: {},
        context: {},
        parent_id: 'parent_b',
      },
    ];

    const results = await bridgePendingTools(
      pending,
      store.dispatch,
      store.getState(),
      STUB_DB,
    );

    expect(results).toHaveLength(1);
    expect(results[0].isError).toBe(true);
    expect((results[0].content[0] as { text: string }).text).toContain('bridge test forced error');
  });

  it('preserves order across multiple pending tools', async () => {
    const store = makeStore();
    const pending: PendingToolCall[] = [
      { id: 'p_a', name: 'BridgeTestMutate', parameters: { value: false }, context: {}, parent_id: 'p' },
      { id: 'p_b', name: 'BridgeTestMutate', parameters: { value: true }, context: {}, parent_id: 'p' },
    ];
    const results = await bridgePendingTools(pending, store.dispatch, store.getState(), STUB_DB);
    expect(results.map((r) => r.toolCallId)).toEqual(['p_a', 'p_b']);
    // Last write wins for showAdvanced.
    expect(store.getState().ui.showAdvanced).toBe(true);
  });
});
