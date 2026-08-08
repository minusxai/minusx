/**
 * VizRecipeContainerV2's loading guard. A file first seen through a FOLDER
 * LISTING is metadata-only — `content` is null, because `getFiles` skips content
 * for speed — so spreading it yields `{}`, which is truthy. Guarding on "content
 * is truthy" therefore renders the view with no `bindings` and throws
 * `content.bindings is not iterable` into the page error boundary, which is what
 * clicking a recipe from its folder used to do. The guard must be that the
 * content is actually a RECIPE.
 */
import React from 'react';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import { setFile } from '@/store/filesSlice';
import type { DbFile } from '@/lib/types';
import VizRecipeContainerV2 from '@/components/containers/VizRecipeContainerV2';

const FILE_ID = 4242;

const RECIPE = {
  description: 'Simple KPI bar',
  engine: 'vega-lite',
  bindings: [
    { name: 'label', label: 'Label', accepts: ['nominal'] },
    { name: 'value', label: 'Value', accepts: ['quantitative'] },
  ],
  template: { mark: 'bar', encoding: { x: { field: '{{label}}', type: '{{label:kind}}' }, y: { field: '{{value}}', type: 'quantitative' } } },
};

const dbFile = (content: unknown, meta?: Record<string, unknown>): DbFile => ({
  id: FILE_ID, name: 'kpi-bar', path: '/org/kpi-bar', type: 'viz',
  references: [], version: 1, last_edit_id: null,
  created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
  content: content as DbFile['content'], ...(meta ? { meta } : {}),
} as DbFile);

describe('VizRecipeContainerV2', () => {
  it('keeps loading for a metadata-only row instead of rendering an empty recipe', async () => {
    const { store } = renderWithProviders(<VizRecipeContainerV2 fileId={FILE_ID} />);
    store.dispatch(setFile({ file: dbFile(null) }));
    expect(await screen.findByText(/Loading recipe/i)).toBeTruthy();
  });

  it('renders the recipe once content arrives', async () => {
    const { store } = renderWithProviders(<VizRecipeContainerV2 fileId={FILE_ID} />);
    store.dispatch(setFile({ file: dbFile(RECIPE) }));
    expect(await screen.findByLabelText('Recipe slots')).toBeTruthy();
  });

  it('shows the built-in notice and copy action for a catalog file', async () => {
    const { store } = renderWithProviders(<VizRecipeContainerV2 fileId={FILE_ID} />);
    store.dispatch(setFile({ file: dbFile(RECIPE, { readOnly: true, catalogTier: 'builtin', catalogCopyable: true }) }));
    expect(await screen.findByLabelText('Built-in recipe notice')).toBeTruthy();
    expect(await screen.findByLabelText('Copy recipe to my workspace')).toBeTruthy();
  });

  it('offers no copy action for a shipped recipe that is not a real template', async () => {
    const { store } = renderWithProviders(<VizRecipeContainerV2 fileId={FILE_ID} />);
    store.dispatch(setFile({ file: dbFile(RECIPE, {
      readOnly: true, catalogTier: 'shipped', catalogCopyable: false, recipeId: 'minusx/trend@1',
    }) }));
    expect(await screen.findByLabelText('Built-in recipe notice')).toBeTruthy();
    expect(screen.queryByLabelText('Copy recipe to my workspace')).toBeNull();
  });
});
