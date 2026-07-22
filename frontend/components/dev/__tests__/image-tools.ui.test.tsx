/**
 * Image Tools panel — "Get image" fetches the current file-view capture and DISPLAYS it inline.
 * It must never trigger a browser download: the panel is for inspecting what a capture looks
 * like, and the artifact is the preview, not a file in ~/Downloads.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/helpers/render-with-providers';

const download = vi.fn();
const captureFileView = vi.fn(async () => new Blob(['jpg-bytes'], { type: 'image/jpeg' }));
const blobToDataURL = vi.fn(async () => 'data:image/jpeg;base64,ZmFrZQ==');
vi.mock('@/lib/hooks/useScreenshot', () => ({
  useScreenshot: () => ({ captureFileView, blobToDataURL, download }),
}));
vi.mock('@/lib/object-store/client', () => ({ uploadFile: vi.fn() }));
vi.mock('@/lib/chart/ChartImageRenderer.client', () => ({ clientChartImageRenderer: { renderCharts: vi.fn(async () => []) } }));
vi.mock('@/lib/chart/chart-attachments', () => ({ extractChartEntries: () => [] }));
vi.mock('@/lib/tools/tool-handlers', () => ({ getRegisteredToolNames: () => [], executeToolCall: vi.fn() }));

import { ImageToolsPanel } from '../DevToolsPanel';

beforeEach(() => { vi.clearAllMocks(); });

describe('ImageToolsPanel — Get image', () => {
  it('shows a "Get image" button (not "Download image")', () => {
    const { getByLabelText, queryByLabelText } = renderWithProviders(
      <ImageToolsPanel fileId={7} appState={null} />,
    );
    expect(getByLabelText('Get image')).toBeTruthy();
    expect(queryByLabelText('Download image')).toBeNull();
  });

  it('clicking it displays the captured image inline and does NOT download it', async () => {
    const { getByLabelText, findByLabelText } = renderWithProviders(
      <ImageToolsPanel fileId={7} appState={null} />,
    );
    fireEvent.click(getByLabelText('Get image'));
    const img = await findByLabelText('Screenshot') as HTMLImageElement;
    expect(img.src).toBe('data:image/jpeg;base64,ZmFrZQ==');
    await waitFor(() => expect(captureFileView).toHaveBeenCalled());
    expect(download).not.toHaveBeenCalled();
  });
});
