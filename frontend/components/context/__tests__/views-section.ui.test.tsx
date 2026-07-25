/**
 * ViewsSection — views are whitelisted with the SAME row UI tables use
 * (SchemaColumnRow, a real checkbox), plus a view-specific eye button that opens
 * the definition. The checkbox is shown in BOTH modes (state-reflecting when not
 * editable); the eye — mirroring the table row's "Preview" affordance — opens the
 * ViewWorkbench (editable in edit mode, read-only otherwise). Inherited views are
 * read-only (disabled checkbox + badge); disabled views show their reason.
 */
import React from 'react';
import { screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import ViewsSection from '@/components/context/ViewsSection';
import type { NameWhitelist, ViewDef } from '@/lib/types';

const ZONE_REVENUE: ViewDef = {
  name: 'zone_revenue',
  connection: 'warehouse',
  sql: 'SELECT zone_name, SUM(total) AS revenue FROM mxfood.orders GROUP BY 1',
  columns: [{ name: 'zone_name', type: 'VARCHAR' }, { name: 'revenue', type: 'DOUBLE' }],
  description: 'Revenue per zone',
};

function renderSection(overrides: Partial<React.ComponentProps<typeof ViewsSection>> & { editable?: boolean } = {}) {
  const onViewsChange = vi.fn();
  const onViewWhitelistChange = vi.fn();
  const editable = overrides.editable !== false;
  function Harness() {
    const [views, setViews] = React.useState<ViewDef[]>((overrides.views as ViewDef[]) ?? []);
    const [whitelist, setWhitelist] = React.useState<NameWhitelist | undefined>(overrides.viewWhitelist);
    return (
      <ViewsSection
        contextPath="/org/context"
        connection="warehouse"
        inheritedViews={[]}
        {...overrides}
        views={views}
        viewWhitelist={whitelist}
        onViewsChange={editable ? (next) => { onViewsChange(next); setViews(next); } : undefined}
        onViewWhitelistChange={editable ? (next) => { onViewWhitelistChange(next); setWhitelist(next); } : undefined}
      />
    );
  }
  renderWithProviders(<Harness />);
  return { onViewsChange, onViewWhitelistChange };
}

describe('ViewsSection', () => {
  it('lists this context\'s views with their column count, a checkbox, and a definition button', () => {
    renderSection({ views: [ZONE_REVENUE] });
    const row = screen.getByLabelText('View zone_revenue');
    expect(row.textContent).toContain('_views.zone_revenue');
    expect(row.textContent).toContain('2 cols');
    // whitelist checkbox — same affordance as a table
    expect(screen.getByLabelText('Expose view zone_revenue')).toBeTruthy();
    // and a real eye button to open the definition
    expect(screen.getByLabelText('Definition of zone_revenue')).toBeTruthy();
  });

  it('shows the exposure checkbox in VIEW mode too, but disabled (state-reflecting)', () => {
    renderSection({ views: [ZONE_REVENUE], editable: false });
    const box = screen.getByLabelText('Expose view zone_revenue') as HTMLInputElement;
    expect(box.checked).toBe(true);   // reflects that it's exposed
    expect(box.disabled).toBe(true);  // but not toggleable outside edit mode
    // the definition is still inspectable read-only
    expect(screen.getByLabelText('Definition of zone_revenue')).toBeTruthy();
  });

  it('marks inherited views with an "inherited" badge, and locks their checkbox in VIEW mode', () => {
    renderSection({ views: [], inheritedViews: [ZONE_REVENUE], editable: false });
    const row = screen.getByLabelText('View zone_revenue');
    expect(row.textContent).toContain('inherited');
    const box = screen.getByLabelText('Expose view zone_revenue') as HTMLInputElement;
    expect(box.checked).toBe(true);
    expect(box.disabled).toBe(true);
  });

  it('the eye button TOGGLES the definition open/closed; the row stays put', async () => {
    renderSection({ views: [ZONE_REVENUE] });
    const toggle = screen.getByLabelText('Definition of zone_revenue');

    fireEvent.click(toggle);
    // The ViewWorkbench (real question editor) expands with an editable name + Save,
    // and the row itself is still there (the panel opens BELOW, it doesn't replace it).
    expect(await screen.findByLabelText('View name')).toBeTruthy();
    expect(screen.getByLabelText('Save view')).toBeTruthy();
    expect(screen.getByLabelText('View zone_revenue')).toBeTruthy();
    expect(toggle.textContent).toMatch(/hide/i);

    // Same button hides it again — no separate Close control.
    fireEvent.click(screen.getByLabelText('Definition of zone_revenue'));
    await waitFor(() => expect(screen.queryByLabelText('View name')).toBeNull());
  });

  it('in view mode the definition opens READ-ONLY (no Save, no Close — the toggle hides it)', async () => {
    renderSection({ views: [ZONE_REVENUE], editable: false });
    fireEvent.click(screen.getByLabelText('Definition of zone_revenue'));
    expect(await screen.findByLabelText('View name')).toBeTruthy();
    expect(screen.queryByLabelText('Save view')).toBeNull();
    expect(screen.queryByLabelText('Close view')).toBeNull();
    fireEvent.click(screen.getByLabelText('Definition of zone_revenue'));
    await waitFor(() => expect(screen.queryByLabelText('View name')).toBeNull());
  });

  it('scopes views to the connection', () => {
    renderSection({ views: [{ ...ZONE_REVENUE, connection: 'other' }] });
    expect(screen.queryByLabelText('View zone_revenue')).toBeNull();
  });

  // ── Deleting a data model from its row ──────────────────────────────────
  // Delete used to live ONLY in the workbench footer, below a 480px editor —
  // and vanished entirely for a DISABLED model (which opens read-only), leaving
  // it unremovable. It belongs on the row, like semantic models.

  describe('row-level delete', () => {
    it('deletes an own view straight from its row in edit mode', () => {
      const { onViewsChange } = renderSection({ views: [ZONE_REVENUE] });
      fireEvent.click(screen.getByLabelText('Delete view zone_revenue'));
      expect(onViewsChange).toHaveBeenCalledWith([]);
      expect(screen.queryByLabelText('View zone_revenue')).toBeNull();
    });

    it('deletes a DISABLED view — the reason it broke must not trap it here', () => {
      const { onViewsChange } = renderSection({
        views: [ZONE_REVENUE],
        problems: [{ view: 'zone_revenue', reason: 'reads mxfood.orders, which is not offered by the parent knowledge base' }],
      });
      const row = screen.getByLabelText('View zone_revenue');
      expect(row.textContent).toContain('DISABLED');
      fireEvent.click(screen.getByLabelText('Delete view zone_revenue'));
      expect(onViewsChange).toHaveBeenCalledWith([]);
    });

    it('offers no delete in view mode, nor on an inherited row (it is not ours to delete)', () => {
      renderSection({ views: [ZONE_REVENUE], editable: false });
      expect(screen.queryByLabelText('Delete view zone_revenue')).toBeNull();

      cleanup();
      renderSection({ views: [], inheritedViews: [ZONE_REVENUE] });
      expect(screen.queryByLabelText('Delete view zone_revenue')).toBeNull();
    });
  });

  // ── The child's half of inheritance: declining an offered model ──────────

  describe('whitelisting the inherited views', () => {
    const OTHER: ViewDef = { name: 'other', connection: 'warehouse', sql: 'SELECT 1', columns: [] };

    it('starts wildcarded (everything offered is taken), and the child gets a say', async () => {
      const { onViewWhitelistChange } = renderSection({ views: [], inheritedViews: [ZONE_REVENUE, OTHER] });
      const box = screen.getByLabelText('Expose view zone_revenue') as HTMLInputElement;
      expect(box.checked).toBe(true);
      expect(box.disabled).toBe(false);

      // Unchecking materialises the selection — the same two-step tables take.
      fireEvent.click(box);
      await waitFor(() => expect(onViewWhitelistChange).toHaveBeenCalledWith(['other']));
    });

    it('re-checks the last missing view back to the wildcard, not a frozen full list', async () => {
      // A full explicit list would look identical but silently refuse models
      // added upstream later.
      const { onViewWhitelistChange } = renderSection({
        views: [], inheritedViews: [ZONE_REVENUE, OTHER], viewWhitelist: ['other'],
      });
      const box = screen.getByLabelText('Expose view zone_revenue') as HTMLInputElement;
      expect(box.checked).toBe(false);  // still listed — not taking is not hiding

      fireEvent.click(box);
      await waitFor(() => expect(onViewWhitelistChange).toHaveBeenCalledWith('*'));
    });

    it('leaves an own view\'s checkbox meaning column exposure, not inheritance', async () => {
      const { onViewsChange, onViewWhitelistChange } = renderSection({ views: [ZONE_REVENUE] });
      fireEvent.click(screen.getByLabelText('Expose view zone_revenue'));
      await waitFor(() => expect(onViewsChange).toHaveBeenCalledWith([{ ...ZONE_REVENUE, whitelistedColumns: [] }]));
      expect(onViewWhitelistChange).not.toHaveBeenCalled();
    });
  });

  // ── The parent's half: which children receive this model ────────────────

  describe('childPaths', () => {
    const PATHS = ['/org/team_a', '/org/team_b'];

    it('an own view carries an "Apply to:" picker, defaulting to all children', () => {
      renderSection({ views: [ZONE_REVENUE], availableChildPaths: PATHS });
      const trigger = screen.getByLabelText('Child paths for data model zone_revenue');
      expect(trigger.textContent).toContain('All child paths');
    });

    it('scoping a view to one child path patches its childPaths', async () => {
      const { onViewsChange } = renderSection({ views: [ZONE_REVENUE], availableChildPaths: PATHS });
      fireEvent.click(screen.getByLabelText('Child paths for data model zone_revenue'));

      // Turning off "all children" first — same two-step as the schema tree.
      fireEvent.click(await screen.findByLabelText('All child paths for data model zone_revenue'));
      await waitFor(() => expect(onViewsChange).toHaveBeenCalledWith([{ ...ZONE_REVENUE, childPaths: [] }]));

      fireEvent.click(screen.getByLabelText('Child path /org/team_a for data model zone_revenue'));
      await waitFor(() => expect(onViewsChange).toHaveBeenLastCalledWith([{ ...ZONE_REVENUE, childPaths: ['/org/team_a'] }]));
    });

    it('shows no picker when there are no child folders, in view mode, or on inherited rows', () => {
      renderSection({ views: [ZONE_REVENUE], availableChildPaths: [] });
      expect(screen.queryByLabelText('Child paths for data model zone_revenue')).toBeNull();

      cleanup();
      renderSection({ views: [ZONE_REVENUE], availableChildPaths: PATHS, editable: false });
      expect(screen.queryByLabelText('Child paths for data model zone_revenue')).toBeNull();

      cleanup();
      renderSection({ views: [], inheritedViews: [ZONE_REVENUE], availableChildPaths: PATHS });
      expect(screen.queryByLabelText('Child paths for data model zone_revenue')).toBeNull();
    });
  });
});
