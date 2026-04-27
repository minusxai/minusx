import 'server-only';
import { validateFileState } from './content-validators';
import { getNodeConnector } from '@/lib/connections';
import type { FileType } from '@/lib/types';

export { validateFileState } from './content-validators';

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
    const connector = getNodeConnector(file.name || '', conn.type, conn.config);
    if (connector) {
      const result = await connector.testConnection(false);
      if (!result.success) return `Connection test failed: ${result.message}`;
    }
  }

  return null;
}
