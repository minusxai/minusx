/**
 * useScreenshot hook — thin React wrapper over the plain capture core
 * (lib/screenshot/capture.ts). It only reads `colorMode` from Redux and forwards it;
 * all real capture logic lives in capture.ts so tool handlers / region-select can
 * reuse it without a hook.
 */
import { useCallback } from 'react';
import { useAppSelector } from '@/store/hooks';
import { ScreenshotOptions, ScreenshotResult } from '../screenshot/types';
import {
  captureElementBlob,
  captureElementFullHeightBlob,
  captureFileViewBlob,
  type CaptureOptions,
} from '../screenshot/capture';

export function useScreenshot(options?: ScreenshotOptions) {
  const colorMode = useAppSelector(state => state.ui.colorMode);

  const captureElement = useCallback(
    (element: HTMLElement): Promise<Blob> =>
      captureElementBlob(element, { ...options, colorMode } as CaptureOptions),
    [colorMode, options],
  );

  const captureElementFullHeight = useCallback(
    (element: HTMLElement): Promise<Blob> =>
      captureElementFullHeightBlob(element, { ...options, colorMode } as CaptureOptions),
    [colorMode, options],
  );

  const captureFileView = useCallback(
    (fileId: number, o?: { fullHeight?: boolean }): Promise<Blob> =>
      captureFileViewBlob(fileId, { ...options, colorMode, fullHeight: o?.fullHeight } as CaptureOptions & { fullHeight?: boolean }),
    [colorMode, options],
  );

  const blobToDataURL = useCallback((blob: Blob): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    }), []);

  const captureElementWithMetadata = useCallback(async (element: HTMLElement): Promise<ScreenshotResult> => {
    const blob = await captureElementBlob(element, { ...options, colorMode } as CaptureOptions);
    const dataURL = await blobToDataURL(blob);
    return { blob, dataURL, timestamp: new Date().toISOString() };
  }, [colorMode, options, blobToDataURL]);

  const download = useCallback((blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  return { captureElement, captureElementFullHeight, captureFileView, captureElementWithMetadata, download, blobToDataURL };
}
