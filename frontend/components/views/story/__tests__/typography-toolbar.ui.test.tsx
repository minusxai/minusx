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
    fireEvent.click(screen.getByLabelText('Align justify'));
    expect(el.className).toBe('text-justify');
    // Clicking the active alignment clears it.
    fireEvent.click(screen.getByLabelText('Align justify'));
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

  it('advanced controls are hidden until "More formatting" is expanded; width stays basic', () => {
    renderToolbar('mt-4');
    expect(screen.queryByLabelText('Increase space above')).toBeNull();
    expect(screen.getByLabelText('Toggle full width')).toBeTruthy(); // basic row
    fireEvent.click(screen.getByLabelText('More formatting'));
    expect(screen.getByLabelText('Increase space above')).toBeTruthy();
    // Collapses again on a second click.
    fireEvent.click(screen.getByLabelText('More formatting'));
    expect(screen.queryByLabelText('Increase space above')).toBeNull();
  });

  it('steps spacing above and below independently', () => {
    const { el, onApply } = renderToolbar('mt-4 mb-8 text-lg');
    fireEvent.click(screen.getByLabelText('More formatting'));
    fireEvent.click(screen.getByLabelText('Increase space above'));
    expect(el.className).toBe('mt-6 mb-8 text-lg');
    fireEvent.click(screen.getByLabelText('Decrease space below'));
    expect(el.className).toBe('mt-6 mb-6 text-lg');
    expect(onApply).toHaveBeenLastCalledWith('0.0', { className: 'mt-6 mb-6 text-lg' });
  });

  it('full-width toggle strips max-w-* and restores the exact removed tokens on untoggle', () => {
    const { el, onApply } = renderToolbar('max-w-sm text-lg @2xl:max-w-4xl');
    const toggle = () => fireEvent.click(screen.getByLabelText('Toggle full width'));
    expect(screen.getByLabelText('Toggle full width').getAttribute('aria-pressed')).toBe('false');
    toggle();
    expect(el.className).toBe('text-lg');
    expect(onApply).toHaveBeenLastCalledWith('0.0', { className: 'text-lg' });
    expect(screen.getByLabelText('Toggle full width').getAttribute('aria-pressed')).toBe('true');
    toggle();
    expect(el.className).toBe('text-lg max-w-sm @2xl:max-w-4xl');
  });

  it('untoggling full width on an element that never had a max-width applies the default', () => {
    const { el } = renderToolbar('text-lg');
    expect(screen.getByLabelText('Toggle full width').getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByLabelText('Toggle full width'));
    expect(el.className).toBe('text-lg max-w-prose');
  });

  it('the fill picker sets an inline background and clears independently of text color', () => {
    const { el, onApply } = renderToolbar('text-lg');
    fireEvent.change(screen.getByLabelText('Text color'), { target: { value: '#ff0000' } });
    fireEvent.change(screen.getByLabelText('Fill color'), { target: { value: '#00ff00' } });
    expect(el.style.backgroundColor).toBe('rgb(0, 255, 0)');
    expect(el.style.color).toBe('rgb(255, 0, 0)');
    expect(onApply).toHaveBeenLastCalledWith('0.0', {
      className: 'text-lg',
      style: el.getAttribute('style') ?? '',
    });
    fireEvent.click(screen.getByLabelText('Default fill color'));
    expect(el.style.backgroundColor).toBe('');
    expect(el.style.color).toBe('rgb(255, 0, 0)'); // text color untouched
  });

  it('inner padding steps on the advanced row', () => {
    const { el, onApply } = renderToolbar('bg-muted');
    fireEvent.click(screen.getByLabelText('More formatting'));
    fireEvent.click(screen.getByLabelText('Increase inner padding'));
    expect(el.className).toBe('bg-muted p-1');
    fireEvent.click(screen.getByLabelText('Increase inner padding'));
    expect(el.className).toBe('bg-muted p-2');
    fireEvent.click(screen.getByLabelText('Decrease inner padding'));
    expect(onApply).toHaveBeenLastCalledWith('0.0', { className: 'bg-muted p-1' });
  });

  it('full-bleed toggle applies the bleed recipe and untoggle removes only what it added', () => {
    const { el } = renderToolbar('bg-primary px-6');
    fireEvent.click(screen.getByLabelText('More formatting'));
    const bleed = () => fireEvent.click(screen.getByLabelText('Toggle full bleed'));
    expect(screen.getByLabelText('Toggle full bleed').getAttribute('aria-pressed')).toBe('false');
    bleed();
    expect(el.className).toBe('bg-primary px-6 -mx-6 @2xl:-mx-12 @2xl:px-12');
    expect(screen.getByLabelText('Toggle full bleed').getAttribute('aria-pressed')).toBe('true');
    bleed();
    expect(el.className).toBe('bg-primary px-6'); // authored px-6 survives
  });

  it('buttons preventDefault on mousedown so the host never loses focus', () => {
    renderToolbar();
    // fireEvent returns false when preventDefault was called.
    expect(fireEvent.mouseDown(screen.getByLabelText('Toggle bold'))).toBe(false);
    expect(fireEvent.mouseDown(screen.getByLabelText('Increase font size'))).toBe(false);
  });
});
