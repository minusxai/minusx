/**
 * DrillDownCard inside the dashboard iframe surface (Renderer_v2 Phase 8): the floating card is
 * positioned from CLICK coordinates, which are relative to the document the click happened in —
 * so the card must portal into THAT document's body (`drillDown.doc`), not the top
 * `document.body` (where iframe-relative coordinates land the card offset by the iframe's page
 * position). Outside-click dismissal must also hear clicks in that document.
 */
import { describe, it, expect, vi } from 'vitest';
import { waitFor, fireEvent } from '@testing-library/react';
import { DrillDownCard, type DrillDownState } from '../DrillDownCard';
import { renderWithProviders } from '@/test/helpers/render-with-providers';

function makeIframeDoc(): Document {
  const iframe = document.createElement('iframe');
  document.body.appendChild(iframe);
  const idoc = iframe.contentDocument!;
  idoc.open();
  idoc.write('<!DOCTYPE html><html><head></head><body></body></html>');
  idoc.close();
  return idoc;
}

const drill = (doc?: Document): DrillDownState => ({
  filters: { region: 'EMEA' },
  filterTypes: {},
  yColumn: 'region',
  position: { x: 20, y: 20 },
  ...(doc ? { doc } : {}),
});

describe('DrillDownCard portal targeting (iframe surface)', () => {
  it('portals into drillDown.doc body and dismisses on outside clicks in that document', async () => {
    const idoc = makeIframeDoc();
    const onClose = vi.fn();
    renderWithProviders(
      <DrillDownCard drillDown={drill(idoc)} onClose={onClose} sql="select 1" databaseName="db" />,
    );
    await waitFor(() => {
      expect(idoc.body.querySelector('[data-mx-theme-host]')).not.toBeNull();
    });
    // Nothing leaked into the top document body.
    expect(document.body.querySelector('[data-mx-theme-host]')).toBeNull();
    // Outside click INSIDE the iframe document dismisses.
    fireEvent.mouseDown(idoc.body);
    expect(onClose).toHaveBeenCalled();
  });

  it('defaults to the top document body when no doc is given (main-document questions)', async () => {
    renderWithProviders(
      <DrillDownCard drillDown={drill()} onClose={() => {}} sql="select 1" databaseName="db" />,
    );
    await waitFor(() => {
      expect(document.body.querySelector('[data-mx-theme-host]')).not.toBeNull();
    });
  });
});
