/**
 * DatePicker inside the dashboard iframe surface (Renderer_v2 Phase 8): the calendar (and its
 * backdrop) must portal to the ANCHOR's document body — `document.body` is the TOP document,
 * where an iframe-relative anchor rect is meaningless (the calendar landed offset by the
 * iframe's page position). Fixed-position elements are ALSO broken inside <svg><foreignObject>,
 * so the backdrop must escape the surface too, into the same body.
 */
import { describe, it, expect } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { within } from '@testing-library/dom';
import { fireEvent } from '@testing-library/react';
import DatePicker from '../DatePicker';

function makeIframeHost(): { host: HTMLElement; idoc: Document } {
  const iframe = document.createElement('iframe');
  document.body.appendChild(iframe);
  const idoc = iframe.contentDocument!;
  idoc.open();
  idoc.write('<!DOCTYPE html><html><head></head><body></body></html>');
  idoc.close();
  const host = idoc.createElement('div');
  idoc.body.appendChild(host);
  return { host, idoc };
}

describe('DatePicker portal targeting (iframe surface)', () => {
  it('portals the open calendar + backdrop into the ANCHOR document body, not the top document', async () => {
    const { host, idoc } = makeIframeHost();
    render(
      <DatePicker value="2026-01-15" onChange={() => {}} ariaLabel="Date value" />,
      { container: host },
    );
    fireEvent.click(within(idoc.body).getByLabelText('Open calendar'));
    await waitFor(() => {
      // The calendar grid lives in the IFRAME body...
      expect(idoc.body.querySelector('.rdp-root, .rdp')).not.toBeNull();
    });
    // ...and nothing leaked into the top document.
    expect(document.querySelector('.rdp-root, .rdp')).toBeNull();
  });

  it('keeps portaling to the top document body when rendered in the main document', async () => {
    const { getByLabelText } = render(
      <DatePicker value="2026-01-15" onChange={() => {}} ariaLabel="Date value" />,
    );
    fireEvent.click(getByLabelText('Open calendar'));
    await waitFor(() => {
      expect(document.body.querySelector('.rdp-root, .rdp')).not.toBeNull();
    });
  });
});
