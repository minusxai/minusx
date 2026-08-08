/**
 * SqlEditor owns the persistence boundary shared by every SQL-editing surface:
 * Monaco updates immediately, while controlled callers receive one coalesced
 * change after the common delay. Run must still observe the uncommitted text.
 */
import { act, fireEvent, screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import SqlEditor, { SQL_EDITOR_CHANGE_DEBOUNCE_MS } from '../SqlEditor';

vi.mock('@/lib/hooks/useConfigs', () => ({
  useConfigs: () => ({ config: { branding: { agentName: 'MinusX' } } }),
}));

describe('SqlEditor shared persistence boundary', () => {
  afterEach(() => vi.useRealTimers());

  it('coalesces edits by default for every caller', async () => {
    const onChange = vi.fn();
    renderWithProviders(<SqlEditor value="" onChange={onChange} />);
    const editor = await screen.findByLabelText('SQL editor');
    vi.useFakeTimers();

    fireEvent.change(editor, { target: { value: 'S' } });
    fireEvent.change(editor, { target: { value: 'SE' } });
    fireEvent.change(editor, { target: { value: 'SELECT 1' } });

    expect(onChange).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(SQL_EDITOR_CHANGE_DEBOUNCE_MS - 1); });
    expect(onChange).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('SELECT 1');
  });

  it('runs the latest Monaco text before its persistence delay expires', async () => {
    const onChange = vi.fn();
    const onRun = vi.fn();
    renderWithProviders(
      <SqlEditor value="SELECT 1" onChange={onChange} onRun={onRun} showRunButton />,
    );

    fireEvent.change(await screen.findByLabelText('SQL editor'), { target: { value: 'SELECT 2' } });
    fireEvent.click(screen.getByLabelText('Run query'));

    expect(onChange).toHaveBeenCalledWith('SELECT 2');
    expect(onRun).toHaveBeenCalledWith('SELECT 2');
  });

  it('keeps a newer pending edit alive when its own commit echoes back down', async () => {
    // The race: commit fires → caller persists → the committed text returns as
    // the controlled `value`. Keystrokes typed during that round trip are a
    // NEWER pending edit; the echo must not cancel them, or they are never
    // persisted (blur/unmount flush sees no pending and saves stale SQL).
    const onChange = vi.fn();
    const { rerender } = renderWithProviders(<SqlEditor value="" onChange={onChange} />);
    const editor = await screen.findByLabelText('SQL editor');
    vi.useFakeTimers();

    fireEvent.change(editor, { target: { value: 'SELECT 1' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(SQL_EDITOR_CHANGE_DEBOUNCE_MS); });
    expect(onChange).toHaveBeenCalledWith('SELECT 1');

    // User keeps typing before the commit round-trips back…
    fireEvent.change(editor, { target: { value: 'SELECT 12' } });
    // …then the echo of the earlier commit arrives as the controlled value.
    rerender(<SqlEditor value="SELECT 1" onChange={onChange} />);

    await act(async () => { await vi.advanceTimersByTimeAsync(SQL_EDITOR_CHANGE_DEBOUNCE_MS); });
    expect(onChange).toHaveBeenCalledWith('SELECT 12');
  });

  it('still discards a pending edit when a genuine external value arrives', async () => {
    // An agent edit (a value we never committed) is authoritative — the older
    // local timer must not overwrite it after the fact.
    const onChange = vi.fn();
    const { rerender } = renderWithProviders(<SqlEditor value="" onChange={onChange} />);
    const editor = await screen.findByLabelText('SQL editor');
    vi.useFakeTimers();

    fireEvent.change(editor, { target: { value: 'SELECT 1' } });
    rerender(<SqlEditor value="SELECT 99 -- agent edit" onChange={onChange} />);

    await act(async () => { await vi.advanceTimersByTimeAsync(SQL_EDITOR_CHANGE_DEBOUNCE_MS); });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('allows an explicit immediate-update escape hatch', async () => {
    const onChange = vi.fn();
    renderWithProviders(<SqlEditor value="" onChange={onChange} onChangeDebounceMs={0} />);

    fireEvent.change(await screen.findByLabelText('SQL editor'), { target: { value: 'SELECT 3' } });
    expect(onChange).toHaveBeenCalledWith('SELECT 3');
  });
});
