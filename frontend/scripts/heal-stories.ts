#!/usr/bin/env tsx
/**
 * Heal stored `story` documents bloated by the historical serialize bugs — nested
 * `data-mx-story-root` wrappers + leaked inline-`<Number>` popover DOM baked into content.story.
 * Reruns the fixed serialize over each story's stored HTML and writes back the shrunk result.
 *
 * NOTE: PGLite is a single-process file DB — STOP the dev server before running this.
 *
 * Usage:  npm run heal-stories            (heal + write)
 *         npm run heal-stories -- --dry   (report only, no writes)
 */
import { getModules, isModulesRegistered } from '../lib/modules/registry';
import { registerWithModules } from '../lib/instrumentation/register-modules';
import { healStories } from '../lib/data/heal-stories.server';

function kb(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

async function main() {
  const dry = process.argv.includes('--dry');
  // A standalone CLI never runs Next's instrumentation hook, so the runtime modules
  // (db/auth/store/cache) aren't registered yet — do it here.
  if (!isModulesRegistered()) {
    await registerWithModules();
  }
  const db = getModules().db;
  await db.init?.();

  const report = await healStories({ dry });

  console.log(`\nStories scanned : ${report.total}`);
  console.log(`Healed          : ${report.healed.length}${dry ? ' (DRY RUN — no writes)' : ''}`);
  console.log(`Skipped (clean) : ${report.skipped}`);
  if (report.healed.length > 0) {
    const pct = report.totalBytesBefore > 0
      ? (100 * (1 - report.totalBytesAfter / report.totalBytesBefore)).toFixed(1)
      : '0';
    console.log(`Total size      : ${kb(report.totalBytesBefore)} → ${kb(report.totalBytesAfter)}  (${pct}% smaller)\n`);
    for (const h of report.healed) {
      const p = h.beforeBytes > 0 ? (100 * (1 - h.afterBytes / h.beforeBytes)).toFixed(1) : '0';
      console.log(`  #${h.id}  ${h.path}  ${kb(h.beforeBytes)} → ${kb(h.afterBytes)}  (${p}% smaller)`);
    }
  }

  await db.close?.();
}

main().catch((e) => { console.error(e); process.exit(1); });
