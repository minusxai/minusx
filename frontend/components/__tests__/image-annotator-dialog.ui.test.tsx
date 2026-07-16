import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { ChakraProvider } from '@chakra-ui/react';
import { system } from '@/lib/ui/theme';
import ImageAnnotatorDialog from '@/components/screenshot/ImageAnnotatorDialog';

describe('ImageAnnotatorDialog', () => {
  it('renders annotator controls and closes on cancel', async () => {
    const onClose = vi.fn();
    const { findByLabelText } = render(
      <ChakraProvider value={system}>
        <ImageAnnotatorDialog
          isOpen
          onClose={onClose}
          imageSrc="data:image/png;base64,iVBORw0KGgo="
          onConfirm={() => {}}
        />
      </ChakraProvider>,
    );
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
});
