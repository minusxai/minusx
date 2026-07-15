/**
 * Zone-to-zone drag in the V2 encoding panel (V1 AxisBuilder parity): a chip already
 * sitting in a zone can be DRAGGED to another zone — one atomic envelope edit that adds
 * it to the target and removes it from the source. Regression: chips in zones had no
 * drag wiring at all, so "move category from Y to Color" silently did nothing.
 */
import React from 'react';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import { VegaEncodingPanel } from '@/components/viz/VegaEncodingPanel';
import { VIZ_GRAMMAR_VEGA_LITE } from '@/lib/validation/atlas-schemas';
import type { VizEnvelope } from '@/lib/validation/atlas-schemas';

const COLUMNS = ['week_start', 'category_name', 'revenue'];
const TYPES = ['TIMESTAMP', 'VARCHAR', 'DOUBLE'];

const vl = (spec: Record<string, unknown>): VizEnvelope =>
  ({ version: 2, source: { kind: 'vega-lite', grammar: VIZ_GRAMMAR_VEGA_LITE, spec } }) as unknown as VizEnvelope;

// The user's exact shape: a category accidentally folded into Y alongside the measure.
const foldedBar = vl({
  mark: 'bar',
  transform: [{ fold: ['revenue', 'category_name'], as: ['__mx_key', '__mx_value'] }],
  encoding: {
    x: { field: 'week_start', type: 'temporal' },
    y: { field: '__mx_value', type: 'quantitative', title: null },
    color: { field: '__mx_key', type: 'nominal', title: null },
  },
});

const specOf = (env: VizEnvelope) => (env.source as unknown as { spec: Record<string, any> }).spec;

describe('VegaEncodingPanel — zone-to-zone drag', () => {
  it('dragging a folded Y chip into Color moves it there (unfold + color) in ONE change', () => {
    const onVizChange = vi.fn();
    renderWithProviders(
      <VegaEncodingPanel envelope={foldedBar} columns={COLUMNS} types={TYPES} onVizChange={onVizChange} />,
    );

    fireEvent.dragStart(screen.getByLabelText('Zone chip category_name'));
    fireEvent.drop(screen.getByLabelText('Color / Series drop zone'));

    expect(onVizChange).toHaveBeenCalledTimes(1);
    const spec = specOf(onVizChange.mock.calls[0][0] as VizEnvelope);
    expect(spec.encoding.color.field).toBe('category_name'); // landed in Color
    expect(spec.encoding.y.field).toBe('revenue');           // Y unfolded back to the measure
    expect(spec.transform ?? []).toEqual([]);                // fold gone
  });

  it('dragging the X chip into Color moves it (x cleared, color set)', () => {
    const plain = vl({
      mark: 'bar',
      encoding: {
        x: { field: 'category_name', type: 'nominal' },
        y: { field: 'revenue', type: 'quantitative' },
      },
    });
    const onVizChange = vi.fn();
    renderWithProviders(
      <VegaEncodingPanel envelope={plain} columns={COLUMNS} types={TYPES} onVizChange={onVizChange} />,
    );

    fireEvent.dragStart(screen.getByLabelText('Zone chip category_name'));
    fireEvent.drop(screen.getByLabelText('Color / Series drop zone'));

    const spec = specOf(onVizChange.mock.calls.at(-1)![0] as VizEnvelope);
    expect(spec.encoding.color.field).toBe('category_name');
    expect(spec.encoding.x).toBeUndefined();
  });

  it('dropping a zone chip back on its own zone is a no-op', () => {
    const onVizChange = vi.fn();
    renderWithProviders(
      <VegaEncodingPanel envelope={foldedBar} columns={COLUMNS} types={TYPES} onVizChange={onVizChange} />,
    );

    fireEvent.dragStart(screen.getByLabelText('Zone chip category_name'));
    fireEvent.drop(screen.getByLabelText('Y-Axis drop zone'));

    expect(onVizChange).not.toHaveBeenCalled();
  });

  it('dragging a zone chip out (drag ends on no zone) removes it from its zone', () => {
    const onVizChange = vi.fn();
    renderWithProviders(
      <VegaEncodingPanel envelope={foldedBar} columns={COLUMNS} types={TYPES} onVizChange={onVizChange} />,
    );

    const chip = screen.getByLabelText('Zone chip category_name');
    fireEvent.dragStart(chip);
    fireEvent.dragEnd(chip); // no drop landed anywhere

    expect(onVizChange).toHaveBeenCalledTimes(1);
    const spec = specOf(onVizChange.mock.calls[0][0] as VizEnvelope);
    expect(spec.encoding.y.field).toBe('revenue'); // unfolded, category gone
    expect(spec.encoding.color?.field).not.toBe('category_name');
  });

  it('dragging from the COLUMNS list still assigns without removing anything', () => {
    const plain = vl({
      mark: 'bar',
      encoding: {
        x: { field: 'week_start', type: 'temporal' },
        y: { field: 'revenue', type: 'quantitative' },
      },
    });
    const onVizChange = vi.fn();
    renderWithProviders(
      <VegaEncodingPanel envelope={plain} columns={COLUMNS} types={TYPES} onVizChange={onVizChange} />,
    );

    fireEvent.dragStart(screen.getByLabelText('Column chip category_name'));
    fireEvent.drop(screen.getByLabelText('Color / Series drop zone'));

    const spec = specOf(onVizChange.mock.calls.at(-1)![0] as VizEnvelope);
    expect(spec.encoding.color.field).toBe('category_name');
    expect(spec.encoding.x.field).toBe('week_start'); // untouched
  });
});
