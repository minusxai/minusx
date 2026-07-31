/**
 * A build must refuse data it cannot correctly read or write.
 *
 * Both bounds fail silently without a gate: too-old data is misread rather than
 * rejected, and too-new data is overwritten by an older build's shapes. Neither shows up
 * as an error — they show up as wrong content later.
 */

import { checkDataVersion, dataVersionMessage } from '@/lib/database/data-version-gate';
import { getDataVersion } from '@/lib/database/config-store';
import { LATEST_DATA_VERSION, MINIMUM_SUPPORTED_DATA_VERSION } from '@/lib/database/constants';

vi.mock('@/lib/database/config-store', () => ({ getDataVersion: vi.fn() }));
const at = (v: number) => vi.mocked(getDataVersion).mockResolvedValue(v);

describe('data version gate', () => {
  it('serves a workspace inside the supported range', async () => {
    at(LATEST_DATA_VERSION);
    expect(await checkDataVersion()).toMatchObject({ ok: true });

    at(MINIMUM_SUPPORTED_DATA_VERSION);
    expect(await checkDataVersion()).toMatchObject({ ok: true });
  });

  it('refuses a workspace older than this build can read', async () => {
    at(MINIMUM_SUPPORTED_DATA_VERSION - 1);
    const v = await checkDataVersion();

    expect(v).toMatchObject({ ok: false, reason: 'upgrade-pending' });
    expect(dataVersionMessage(v)).toContain('Upgrade pending');
  });

  it('refuses a workspace NEWER than this build writes — a rolled-back deploy', async () => {
    // The dangerous direction: serving would mean writing older shapes over newer data.
    at(LATEST_DATA_VERSION + 1);
    const v = await checkDataVersion();

    expect(v).toMatchObject({ ok: false, reason: 'build-too-old' });
    expect(dataVersionMessage(v)).toContain('not overwritten');
  });

  it('lets a mid-provision workspace through', async () => {
    // 0 means the data_version row does not exist yet, not that the data is ancient —
    // refusing here would break registration itself.
    at(0);
    expect(await checkDataVersion()).toMatchObject({ ok: true, version: 0 });
  });
});
