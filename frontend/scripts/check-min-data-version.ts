#!/usr/bin/env tsx

/**
 * Refuse to ship a build that cannot read data still in service.
 *
 * A build declares the oldest data version it can READ
 * (MINIMUM_SUPPORTED_DATA_VERSION) and the version it WRITES (LATEST_DATA_VERSION).
 * Raising the bottom of that range is only safe once everything the deployment serves has
 * been migrated past it — otherwise a workspace left behind is served by code that
 * MISREADS its data, which surfaces as wrong content rather than an error.
 *
 * The comparison needs both numbers, and they come from different builds: only the
 * candidate knows its own MINIMUM, and only the running deployment knows what it is
 * serving. That is why this is a script rather than something the endpoint could answer,
 * and why it lives beside the constants it reads.
 *
 *   MIN_DATA_VERSION_URL=https://<host>/api/admin/min-data-version \
 *   CRON_SECRET=<secret> \
 *   npx tsx scripts/check-min-data-version.ts
 *
 * Exit codes: 0 pass, 1 would strand a workspace, 2 could not determine — also fatal,
 * because "the check did not run" must never read the same as "the check passed".
 */

import { MINIMUM_SUPPORTED_DATA_VERSION, LATEST_DATA_VERSION } from '@/lib/database/constants';

const url = process.env.MIN_DATA_VERSION_URL;
const secret = process.env.CRON_SECRET;

function fail(code: number, message: string): never {
  console.error(`❌ ${message}`);
  process.exit(code);
}

async function main(): Promise<void> {
  if (!url) fail(2, 'MIN_DATA_VERSION_URL is not set — cannot determine what is deployed.');
  if (!secret) fail(2, 'CRON_SECRET is not set — the endpoint would answer without telling us anything.');

  const res = await fetch(url, { headers: { Authorization: `Bearer ${secret}` } })
    .catch((e: unknown) => fail(2, `Could not reach ${url}: ${(e as Error).message}`));

  if (!res.ok) fail(2, `${url} returned ${res.status}.`);

  const body = await res.json().catch(() => fail(2, `${url} did not return JSON.`));

  // A wrong secret gets `{ ok: true }` rather than the number — withCronAuth answers 200
  // without the payload instead of 401. So a missing `min` means "did not run", never a
  // pass.
  const min = (body as { min?: unknown }).min;
  if (typeof min !== 'number') {
    fail(2, `No minimum in the response (${JSON.stringify(body)}). Is CRON_SECRET correct?`);
  }

  // 0 means MIN() found no rows at all, i.e. nothing has recorded a version yet. Treated
  // as undeterminable rather than as "version zero", which would read as every workspace
  // being impossibly stale.
  if (min === 0) {
    fail(2, 'The deployment reports no data version at all. Nothing has recorded one yet.');
  }

  if (min > LATEST_DATA_VERSION) {
    fail(1,
      `The deployment is on data version ${min}, newer than this build writes ` +
      `(${LATEST_DATA_VERSION}). Shipping it would write older shapes over newer data.`);
  }

  if (MINIMUM_SUPPORTED_DATA_VERSION > min) {
    fail(1,
      `This build reads data version ${MINIMUM_SUPPORTED_DATA_VERSION} and newer, but the ` +
      `oldest deployed is on ${min}. Migrate everything past ` +
      `${MINIMUM_SUPPORTED_DATA_VERSION} before raising the minimum.`);
  }

  console.log(
    `✅ Oldest deployed data version is ${min}; this build reads ` +
    `${MINIMUM_SUPPORTED_DATA_VERSION}–${LATEST_DATA_VERSION}.`,
  );
}

main().catch((e: unknown) => fail(2, `Check failed to run: ${(e as Error).message}`));
