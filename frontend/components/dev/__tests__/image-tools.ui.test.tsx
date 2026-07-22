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
const screenshotOptionsSeen: Array<Record<string, unknown> | undefined> = [];
vi.mock('@/lib/hooks/useScreenshot', () => ({
  useScreenshot: (opts?: Record<string, unknown>) => {
    screenshotOptionsSeen.push(opts);
    return { captureFileView, blobToDataURL, download };
  },
}));
vi.mock('@/lib/object-store/client', () => ({ uploadFile: vi.fn() }));
vi.mock('@/lib/chart/ChartImageRenderer.client', () => ({ clientChartImageRenderer: { renderCharts: vi.fn(async () => []) } }));
vi.mock('@/lib/chart/chart-attachments', () => ({ extractChartEntries: () => [] }));
vi.mock('@/lib/tools/tool-handlers', () => ({ getRegisteredToolNames: () => [], executeToolCall: vi.fn() }));

import { ImageToolsPanel } from '../DevToolsPanel';

beforeEach(() => { vi.clearAllMocks(); screenshotOptionsSeen.length = 0; });

describe('ImageToolsPanel — Get image', () => {
  it('shows a "Get image" button (not "Download image")', () => {
    const { getByLabelText, queryByLabelText } = renderWithProviders(
      <ImageToolsPanel fileId={7} appState={null} />,
    );
    expect(getByLabelText('Get image')).toBeTruthy();
    expect(queryByLabelText('Download image')).toBeNull();
  });

  // The old "Agent image" button previewed the DELETED per-chart pipeline
  // (buildChartAttachments). The agent's real image is the file-view capture — which
  // "Get image" + the Markers/512px checkboxes preview exactly — so the button is gone
  // (Renderer_v2 Phase 2).
  it('has no "Agent image" button (per-chart preview pipeline is deleted)', () => {
    const { queryByLabelText } = renderWithProviders(<ImageToolsPanel fileId={7} appState={null} />);
    expect(queryByLabelText('Agent image')).toBeNull();
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

  // "Preview the exact image the agent receives": the agent's app-state screenshot is the same
  // captureFileViewBlob call with maxWidth 512 + markers (the numbered gutter drawn into the
  // bitmap). Markers + 512px checked together must therefore reproduce it option-for-option.
  it('passes markers (and composes with the 512px cap) so the agent view can be previewed', async () => {
    const { getByLabelText } = renderWithProviders(<ImageToolsPanel fileId={7} appState={null} />);
    fireEvent.click(getByLabelText('Draw agent position markers'));
    fireEvent.click(getByLabelText('Limit width to 512px'));
    await waitFor(() => {
      const last = screenshotOptionsSeen[screenshotOptionsSeen.length - 1];
      expect(last).toEqual({ maxWidth: 512, markers: true });
    });
    fireEvent.click(getByLabelText('Draw agent position markers')); // toggle off again
    await waitFor(() => {
      const last = screenshotOptionsSeen[screenshotOptionsSeen.length - 1];
      expect(last).toEqual({ maxWidth: 512 });
    });
  });
});
