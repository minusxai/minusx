/**
 * StoryThemePicker (Story_Design_V2 §5) — the settings picker is rendered FROM the theme
 * registry: one option per STORY_THEMES entry (label + description + preview image) plus a
 * "Default" option that clears the field. Selection reports the theme name (or null) via
 * onChange. aria-label-only queries per repo test rules.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChakraProvider, defaultSystem } from '@chakra-ui/react';

import StoryThemePicker from '../StoryThemePicker';
import { STORY_THEMES } from '@/lib/data/story/story-themes';

const renderPicker = (props: Partial<React.ComponentProps<typeof StoryThemePicker>> = {}) => {
  const onChange = vi.fn();
  const onClose = vi.fn();
  render(
    <ChakraProvider value={defaultSystem}>
      <StoryThemePicker
        isOpen
        onClose={onClose}
        themes={STORY_THEMES}
        value={null}
        onChange={onChange}
        {...props}
      />
    </ChakraProvider>,
  );
  return { onChange, onClose };
};

describe('StoryThemePicker', () => {
  it('renders one option per registry theme plus a Default option', async () => {
    renderPicker();
    expect(await screen.findByLabelText('Story theme picker')).toBeTruthy();
    for (const t of STORY_THEMES) {
      expect(screen.getByLabelText(`Theme ${t.label}`)).toBeTruthy();
    }
    expect(screen.getByLabelText('Theme Default')).toBeTruthy();
  });

  it('clicking a theme reports its name via onChange', async () => {
    const { onChange } = renderPicker();
    await userEvent.click(await screen.findByLabelText('Theme Nocturne'));
    expect(onChange).toHaveBeenCalledWith('nocturne');
  });

  it('clicking Default clears the theme (onChange(null))', async () => {
    const { onChange } = renderPicker({ value: 'organic' });
    await userEvent.click(await screen.findByLabelText('Theme Default'));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('renders nothing when closed', () => {
    renderPicker({ isOpen: false });
    expect(screen.queryByLabelText('Story theme picker')).toBeNull();
  });
});
