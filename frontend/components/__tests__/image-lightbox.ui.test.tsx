/**
 * ImageLightbox — global in-page image preview driven by Redux `lightboxImageUrl`. Opens full-size,
 * closes on the ✕, a backdrop click, or Esc (but NOT when clicking the image itself). Located by
 * aria-label only.
 */
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import { makeStore } from '@/store/store';
import { openImageLightbox } from '@/store/uiSlice';
import ImageLightbox from '@/components/ui/ImageLightbox';

function openWith(url: string) {
  const store = makeStore();
  store.dispatch(openImageLightbox(url));
  renderWithProviders(<ImageLightbox />, { store });
  return store;
}

describe('ImageLightbox', () => {
  it('renders nothing when no image is open', () => {
    renderWithProviders(<ImageLightbox />);
    expect(screen.queryByLabelText('Image preview')).toBeNull();
  });

  it('shows the image full-size when a url is set', () => {
    openWith('https://cdn.example/shot.jpg');
    expect((screen.getByLabelText('Full size image') as HTMLImageElement).src).toContain('shot.jpg');
  });

  it('closes via the ✕ button', () => {
    const store = openWith('https://cdn.example/a.jpg');
    fireEvent.click(screen.getByLabelText('Close image preview'));
    expect(store.getState().ui.lightboxImageUrl).toBeNull();
  });

  it('closes on a backdrop click, but NOT on an image click', () => {
    const store = openWith('https://cdn.example/b.jpg');
    fireEvent.click(screen.getByLabelText('Full size image'));
    expect(store.getState().ui.lightboxImageUrl).not.toBeNull();
    fireEvent.click(screen.getByLabelText('Image preview'));
    expect(store.getState().ui.lightboxImageUrl).toBeNull();
  });

  it('closes on Escape', () => {
    const store = openWith('https://cdn.example/c.jpg');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(store.getState().ui.lightboxImageUrl).toBeNull();
  });
});
