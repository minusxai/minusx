'use client';

/**
 * Download menu for a V2 (Vega/Vega-Lite envelope) chart — the parity of the V1 chart
 * download (image + CSV), as a React overlay rather than baked-in ECharts graphics.
 *
 * - Image (.jpg): the envelope rendered off-screen through Vega's canvas (real tiles),
 *   via the shared client image renderer + JPEG encoder.
 * - Data (.csv): the raw query result (every column, every row).
 */
import { useCallback } from 'react';
import { LuDownload, LuImage, LuSheet } from 'react-icons/lu';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/kit/dropdown-menu';
import { renderEnvelopeImageDataUrl } from '@/lib/chart/VizImageRenderer.client';
import { queryResultToCsv, downloadCsvString } from '@/components/plotx/build-chart-download';
import { getTimestamp } from '@/lib/chart/chart-format';
import type { VizEnvelope } from '@/lib/validation/atlas-schemas';

interface ChartDownloadMenuProps {
  envelope: VizEnvelope;
  rows: Record<string, unknown>[];
  columns: string[];
  colorMode: 'light' | 'dark';
  /** Public-relative logo url for the image watermark footer. */
  logoSrc?: string;
  /** Base file name (default "chart"). */
  filename?: string;
}

export function ChartDownloadMenu({ envelope, rows, columns, colorMode, logoSrc, filename = 'chart' }: ChartDownloadMenuProps) {
  const downloadImage = useCallback(async () => {
    const dataUrl = await renderEnvelopeImageDataUrl(envelope, rows, {
      width: 1200, colorMode, addWatermark: true, padding: true, logoSrc,
    });
    if (!dataUrl) return;
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = `${filename}-${getTimestamp()}.jpg`;
    link.click();
  }, [envelope, rows, colorMode, logoSrc, filename]);

  const downloadCsv = useCallback(() => {
    downloadCsvString(queryResultToCsv(columns, rows), `${filename}-${getTimestamp()}.csv`);
  }, [columns, rows, filename]);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Download chart"
        className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground"
      >
        <LuDownload size={14} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[180px]">
        <DropdownMenuItem aria-label="Download chart as image" className="cursor-pointer px-3 py-1.5" onClick={() => void downloadImage()}>
          <LuImage size={14} />
          <span className="text-xs">Image (.jpg)</span>
        </DropdownMenuItem>
        <DropdownMenuItem aria-label="Download chart data as CSV" className="cursor-pointer px-3 py-1.5" onClick={downloadCsv}>
          <LuSheet size={14} />
          <span className="text-xs">Data (.csv)</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
