/**
 * Access V2 / M1c — run a callback in a transaction as the restricted
 * `app_user` role with the caller's access context installed, so the `files`
 * RLS policies (postgres-schema.ts) enforce permissions inside the database.
 *
 * `SET LOCAL ROLE` + `set_config(..., true)` are both transaction-local: the
 * connection returns to the owner role the moment the transaction ends, so the
 * owner/system path (plain exec) is never affected.
 *
 * If the `app_user` role could not be created at schema init (hosted Postgres
 * user without CREATEROLE), this degrades gracefully: the callback runs in a
 * plain transaction and enforcement falls back to predicate injection +
 * app-side checks. Checked once per adapter instance, warned once per process.
 */
import type { IDatabaseAdapter, ITransactionContext } from '@/lib/database/adapter/types';

const roleCheck = new WeakMap<IDatabaseAdapter, Promise<boolean>>();
let warned = false;

export async function runWithAccess<T>(
  adapter: IDatabaseAdapter,
  accessContextJson: string,
  fn: (tx: ITransactionContext) => Promise<T>,
): Promise<T> {
  let check = roleCheck.get(adapter);
  if (!check) {
    check = adapter
      .query("SELECT 1 FROM pg_roles WHERE rolname = 'app_user'")
      .then(r => r.rows.length > 0)
      .catch(() => false);
    roleCheck.set(adapter, check);
  }
  const hasRole = await check;
  if (!hasRole && !warned) {
    warned = true;
    console.warn(
      '[access] app_user role unavailable — database-level RLS enforcement is off; ' +
      'falling back to SQL predicate injection + app-side checks',
    );
  }
  return adapter.transaction(async (tx) => {
    await tx.query("SELECT set_config('app.access', $1, true)", [accessContextJson]);
    if (hasRole) await tx.exec('SET LOCAL ROLE app_user');
    return fn(tx);
  });
}
