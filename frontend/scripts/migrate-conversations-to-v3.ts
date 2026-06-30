#!/usr/bin/env tsx
/**
 * Chat Architecture v3 — backfill CLI. Ports conversation files → v3 tables (preserving ids).
 *
 * NOTE: PGLite is a single-process file DB — STOP the dev server before running this, or use the
 * in-process admin endpoint (POST /api/admin/migrate-conversations-v3) while the server runs.
 *
 * Usage:  npm run migrate-conversations-to-v3            (migrate)
 *         npm run migrate-conversations-to-v3 -- --dry   (report only)
 */
import { getModules, isModulesRegistered } from '../lib/modules/registry';
import { registerWithModules } from '../lib/instrumentation/register-modules';
import { migrateConversationsToV3 } from '../lib/data/migrate-conversations-v3.server';

async function main() {
  const dry = process.argv.includes('--dry');
  // A standalone CLI never runs Next's instrumentation hook, so the runtime modules
  // (db/auth/store/cache) this migration needs aren't registered yet — do it here.
  if (!isModulesRegistered()) {
    await registerWithModules();
  }
  const db = getModules().db;
  await db.init?.();
  const report = await migrateConversationsToV3({ dry });
  console.log(JSON.stringify(report, null, 2));
  await db.close?.();
}

main().catch((e) => { console.error(e); process.exit(1); });
