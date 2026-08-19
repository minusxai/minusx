/**
 * The Templates page must render from REDUX, not from the built-in recipe
 * module's state.
 *
 * `setBuiltinVizTemplates` writes module-level state, and in the browser that
 * write happens in DataLoader's EFFECT — after the first render, and after
 * hydration. Reading it during render therefore makes the output depend on when
 * (and in which module instance) someone happened to fill it: the server and
 * the client can disagree, which surfaces as React #418 "text content did not
 * match", and a `useMemo` with no dependency on it never recovers.
 * `configs.vizTemplates` is in `preloadedState` at SSR, so deriving from it is
 * the same value on both sides.
 */
import React from 'react';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import { makeStore } from '@/store/store';
import { setBuiltinVizTemplates } from '@/lib/viz/builtin-recipes';
import TemplatesContainerV2 from '@/components/containers/TemplatesContainerV2';

vi.mock('@/lib/navigation/use-navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

const RECIPE = {
  description: 'A company recipe',
  engine: 'vega-lite',
  bindings: [
    { name: 'label', label: 'Label', accepts: ['nominal'] },
    { name: 'value', label: 'Value', accepts: ['quantitative'] },
  ],
  template: { mark: 'bar', encoding: { x: { field: '{{label}}', type: '{{label:kind}}' }, y: { field: '{{value}}', type: 'quantitative' } } },
};

it('lists a template that is in Redux but NOT yet in the module registry', async () => {
  // Exactly the first-render state in a browser: preloadedState carries the
  // templates, DataLoader's effect has not run, so module state is empty.
  setBuiltinVizTemplates({});
  const store = makeStore({
    configs: { vizTemplates: { 'company-kpi': { content: RECIPE, origin: 'deployment' } } },
  } as never);

  renderWithProviders(<TemplatesContainerV2 />, { store });

  expect(await screen.findByLabelText('Template company-kpi')).toBeTruthy();
});
