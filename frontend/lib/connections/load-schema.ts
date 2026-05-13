import 'server-only';
import type { SchemaEntry } from './base';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';
import { FilesAPI } from '@/lib/data/files.server';
import { connectionLoader } from '@/lib/data/loaders/connection-loader';
import { resolvePath } from '@/lib/mode/path-resolver';

/**
 * Load the cached schema for a named connection from its connection file.
 *
 * This is the production schema-retrieval path used by `SearchDBSchema`
 * (and any other server-side caller that needs schema metadata for an
 * existing connection). It reads `content.schema.schemas` off the
 * connection's stored DbFile — populated by the connection loader at
 * connection-save / schema-refresh time, so calls here are O(1) DB reads
 * with no live introspection.
 *
 * The benchmark + chat-continuation paths short-circuit this entirely:
 * their tool variant builds connectors from `ctx.connections[*].config`
 * and calls `connector.getSchema()` directly, so they never invoke
 * this function.
 */
export async function loadConnectionSchema(
  connection: string,
  user: EffectiveUser,
): Promise<SchemaEntry[]> {
  try {
    const connectionPath = resolvePath(user.mode, `/database/${connection}`);
    const file = await FilesAPI.loadFileByPath(connectionPath, user);
    const loaded = await connectionLoader(file.data, user);
    const content = loaded.content as { schema?: { schemas?: SchemaEntry[] } };
    return content.schema?.schemas ?? [];
  } catch {
    return [];
  }
}
