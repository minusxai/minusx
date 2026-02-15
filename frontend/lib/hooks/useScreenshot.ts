/**
 * useScreenshot hook - Client-side screenshot capture
 *
 * Uses html-to-image for fast, high-quality screenshots with native canvas support.
 * Works with ECharts (canvas-based) out of the box.
 */
import { useCallback } from 'react';
import { toBlob, toPng } from 'html-to-image';
import { useAppSelector } from '@/store/hooks';
import { ScreenshotOptions, ScreenshotResult } from '../screenshot/types';

export function useScreenshot(options?: ScreenshotOptions) {
  const colorMode = useAppSelector(state => state.ui.colorMode);

  /**
   * Generic element capture using html-to-image
   * Returns a Blob that can be downloaded or sent to API
   */
  const captureElement = useCallback(async (element: HTMLElement): Promise<Blob> => {
    const defaultBgColor = colorMode === 'dark' ? '#0D1117' : '#FAFBFC';

    const blob = await toBlob(element, {
      pixelRatio: options?.pixelRatio ?? 0.75,
      backgroundColor: options?.backgroundColor ?? defaultBgColor,
      filter: options?.filter,
      quality: options?.quality ?? 1.0,
      cacheBust: true, // Prevent caching issues
    });

    if (!blob) throw new Error('Screenshot capture failed');
    return blob;
  }, [colorMode, options]);

  /**
   * Capture element with full height (including scrolled content)
   * Temporarily expands all scrollable containers to their full height
   */
  const captureElementFullHeight = useCallback(async (element: HTMLElement): Promise<Blob> => {
    // Find all scrollable containers within the element
    const scrollableElements = Array.from(element.querySelectorAll('*')).filter(el => {
      const computedStyle = window.getComputedStyle(el);
      const hasScroll = computedStyle.overflow === 'auto' ||
                       computedStyle.overflow === 'scroll' ||
                       computedStyle.overflowY === 'auto' ||
                       computedStyle.overflowY === 'scroll';
      return hasScroll && (el as HTMLElement).scrollHeight > (el as HTMLElement).clientHeight;
    }) as HTMLElement[];

    // Store original styles
    const originalStyles = scrollableElements.map(el => ({
      element: el,
      height: el.style.height,
      maxHeight: el.style.maxHeight,
      overflow: el.style.overflow,
      overflowY: el.style.overflowY,
    }));

    try {
      // Expand all scrollable containers to full height
      scrollableElements.forEach(el => {
        el.style.height = `${el.scrollHeight}px`;
        el.style.maxHeight = 'none';
        el.style.overflow = 'visible';
        el.style.overflowY = 'visible';
      });

      // Also handle the root element if it's scrollable
      const rootOriginalStyle = {
        height: element.style.height,
        maxHeight: element.style.maxHeight,
        overflow: element.style.overflow,
        overflowY: element.style.overflowY,
      };

      if (element.scrollHeight > element.clientHeight) {
        element.style.height = `${element.scrollHeight}px`;
        element.style.maxHeight = 'none';
        element.style.overflow = 'visible';
        element.style.overflowY = 'visible';
      }

      // Small delay to let layout settle
      await new Promise(resolve => setTimeout(resolve, 100));

      // Capture the expanded element
      const blob = await captureElement(element);

      // Restore original styles
      originalStyles.forEach(({ element, height, maxHeight, overflow, overflowY }) => {
        element.style.height = height;
        element.style.maxHeight = maxHeight;
        element.style.overflow = overflow;
        element.style.overflowY = overflowY;
      });

      element.style.height = rootOriginalStyle.height;
      element.style.maxHeight = rootOriginalStyle.maxHeight;
      element.style.overflow = rootOriginalStyle.overflow;
      element.style.overflowY = rootOriginalStyle.overflowY;

      return blob;
    } catch (error) {
      // Ensure we restore styles even if capture fails
      originalStyles.forEach(({ element, height, maxHeight, overflow, overflowY }) => {
        element.style.height = height;
        element.style.maxHeight = maxHeight;
        element.style.overflow = overflow;
        element.style.overflowY = overflowY;
      });

      throw error;
    }
  }, [captureElement]);

  /**
   * FileView-specific capture (finds element by data-file-id)
   * This is the primary method for capturing question/dashboard views
   *
   * @param fileId - File ID to capture
   * @param options - Capture options
   * @param options.fullHeight - If true, expands scrollable containers to capture full height
   */
  const captureFileView = useCallback(async (
    fileId: number,
    options?: { fullHeight?: boolean }
  ): Promise<Blob> => {
    const element = document.querySelector(`[data-file-id="${fileId}"]`);
    if (!element) throw new Error(`FileView with id ${fileId} not found`);

    if (options?.fullHeight) {
      return captureElementFullHeight(element as HTMLElement);
    }

    return captureElement(element as HTMLElement);
  }, [captureElement]);

  /**
   * Capture with result metadata (includes dataURL and timestamp)
   * Useful for debugging or when you need the base64 string
   */
  const captureElementWithMetadata = useCallback(async (element: HTMLElement): Promise<ScreenshotResult> => {
    const blob = await captureElement(element);
    const dataURL = await toPng(element, {
      pixelRatio: options?.pixelRatio ?? 0.75,
      backgroundColor: options?.backgroundColor ?? (colorMode === 'dark' ? '#0D1117' : '#FAFBFC'),
      filter: options?.filter,
      quality: options?.quality ?? 1.0,
      cacheBust: true,
    });

    return {
      blob,
      dataURL,
      timestamp: new Date().toISOString()
    };
  }, [captureElement, colorMode, options]);

  /**
   * Download helper - triggers browser download
   */
  const download = useCallback((blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  /**
   * Convert Blob to base64 dataURL (for API uploads)
   */
  const blobToDataURL = useCallback((blob: Blob): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }, []);

  return {
    captureElement,
    captureElementFullHeight,
    captureFileView,
    captureElementWithMetadata,
    download,
    blobToDataURL
  };
}
