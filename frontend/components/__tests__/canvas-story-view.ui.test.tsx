import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { ChakraProvider } from '@chakra-ui/react';
import { system } from '@/lib/ui/theme';
import CanvasStoryView from '@/components/views/story/CanvasStoryView';

/**
 * jsdom has no wasm/canvas, so the raster pipeline always fails here — which is
 * exactly the contract under test: canvas rendering failure must flip to the DOM
 * fallback rather than leaving a blank story.
 */
describe('CanvasStoryView', () => {
  it('renders the canvas surface first, then the DOM fallback when the raster pipeline fails', async () => {
    const { getByLabelText, findByLabelText } = render(
      <ChakraProvider value={system}>
        <CanvasStoryView
          html={'<div class="story"><p>Hello</p></div>'}
          width={800}
          readOnly
          fallback={<div aria-label="dom-story-fallback">fallback</div>}
        />
      </ChakraProvider>,
    );
    // surface mounts synchronously
    expect(getByLabelText('canvas-story')).toBeTruthy();
    // pipeline failure (no wasm in jsdom) swaps in the fallback
    expect(await findByLabelText('dom-story-fallback')).toBeTruthy();
  });
});
