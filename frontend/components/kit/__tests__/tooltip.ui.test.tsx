import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from '@/components/kit/tooltip';

// App tooltips portal by default so clipped/transformed workspaces cannot offset
// them. Story roots opt out once because foreignObject requires inline content.
function renderTooltip(portalled?: boolean, providerPortalled?: boolean) {
  return render(
    // A clipping ancestor, mirroring the question header panel.
    <div aria-label="host" style={{ overflow: 'hidden' }}>
      <TooltipProvider portalled={providerPortalled}>
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
  it('escapes clipping ancestors by default in the app', () => {
    renderTooltip();
    const host = screen.getByLabelText('host');
    const tip = screen.getByLabelText('tip');
    expect(host.contains(tip)).toBe(false);
    expect(tip.closest('[data-mx-theme-host]')).not.toBeNull();
  });

  it('renders inline when a story provider opts out', () => {
    renderTooltip(undefined, false);
    const host = screen.getByLabelText('host');
    const tip = screen.getByLabelText('tip');
    expect(host.contains(tip)).toBe(true);
    expect(tip.closest('[data-mx-theme-host]')).toBeNull();
  });

  it('allows an exceptional content instance to override its provider', () => {
    renderTooltip(true, false);
    const host = screen.getByLabelText('host');
    const tip = screen.getByLabelText('tip');
    expect(host.contains(tip)).toBe(false);
  });
});
