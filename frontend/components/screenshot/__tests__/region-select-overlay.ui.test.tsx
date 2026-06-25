/**
 * RegionSelectOverlay — drag a rectangle, get onSelect(rect) in viewport coords. A too-small
 * drag (a click) cancels; Esc cancels. Located by aria-label only (project rule).
 */
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import RegionSelectOverlay from '../RegionSelectOverlay';

describe('RegionSelectOverlay', () => {
  it('emits onSelect with the dragged rectangle (viewport coords)', () => {
    const onSelect = vi.fn();
    const onCancel = vi.fn();
    renderWithProviders(<RegionSelectOverlay onSelect={onSelect} onCancel={onCancel} />);

    const overlay = screen.getByLabelText('Select a region to send to the agent');
    fireEvent.mouseDown(overlay, { clientX: 40, clientY: 30 });
    fireEvent.mouseMove(overlay, { clientX: 240, clientY: 180 });
    fireEvent.mouseUp(overlay, { clientX: 240, clientY: 180 });

    expect(onSelect).toHaveBeenCalledWith({ x: 40, y: 30, width: 200, height: 150 });
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('normalizes a bottom-right → top-left drag', () => {
    const onSelect = vi.fn();
    renderWithProviders(<RegionSelectOverlay onSelect={onSelect} onCancel={vi.fn()} />);
    const overlay = screen.getByLabelText('Select a region to send to the agent');
    fireEvent.mouseDown(overlay, { clientX: 300, clientY: 300 });
    fireEvent.mouseUp(overlay, { clientX: 100, clientY: 120 });
    expect(onSelect).toHaveBeenCalledWith({ x: 100, y: 120, width: 200, height: 180 });
  });

  it('treats a tiny drag (a click) as cancel, not a selection', () => {
    const onSelect = vi.fn();
    const onCancel = vi.fn();
    renderWithProviders(<RegionSelectOverlay onSelect={onSelect} onCancel={onCancel} />);
    const overlay = screen.getByLabelText('Select a region to send to the agent');
    fireEvent.mouseDown(overlay, { clientX: 50, clientY: 50 });
    fireEvent.mouseUp(overlay, { clientX: 52, clientY: 51 });
    expect(onSelect).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalled();
  });

  it('cancels on Escape', () => {
    const onCancel = vi.fn();
    renderWithProviders(<RegionSelectOverlay onSelect={vi.fn()} onCancel={onCancel} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalled();
  });
});
