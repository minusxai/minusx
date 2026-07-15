/**
 * Browser/handler-side entry to the viz validator: the vendored VL schema is
 * server-only, so validation goes through POST /api/viz/validate.
 *
 * FAIL-OPEN by design: validation is a quality guard, not an availability gate —
 * if the route is unreachable the edit proceeds (a real error still surfaces at
 * render). Never throws.
 */
import type { VizResultColumn, VizValidationResult } from './types';

export async function validateVizRemote(
  viz: unknown,
  columns?: VizResultColumn[],
): Promise<VizValidationResult> {
  try {
    const res = await fetch('/api/viz/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ viz, columns }),
    });
    if (!res.ok) return { ok: true, issues: [] };
    const json = await res.json();
    return (json?.data as VizValidationResult | undefined) ?? { ok: true, issues: [] };
  } catch {
    return { ok: true, issues: [] };
  }
}
