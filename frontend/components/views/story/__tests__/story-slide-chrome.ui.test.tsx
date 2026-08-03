/**
 * The slide chrome: birds-eye rail (non-present) and present-mode controls.
 * Both are thin views over lib/story-ui/use-slide-nav — tested with a stub nav.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen, fireEvent, cleanup } from '@testing-library/react';
import { renderWithProviders as render } from '@/test/helpers/render-with-providers';

import StorySlideRail from '@/components/views/story/StorySlideRail';
import StoryPresentControls from '@/components/views/story/StoryPresentControls';
import type { SlideNav } from '@/lib/story-ui/use-slide-nav';

function stubNav(count: number, activeIndex = 0): SlideNav {
  const slides = Array.from({ length: count }, (_, i) => ({
    el: document.createElement('section'),
    title: `Slide title ${i + 1}`,
  }));
  return {
    slides,
    frame: null,
    activeIndex,
    goTo: vi.fn(),
    next: vi.fn(),
    prev: vi.fn(),
  };
}

afterEach(cleanup);

describe('StorySlideRail', () => {
  it('renders one entry per slide and navigates on click', () => {
    const nav = stubNav(3, 1);
    render(<StorySlideRail nav={nav} />);
    const rail = screen.getByLabelText('Slide overview');
    expect(rail.querySelectorAll('button').length).toBe(3);
    fireEvent.click(screen.getByLabelText('Go to slide 3: Slide title 3'));
    expect(nav.goTo).toHaveBeenCalledWith(2);
  });

  it('marks the active slide entry as current', () => {
    render(<StorySlideRail nav={stubNav(3, 1)} />);
    expect(screen.getByLabelText('Go to slide 2: Slide title 2').getAttribute('aria-current')).toBe('true');
    expect(screen.getByLabelText('Go to slide 1: Slide title 1').hasAttribute('aria-current')).toBe(false);
  });

  it('renders nothing for fewer than two slides', () => {
    render(<StorySlideRail nav={stubNav(1)} />);
    expect(screen.queryByLabelText('Slide overview')).toBeNull();
  });

  it('shows content thumbnails when provided, one per slide', () => {
    const nav = stubNav(3);
    render(<StorySlideRail nav={nav} thumbnails={['data:image/jpeg;t1', 'data:image/jpeg;t2', 'data:image/jpeg;t3']} />);
    const imgs = screen.getByLabelText('Slide overview').querySelectorAll('img');
    expect(imgs.length).toBe(3);
    expect(imgs[1].getAttribute('src')).toBe('data:image/jpeg;t2');
    // Decorative — the button's aria-label already names the slide.
    expect(imgs[0].getAttribute('alt')).toBe('');
  });

  it('stays a title list when thumbnails are absent or incomplete', () => {
    const nav = stubNav(3);
    render(<StorySlideRail nav={nav} thumbnails={['data:image/jpeg;only-one']} />);
    expect(screen.getByLabelText('Slide overview').querySelectorAll('img').length).toBe(0);
  });

  it('offers title editing only when a rename handler is provided', () => {
    render(<StorySlideRail nav={stubNav(2)} />);
    expect(screen.queryByLabelText('Edit slide 1 title')).toBeNull();
  });

  it('renames through the inline input: Enter commits, Escape cancels', () => {
    const nav = stubNav(2);
    const onRenameSlide = vi.fn();
    render(<StorySlideRail nav={nav} onRenameSlide={onRenameSlide} />);
    fireEvent.click(screen.getByLabelText('Edit slide 2 title'));
    const input = screen.getByLabelText('Slide 2 title') as HTMLInputElement;
    expect(input.value).toBe('Slide title 2');
    fireEvent.change(input, { target: { value: 'Renamed' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onRenameSlide).toHaveBeenCalledWith(1, 'Renamed');
    // Escape path: reopen, type, cancel — no further calls.
    fireEvent.click(screen.getByLabelText('Edit slide 1 title'));
    const input1 = screen.getByLabelText('Slide 1 title') as HTMLInputElement;
    fireEvent.change(input1, { target: { value: 'Nope' } });
    fireEvent.keyDown(input1, { key: 'Escape' });
    expect(onRenameSlide).toHaveBeenCalledTimes(1);
    expect(screen.queryByLabelText('Slide 1 title')).toBeNull();
  });
});

describe('StoryPresentControls', () => {
  it('shows position and navigates with the buttons', () => {
    const nav = stubNav(5, 2);
    render(<StoryPresentControls nav={nav} />);
    expect(screen.getByLabelText('Slide position').textContent).toBe('3 / 5');
    fireEvent.click(screen.getByLabelText('Next slide'));
    expect(nav.next).toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText('Previous slide'));
    expect(nav.prev).toHaveBeenCalled();
  });

  it('drives navigation from the keyboard', () => {
    const nav = stubNav(5, 2);
    render(<StoryPresentControls nav={nav} />);
    fireEvent.keyDown(document, { key: 'ArrowRight' });
    fireEvent.keyDown(document, { key: 'PageDown' });
    fireEvent.keyDown(document, { key: ' ' });
    expect(nav.next).toHaveBeenCalledTimes(3);
    fireEvent.keyDown(document, { key: 'ArrowLeft' });
    expect(nav.prev).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(document, { key: 'Home' });
    expect(nav.goTo).toHaveBeenCalledWith(0);
    fireEvent.keyDown(document, { key: 'End' });
    expect(nav.goTo).toHaveBeenCalledWith(4);
  });

  it('leaves keys alone when typing in an editable target', () => {
    const nav = stubNav(3, 0);
    render(
      <div>
        <input aria-label="Some input" />
        <StoryPresentControls nav={nav} />
      </div>,
    );
    fireEvent.keyDown(screen.getByLabelText('Some input'), { key: 'ArrowRight' });
    expect(nav.next).not.toHaveBeenCalled();
  });

  it('renders nothing without slides', () => {
    render(<StoryPresentControls nav={stubNav(0, -1)} />);
    expect(screen.queryByLabelText('Slide position')).toBeNull();
  });

  it('is ONLY the paging pill — the slide list while presenting is the shared rail, not an overlay', () => {
    render(<StoryPresentControls nav={stubNav(4, 1)} />);
    expect(screen.queryByLabelText('Slide contents')).toBeNull();
    expect(screen.queryByLabelText('Slide overview')).toBeNull();
  });
});
