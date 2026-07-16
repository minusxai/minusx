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
import { IconButton, MenuRoot, MenuTrigger, MenuContent, MenuItem, MenuPositioner, Portal, Text } from '@chakra-ui/react';
import { LuDownload, LuImage, LuSheet } from 'react-icons/lu';
import { renderEnvelopeImageDataUrl } from '@/lib/chart/VizImageRenderer.client';
import { queryResultToCsv, downloadCsvString } from '@/components/plotx/build-chart-download';
import { getTimestamp } from '@/lib/chart/chart-utils';
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
    <MenuRoot positioning={{ placement: 'bottom-end' }}>
      <MenuTrigger asChild>
        <IconButton aria-label="Download chart" size="xs" variant="ghost" color="fg.subtle" _hover={{ color: 'fg.default', bg: 'bg.muted' }}>
          <LuDownload size={14} />
        </IconButton>
      </MenuTrigger>
      <Portal>
        <MenuPositioner>
          <MenuContent minW="180px" bg="bg.surface" borderColor="border.default" shadow="lg" p={1}>
            <MenuItem value="image" aria-label="Download chart as image" onClick={() => void downloadImage()} px={3} py={1.5} borderRadius="sm" _hover={{ bg: 'bg.muted' }} cursor="pointer">
              <LuImage size={14} />
              <Text fontSize="xs">Image (.jpg)</Text>
            </MenuItem>
            <MenuItem value="csv" aria-label="Download chart data as CSV" onClick={downloadCsv} px={3} py={1.5} borderRadius="sm" _hover={{ bg: 'bg.muted' }} cursor="pointer">
              <LuSheet size={14} />
              <Text fontSize="xs">Data (.csv)</Text>
            </MenuItem>
          </MenuContent>
        </MenuPositioner>
      </Portal>
    </MenuRoot>
  );
}
