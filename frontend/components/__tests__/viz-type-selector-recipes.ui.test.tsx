/**
 * The selector's Workspace group: folder-resolved recipe tiles beside the
 * built-in type grid. Selection fires onRecipeSelect with the address (never
 * onChange), and the active frozen recipe's tile highlights.
 */
import { describe, it, expect, vi } from 'vitest';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import userEvent from '@testing-library/user-event';
import { VizTypeSelector } from '@/components/question/VizTypeSelector';

const RECIPES = [
  { name: 'bullet', description: 'Bullet chart', address: 'bullet' },
  { name: 'funnel-pro', description: 'Custom funnel', address: '/org/funnel-pro' },
];

describe('VizTypeSelector workspace recipes', () => {
  it('renders a tile per recipe and fires onRecipeSelect with the address', async () => {
    const onChange = vi.fn();
    const onRecipeSelect = vi.fn();
    const { getByLabelText } = renderWithProviders(
      <VizTypeSelector
        value="bar"
        onChange={onChange}
        orientation="grouped"
        includeV2Only
        workspaceRecipes={RECIPES}
        onRecipeSelect={onRecipeSelect}
      />,
    );
    await userEvent.click(getByLabelText('Recipe funnel-pro'));
    expect(onRecipeSelect).toHaveBeenCalledWith('/org/funnel-pro');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('highlights the active frozen recipe tile', () => {
    const { getByLabelText } = renderWithProviders(
      <VizTypeSelector
        value="custom"
        onChange={() => {}}
        orientation="grouped"
        includeV2Only
        workspaceRecipes={RECIPES}
        onRecipeSelect={() => {}}
        activeRecipeAddress="/org/funnel-pro"
      />,
    );
    expect(getByLabelText('Recipe funnel-pro').getAttribute('aria-pressed')).toBe('true');
    expect(getByLabelText('Recipe bullet').getAttribute('aria-pressed')).toBe('false');
  });

  it('renders no workspace tiles when none are provided', () => {
    const { queryByLabelText } = renderWithProviders(
      <VizTypeSelector value="bar" onChange={() => {}} orientation="grouped" includeV2Only />,
    );
    expect(queryByLabelText('Recipe bullet')).toBeNull();
  });
});
