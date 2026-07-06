import 'server-only';
import { validateFileState } from './content-validators';
import { getNodeConnector } from '@/lib/connections';
import { resolveConnectionSecrets } from '@/lib/secrets/connection-secrets.server';
import type { FileType } from '@/lib/types';

/**
 * Server-only extension of validateFileState. Runs the same structural checks
 * plus an async live connection test for connection-type files.
 */
export async function validateFileStateServer(file: {
  type: FileType;
  content: unknown;
  name?: string;
  path?: string;
}): Promise<string | null> {
  const error = validateFileState(file);
  if (error) return error;

  if (file.type === 'connection') {
    const conn = file.content as any;
    // The persisted config holds @SECRETS/… refs (raw credentials live in the server-only secrets
    // table). Resolve them to real values before the live test — same as every other server-side
    // connector build (run-query, connection-loader, fuzzy-match). Otherwise a connector that parses
    // a credential field (e.g. BigQuery's JSON.parse(service_account_json)) chokes on the ref string.
    const config = await resolveConnectionSecrets(conn.config ?? {});
    const connector = getNodeConnector(file.name || '', conn.type, config);
    if (connector) {
      const result = await connector.testConnection(false);
      if (!result.success) return `Connection test failed: ${result.message}`;
    }
  }

  return null;
}
