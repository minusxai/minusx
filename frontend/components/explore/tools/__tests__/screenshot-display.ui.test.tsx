/**
 * ScreenshotDisplay — renders the Screenshot tool's captured image (from its image_url content
 * block) inline under the response (compact) and in the carousel (DetailCard). Located by
 * aria-label only (project rule).
 */
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import type { DisplayProps } from '@/lib/types';
import ScreenshotDisplay, { ScreenshotDetailCard } from '../ScreenshotDisplay';

const toolMsg = (content: unknown, details?: unknown) =>
  ({ role: 'tool', tool_call_id: 'c1', function: { name: 'Screenshot' }, content, ...(details ? { details } : {}) }) as never;
const compactProps = (content: unknown, details?: unknown) =>
  ({ toolCallTuple: [{ id: 'c1', type: 'function', function: { name: 'Screenshot', arguments: '{}' } }, toolMsg(content, details)] }) as unknown as DisplayProps;

const withImage = (url: string) => [
  { type: 'text', text: 'Screenshot of file 5 (rendered view).' },
  { type: 'image_url', image_url: { url } },
];

describe('ScreenshotDisplay (compact)', () => {
  it('renders the captured image from the image_url content block', () => {
    renderWithProviders(<ScreenshotDisplay {...compactProps(withImage('https://cdn.example/shot.jpg'))} />);
    const img = screen.getByLabelText('Captured screenshot') as HTMLImageElement;
    expect(img.src).toContain('https://cdn.example/shot.jpg');
  });

  it('renders nothing while the capture is still executing', () => {
    const { container } = renderWithProviders(<ScreenshotDisplay {...compactProps('(executing...)')} />);
    expect(container.querySelector('img')).toBeNull();
  });

  it('shows a failure row when there is no image', () => {
    renderWithProviders(<ScreenshotDisplay {...compactProps([{ type: 'text', text: 'Could not capture' }])} />);
    expect(screen.queryByLabelText('Captured screenshot')).toBeNull();
  });

  it('reads the url from details after the turn (content no longer has the image_url block)', () => {
    // After the turn the content can be reloaded without the live image_url block; the UI-only
    // `details.screenshotUrl` survives → the image must NOT vanish ("Screenshot failed").
    renderWithProviders(<ScreenshotDisplay {...compactProps([{ type: 'text', text: 'Screenshot of file 5' }], { success: true, screenshotUrl: 'https://cdn.example/persisted.jpg' })} />);
    expect((screen.getByLabelText('Captured screenshot') as HTMLImageElement).src).toContain('persisted.jpg');
  });

  it('reads the url from STRINGIFIED content (persisted JSON form)', () => {
    const stringified = JSON.stringify(withImage('https://cdn.example/stringified.jpg'));
    renderWithProviders(<ScreenshotDisplay {...compactProps(stringified)} />);
    expect((screen.getByLabelText('Captured screenshot') as HTMLImageElement).src).toContain('stringified.jpg');
  });
});

describe('ScreenshotDetailCard (carousel)', () => {
  it('renders the full captured image', () => {
    renderWithProviders(<ScreenshotDetailCard msg={toolMsg(withImage('https://cdn.example/full.jpg'))} filesDict={{}} />);
    expect((screen.getByLabelText('Captured screenshot') as HTMLImageElement).src).toContain('https://cdn.example/full.jpg');
  });
});
