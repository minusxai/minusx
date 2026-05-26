/**
 * Regression test: re-rendering EChart with the same `option` reference must
 * NOT dispose+reinit the chart. The previous implementation defined
 * `chartSettings`, `events`, and `optionSettings` as inline default-value
 * objects in the component signature, so they gained a fresh identity on every
 * render. The init useEffect listed `chartSettings` and `events` as deps,
 * which caused dispose → init on every parent re-render. When `option` also
 * happened to be a stable reference, setOption did not fire on the new
 * instance and the chart rendered blank.
 *
 * Symptom: on dashboards, ECharts intermittently failed to render.
 */
import React, { useState } from 'react';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { EChartsOption } from 'echarts';

// Spy targets — hoisted so vi.mock can close over them.
const { initSpy, disposeSpy, setOptionSpy, onSpy, resizeSpy } = vi.hoisted(() => ({
  initSpy: vi.fn(),
  disposeSpy: vi.fn(),
  setOptionSpy: vi.fn(),
  onSpy: vi.fn(),
  resizeSpy: vi.fn(),
}));

vi.mock('echarts/core', () => {
  const instance = {
    setOption: setOptionSpy,
    dispose: disposeSpy,
    resize: resizeSpy,
    on: onSpy,
  };
  initSpy.mockImplementation(() => instance);
  return {
    init: initSpy,
    getInstanceByDom: vi.fn(() => instance),
  };
});

// echarts-init runs echarts.use() at module load; stub it out.
vi.mock('@/lib/chart/echarts-init', () => ({}));

import { EChart } from '@/components/plotx/EChart';

const SAMPLE_OPTION: EChartsOption = { series: [{ type: 'line', data: [1, 2, 3] }] };

/** Wrapper that lets the test force a parent re-render without changing `option`. */
function Harness({ option }: { option: EChartsOption }) {
  const [bump, setBump] = useState(0);
  return (
    <div>
      <button aria-label="Force re-render" onClick={() => setBump((n) => n + 1)}>
        bump {bump}
      </button>
      <EChart option={option} />
    </div>
  );
}

describe('EChart re-render stability', () => {
  beforeEach(() => {
    initSpy.mockClear();
    disposeSpy.mockClear();
    setOptionSpy.mockClear();
  });

  it('does NOT dispose+reinit the chart when the parent re-renders with the same option', async () => {
    const user = userEvent.setup();
    render(<Harness option={SAMPLE_OPTION} />);

    expect(initSpy).toHaveBeenCalledTimes(1);
    expect(disposeSpy).not.toHaveBeenCalled();
    // The fix seeds the initial option inside the init effect AND in the
    // option-change effect, so it may be applied more than once on mount —
    // what matters is that the latest call carries the current option.
    expect(setOptionSpy).toHaveBeenLastCalledWith(SAMPLE_OPTION, expect.any(Object));

    // Force the parent to re-render. The `option` prop reference is unchanged.
    await user.click(screen.getByLabelText('Force re-render'));
    await user.click(screen.getByLabelText('Force re-render'));

    // The chart should not have been torn down and rebuilt.
    expect(disposeSpy).not.toHaveBeenCalled();
    expect(initSpy).toHaveBeenCalledTimes(1);
  });

  it('applies setOption when the option prop changes', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<Harness option={SAMPLE_OPTION} />);

    expect(setOptionSpy).toHaveBeenLastCalledWith(SAMPLE_OPTION, expect.any(Object));

    const nextOption: EChartsOption = { series: [{ type: 'bar', data: [4, 5, 6] }] };
    rerender(<Harness option={nextOption} />);

    expect(setOptionSpy).toHaveBeenLastCalledWith(nextOption, expect.any(Object));
    expect(disposeSpy).not.toHaveBeenCalled();
    expect(initSpy).toHaveBeenCalledTimes(1);

    // Sanity: an extra unrelated re-render still doesn't tear down.
    await act(async () => {
      await user.click(screen.getByLabelText('Force re-render'));
    });
    expect(disposeSpy).not.toHaveBeenCalled();
  });
});
