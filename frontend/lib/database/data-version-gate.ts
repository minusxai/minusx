import 'server-only';
import { getDataVersion } from '@/lib/database/config-store';
import { LATEST_DATA_VERSION, MINIMUM_SUPPORTED_DATA_VERSION } from '@/lib/database/constants';

/**
 * Whether this build may serve the data it is looking at.
 *
 * A build declares two things: the oldest data version it can READ
 * (MINIMUM_SUPPORTED_DATA_VERSION) and the version it WRITES (LATEST_DATA_VERSION).
 * Both bounds matter, in opposite directions:
 *
 *   below the minimum — the data predates what this code understands, so it would be
 *     misread rather than rejected. Silent corruption, not an error.
 *   above the maximum — an older build has been rolled back onto newer data. Serving it
 *     means writing v38 shapes over v39 ones.
 *
 * Refusing is the point. Without this, a workspace that has not been migrated yet is
 * indistinguishable from one that has, right up until its content comes back wrong.
 */
export interface DataVersionVerdict {
  ok: boolean;
  version: number;
  reason?: 'upgrade-pending' | 'build-too-old';
}

export async function checkDataVersion(): Promise<DataVersionVerdict> {
  const version = await getDataVersion();

  // 0 means "no data_version row yet" — a workspace mid-provision, not a stale one.
  if (version === 0) return { ok: true, version };

  if (version < MINIMUM_SUPPORTED_DATA_VERSION) {
    return { ok: false, version, reason: 'upgrade-pending' };
  }
  if (version > LATEST_DATA_VERSION) {
    return { ok: false, version, reason: 'build-too-old' };
  }
  return { ok: true, version };
}

export function dataVersionMessage(v: DataVersionVerdict): string {
  return v.reason === 'build-too-old'
    ? `This deployment writes data version ${LATEST_DATA_VERSION}, but this workspace is on ${v.version}. Refusing to serve it so newer data is not overwritten.`
    : `This workspace is on data version ${v.version}, older than the minimum this build can read (${MINIMUM_SUPPORTED_DATA_VERSION}). Upgrade pending.`;
}
