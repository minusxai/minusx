// One-shot cleanup: delete any leftover `type:'chat'` files from the dev DB.
//
// The v=2 architecture no longer uses a `'chat'` file type — v=2 conversations
// live as `type:'conversation'` with `meta.version === 2`. This script removes
// any orphan rows from prior iterations of the v=2 work. Safe to run
// repeatedly; it's a no-op if there are none.
//
// Run with:  cd frontend && npx tsx --conditions react-server scripts/cleanup-chat-files.ts

import 'dotenv/config';
import { DBModule } from '../lib/modules/db';

async function main() {
  const db = new DBModule();
  await db.init();
  const before = await db.exec<{ count: string }>(
    "SELECT COUNT(*) as count FROM files WHERE type = 'chat'",
  );
  const beforeCount = parseInt(before.rows[0]?.count ?? '0', 10);
  console.log(`[cleanup] Found ${beforeCount} type='chat' files.`);
  if (beforeCount === 0) {
    console.log('[cleanup] Nothing to delete.');
    return;
  }
  const deleted = await db.exec("DELETE FROM files WHERE type = 'chat'");
  console.log(`[cleanup] Deleted ${deleted.rowCount} files.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[cleanup] Failed:', err);
    process.exit(1);
  });
