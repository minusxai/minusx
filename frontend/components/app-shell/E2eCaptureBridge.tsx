'use client';

import { useEffect } from 'react';
import { E2E_MODE } from '@/lib/constants';
import { installE2eCaptureHook } from '@/lib/screenshot/e2e-capture';

/**
 * Installs `window.__MX_CAPTURE_FILE__` so a QA run can produce the image the
 * APP produces (see `lib/screenshot/e2e-capture.ts`). Renders nothing.
 *
 * Same gate as the store exposure in `ReduxProvider`: the build-time E2E flag
 * (local/CI) or the runtime QA opt-in on a prod build. Separate component
 * because this is capture, not Redux — and because the effect gate must be a
 * runtime one, not a conditional render, so SSR and hydration agree.
 */
export function E2eCaptureBridge({ enabled }: { enabled?: boolean }) {
  useEffect(() => {
    if (E2E_MODE || enabled) installE2eCaptureHook();
  }, [enabled]);
  return null;
}
