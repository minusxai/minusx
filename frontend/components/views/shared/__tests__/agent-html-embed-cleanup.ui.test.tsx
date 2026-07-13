/**
 * AgentHtml nested-root teardown. The story's live embeds render in a NESTED React root inside
 * the iframe; when the iframe document is rebuilt (content change → AgentHtml remounts / the
 * build effect re-runs), that root must be UNMOUNTED so every embed's effect cleanups run —
 * ECharts `dispose()`, ResizeObserver disconnects, etc. The old cleanup skipped the unmount
 * whenever the embed host was already disconnected (the common case: the new doc.write has
 * already destroyed the old document by the time the deferred unmount fires), leaking one
 * undisposed chart set per rebuild.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';

const state = vi.hoisted(() => ({ mounts: 0, cleanups: 0 }));

vi.mock('@/components/containers/SmartEmbeddedQuestionContainer', async () => {
  const React = await import('react');
  // Stands in for the real embed stack (chart + ECharts instance): the effect cleanup is the
  // dispose path under test.
  const FakeEmbed = () => {
    React.useEffect(() => {
      state.mounts++;
      return () => { state.cleanups++; };
    }, []);
    return React.createElement('div', { 'aria-label': 'Embedded question' });
  };
  return { __esModule: true, default: FakeEmbed };
});

import AgentHtml from '../AgentHtml';

const storyWithChart = (headline: string) =>
  `<div><h1>${headline}</h1><div data-question-id="14" style="width:400px;height:400px"></div></div>`;

const flushDeferredUnmount = () => new Promise(r => setTimeout(r, 20));

describe('AgentHtml — nested embed root teardown', () => {
  beforeEach(async () => {
    // Let deferred unmounts from the previous test's RTL cleanup fire before resetting counters.
    await flushDeferredUnmount();
    state.mounts = 0;
    state.cleanups = 0;
  });

  it('runs embed effect cleanups when the story content is rebuilt (chart dispose path)', async () => {
    const { rerender } = render(<AgentHtml html={storyWithChart('First headline')} width={800} colorMode="light" />);
    await waitFor(() => expect(state.mounts).toBe(1));

    // Content change → the build effect re-runs: cleanup tears the old doc down, the new
    // doc.write disconnects the old embed host BEFORE the deferred unmount fires.
    rerender(<AgentHtml html={storyWithChart('Second headline')} width={800} colorMode="light" />);
    await flushDeferredUnmount();

    // The old embed's cleanup (ECharts dispose in the real stack) must have run.
    await waitFor(() => expect(state.cleanups).toBe(1));
    await waitFor(() => expect(state.mounts).toBe(2)); // new doc's embed mounted fresh
  });

  it('runs embed effect cleanups when AgentHtml unmounts entirely', async () => {
    const { unmount } = render(<AgentHtml html={storyWithChart('Only headline')} width={800} colorMode="light" />);
    await waitFor(() => expect(state.mounts).toBe(1));

    unmount();
    await flushDeferredUnmount();

    await waitFor(() => expect(state.cleanups).toBe(1));
  });
});
