/**
 * Redux subscription-based waiting utility.
 *
 * Unlike RTL's `waitFor` (which polls every 50ms on a timer), this fires
 * synchronously on every Redux dispatch via `store.subscribe()`. The condition
 * is checked immediately at subscription time and on every subsequent dispatch,
 * so there is zero polling delay — it resolves in the same microtask as the
 * dispatch that satisfies the condition.
 *
 * Use this wherever a test asserts on Redux state directly (e.g. checking a
 * file was stored, a conversation finished, etc.). For DOM assertions, RTL's
 * `waitFor` / `findBy*` remains the right tool.
 */

import type { Store } from '@reduxjs/toolkit';
import type { RootState } from '@/store/store';
import { waitFor } from '@testing-library/react';
import { selectConversation } from '@/store/chatSlice';

/**
 * Wait for a Redux state condition, resolving as soon as any dispatch
 * satisfies the predicate.
 *
 * @param store     - The Redux store to subscribe to
 * @param selector  - Extract the value to test from state
 * @param predicate - Return true when the value satisfies the condition
 * @param timeout   - Maximum ms to wait before rejecting (default: 5000)
 *
 * @example
 * // Resolves the moment the file is stored — no polling delay
 * await waitForReduxState(
 *   testStore,
 *   state => state.files.files[fileId],
 *   file => file !== undefined && !file.loading,
 * );
 */
/**
 * Wait for a conversation to reach FINISHED state, tracking fork chains
 * (virtual conversation ID → real file ID) along the way.
 *
 * @param getState      - Thunk that returns the current RootState
 * @param virtualConvId - The virtual (negative) or initial conversation ID to track
 * @returns             - The real conversation ID once FINISHED
 */
export async function waitForConversationFinished(
  getState: () => RootState,
  virtualConvId: number,
): Promise<number> {
  let realConvId = virtualConvId;
  await waitFor(
    () => {
      const temp = selectConversation(getState(), virtualConvId);
      if (temp?.forkedConversationID) {
        realConvId = temp.forkedConversationID;
      }
      const conv = selectConversation(getState(), realConvId);
      expect(conv?.executionState).toBe('FINISHED');
    },
    { timeout: 40000 }
  );
  return realConvId;
}

export function waitForReduxState<T>(
  store: Store,
  selector: (state: RootState) => T,
  predicate: (value: T) => boolean,
  timeout = 5000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    // Check immediately — condition may already be true before any new dispatch
    const initial = selector(store.getState() as RootState);
    if (predicate(initial)) {
      resolve(initial);
      return;
    }

    const timer = setTimeout(() => {
      unsubscribe();
      reject(new Error(
        `waitForReduxState timed out after ${timeout}ms. ` +
        `Last value: ${JSON.stringify(selector(store.getState() as RootState))}`
      ));
    }, timeout);

    const unsubscribe = store.subscribe(() => {
      const value = selector(store.getState() as RootState);
      if (predicate(value)) {
        clearTimeout(timer);
        unsubscribe();
        resolve(value);
      }
    });
  });
}
