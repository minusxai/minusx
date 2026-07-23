import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from '@/components/kit/tooltip';

// The kit tooltip intentionally renders content INLINE by default (no Portal) so
// stories rendered inside <svg><foreignObject> keep working. Main-app callers
// that sit inside an `overflow-hidden` panel need the opt-in `portalled` prop so
// the content escapes the clipping ancestor (the LOCAL-badge tooltip bug).
function renderTooltip(portalled?: boolean) {
  return render(
    // A clipping ancestor, mirroring the question header panel.
    <div aria-label="host" style={{ overflow: 'hidden' }}>
      <TooltipProvider>
        <Tooltip open>
          <TooltipTrigger asChild>
            <button aria-label="trigger">badge</button>
          </TooltipTrigger>
          <TooltipContent portalled={portalled}>
            <span aria-label="tip">Local data — typed or pasted and saved in this question.</span>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>,
  );
}

describe('kit Tooltip', () => {
  it('renders content inline (inside the clipping ancestor) by default — story-safe', () => {
    renderTooltip();
    const host = screen.getByLabelText('host');
    const tip = screen.getByLabelText('tip');
    expect(host.contains(tip)).toBe(true);
  });

  it('escapes the clipping ancestor when portalled', () => {
    renderTooltip(true);
    const host = screen.getByLabelText('host');
    const tip = screen.getByLabelText('tip');
    expect(host.contains(tip)).toBe(false);
  });
});
