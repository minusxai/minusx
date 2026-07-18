import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import { ChakraProvider } from '@chakra-ui/react';
import { system } from '@/lib/ui/theme';
import ImageAnnotatorDialog from '@/components/screenshot/ImageAnnotatorDialog';
import { AGENT_IMAGE_MAX_PX } from '@/lib/screenshot/constants';

// jsdom lacks Image/canvas — minimal stubs so the real dialog can load an image, draw, and export.
// The "image" is 1400×900 (a crisp display-res crop) so we can assert the export downscales it.
beforeAll(() => {
  URL.createObjectURL = vi.fn(() => 'blob:mock');
  URL.revokeObjectURL = vi.fn();
  vi.stubGlobal('Image', class {
    onload: null | (() => void) = null;
    onerror: null | (() => void) = null;
    crossOrigin = '';
    naturalWidth = 1400;
    naturalHeight = 900;
    set src(_v: string) { queueMicrotask(() => this.onload?.()); }
  });
  const ctxStub = {
    drawImage: vi.fn(), getImageData: vi.fn(() => ({})), putImageData: vi.fn(),
    beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(),
    strokeStyle: '', lineWidth: 0, lineCap: '', lineJoin: '',
  };
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ctxStub) as never;
  HTMLCanvasElement.prototype.toBlob = function (cb: BlobCallback) { cb(new Blob(['annotated'], { type: 'image/jpeg' })); };
});

const renderDialog = (props: Partial<React.ComponentProps<typeof ImageAnnotatorDialog>> = {}) =>
  render(
    <ChakraProvider value={system}>
      <ImageAnnotatorDialog
        isOpen
        onClose={props.onClose ?? (() => {})}
        imageSrc="data:image/png;base64,iVBORw0KGgo="
        onConfirm={props.onConfirm ?? (() => {})}
        {...props}
      />
    </ChakraProvider>,
  );

describe('ImageAnnotatorDialog', () => {
  it('renders annotator controls and closes on cancel', async () => {
    const onClose = vi.fn();
    const { findByLabelText } = renderDialog({ onClose });
    expect(await findByLabelText('undo-brush')).toBeTruthy();
    expect(await findByLabelText('annotator-confirm')).toBeTruthy();
    fireEvent.click(await findByLabelText('annotator-cancel'));
    expect(onClose).toHaveBeenCalled();
  });

  it('does not render when closed', () => {
    const { queryByLabelText } = render(
      <ChakraProvider value={system}>
        <ImageAnnotatorDialog isOpen={false} onClose={() => {}} imageSrc={null} onConfirm={() => {}} />
      </ChakraProvider>,
    );
    expect(queryByLabelText('annotator-confirm')).toBeNull();
  });

  it('offers a red/black/white brush palette with red selected by default', async () => {
    const { findByLabelText } = renderDialog();
    const red = await findByLabelText('brush-color-red');
    const black = await findByLabelText('brush-color-black');
    const white = await findByLabelText('brush-color-white');
    expect(red.getAttribute('aria-pressed')).toBe('true');
    expect(black.getAttribute('aria-pressed')).toBe('false');
    expect(white.getAttribute('aria-pressed')).toBe('false');
    // selecting another color moves the selection
    fireEvent.click(black);
    expect(red.getAttribute('aria-pressed')).toBe('false');
    expect(black.getAttribute('aria-pressed')).toBe('true');
  });

  it('has a note input and passes the typed note (with the exported blob) to onConfirm', async () => {
    const onConfirm = vi.fn();
    const { findByLabelText } = renderDialog({ onConfirm });
    const note = await findByLabelText('annotator-note');
    fireEvent.change(note, { target: { value: 'why is Feb so high?' } });
    const confirm = await findByLabelText('annotator-confirm');
    await waitFor(() => expect(confirm).not.toBeDisabled());
    fireEvent.click(confirm);
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith(expect.any(Blob), 'why is Feb so high?'));
  });

  it('sends an empty note when the user did not type one', async () => {
    const onConfirm = vi.fn();
    const { findByLabelText } = renderDialog({ onConfirm });
    const confirm = await findByLabelText('annotator-confirm');
    await waitFor(() => expect(confirm).not.toBeDisabled());
    fireEvent.click(confirm);
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith(expect.any(Blob), ''));
  });

  it('downscales the export to the agent cap so a crisp display crop stays a small payload', async () => {
    // The display canvas is the image's natural size (1400×900). The export must cap the longest
    // side to AGENT_IMAGE_MAX_PX (512) via a temp canvas — proving display/send res are decoupled.
    const created: HTMLCanvasElement[] = [];
    const realCreate = document.createElement.bind(document);
    const spy = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const node = realCreate(tag);
      if (tag === 'canvas') created.push(node as HTMLCanvasElement);
      return node;
    });
    try {
      const onConfirm = vi.fn();
      const { findByLabelText } = renderDialog({ onConfirm });
      const confirm = await findByLabelText('annotator-confirm');
      await waitFor(() => expect(confirm).not.toBeDisabled());
      fireEvent.click(confirm);
      await waitFor(() => expect(onConfirm).toHaveBeenCalled());
      // A temp canvas sized to the 512-cap (512×329, aspect-preserved) is used for the export.
      expect(created.some(c => c.width === AGENT_IMAGE_MAX_PX && c.height === 329)).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });
});
