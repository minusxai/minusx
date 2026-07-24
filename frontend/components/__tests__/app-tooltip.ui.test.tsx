import { fireEvent, render, screen } from '@testing-library/react';
import { Tooltip } from '@/components/kit/tooltip';

describe('app Tooltip', () => {
  it('uses the shared tooltip content primitive', async () => {
    render(
      <Tooltip content="Shared tooltip">
        <button aria-label="app trigger">Trigger</button>
      </Tooltip>,
    );

    fireEvent.focus(screen.getByLabelText('app trigger'));
    const tip = await screen.findByRole('tooltip');
    expect(tip).toHaveAttribute('data-slot', 'tooltip-content');
    expect(tip).toHaveClass('w-max', 'max-w-[min(28rem,calc(100vw-1rem))]', 'bg-foreground', 'text-background');
    expect(tip.closest('[data-mx-theme-host]')).not.toBeNull();
  });
});
