/**
 * StoryTypographyToolbar — floating typography controls for the focused story text host.
 *
 * The toolbar mutates the live DOM element directly (instant feedback — the focused host is
 * render-frozen) and emits the full resolved class string via onApply for the AST write-back.
 * Buttons preventDefault on mousedown so focus never leaves the contenteditable host.
 */
import React from 'react';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '@/test/helpers/render-with-providers';

import StoryTypographyToolbar from '../StoryTypographyToolbar';
import type { StoryTextHostTarget, StoryFormatEdit } from '@/components/views/shared/StoryJsxBody';

function renderToolbar(initialClassName = '', overrides: Partial<React.ComponentProps<typeof StoryTypographyToolbar>> = {}) {
  const el = document.createElement('p');
  el.className = initialClassName;
  document.body.appendChild(el);
  const target: StoryTextHostTarget = { astPath: '0.0', el };
  const onApply = vi.fn<(astPath: string, edit: StoryFormatEdit) => void>();
  const utils = renderWithProviders(
    <StoryTypographyToolbar target={target} active onApply={onApply} {...overrides} />,
  );
  return { ...utils, el, onApply };
}

afterEach(() => {
  document.body.querySelectorAll('p').forEach(p => p.remove());
});

describe('StoryTypographyToolbar', () => {
  it('renders nothing without a target or when inactive', () => {
    renderToolbar('', { target: null });
    expect(screen.queryByLabelText('Typography toolbar')).toBeNull();
    renderToolbar('', { active: false });
    expect(screen.queryByLabelText('Typography toolbar')).toBeNull();
  });

  it('steps font size up and down, mutating the element and emitting the full class string', () => {
    const { el, onApply } = renderToolbar('text-base mt-2');
    fireEvent.click(screen.getByLabelText('Increase font size'));
    expect(el.className).toBe('text-lg mt-2'); // shifted IN PLACE — token order preserved
    expect(onApply).toHaveBeenLastCalledWith('0.0', { className: 'text-lg mt-2' });
    fireEvent.click(screen.getByLabelText('Decrease font size'));
    expect(el.className).toBe('text-base mt-2');
    expect(onApply).toHaveBeenLastCalledWith('0.0', { className: 'text-base mt-2' });
  });

  it('steps past an authored out-of-scale size (agent stories use text-6xl)', () => {
    const { el } = renderToolbar('text-6xl');
    fireEvent.click(screen.getByLabelText('Increase font size'));
    expect(el.className).toBe('text-7xl');
  });

  it('toggles bold on and off', () => {
    const { el, onApply } = renderToolbar();
    fireEvent.click(screen.getByLabelText('Toggle bold'));
    expect(el.className).toBe('font-bold');
    fireEvent.click(screen.getByLabelText('Toggle bold'));
    expect(el.className).toBe('');
    expect(onApply).toHaveBeenLastCalledWith('0.0', { className: '' });
  });

  it('italic and underline toggle independently', () => {
    const { el } = renderToolbar();
    fireEvent.click(screen.getByLabelText('Toggle italic'));
    fireEvent.click(screen.getByLabelText('Toggle underline'));
    expect(el.className.split(' ').sort()).toEqual(['italic', 'underline']);
    fireEvent.click(screen.getByLabelText('Toggle italic'));
    expect(el.className).toBe('underline');
  });

  it('alignment choices are mutually exclusive', () => {
    const { el } = renderToolbar();
    fireEvent.click(screen.getByLabelText('Align center'));
    expect(el.className).toBe('text-center');
    fireEvent.click(screen.getByLabelText('Align right'));
    expect(el.className).toBe('text-right');
    // Clicking the active alignment clears it.
    fireEvent.click(screen.getByLabelText('Align right'));
    expect(el.className).toBe('');
  });

  it('the color picker sets an inline color and commits className + style together', () => {
    const { el, onApply } = renderToolbar('text-lg');
    fireEvent.change(screen.getByLabelText('Text color'), { target: { value: '#ff0000' } });
    expect(el.style.color).toBe('rgb(255, 0, 0)');
    expect(onApply).toHaveBeenLastCalledWith('0.0', {
      className: 'text-lg',
      style: el.getAttribute('style') ?? '',
    });
  });

  it('Default text color clears the inline color (style removed when empty)', () => {
    const { el, onApply } = renderToolbar('text-lg');
    fireEvent.change(screen.getByLabelText('Text color'), { target: { value: '#ff0000' } });
    fireEvent.click(screen.getByLabelText('Default text color'));
    expect(el.style.color).toBe('');
    expect(onApply).toHaveBeenLastCalledWith('0.0', { className: 'text-lg', style: '' });
  });

  it('buttons preventDefault on mousedown so the host never loses focus', () => {
    renderToolbar();
    // fireEvent returns false when preventDefault was called.
    expect(fireEvent.mouseDown(screen.getByLabelText('Toggle bold'))).toBe(false);
    expect(fireEvent.mouseDown(screen.getByLabelText('Increase font size'))).toBe(false);
  });
});
