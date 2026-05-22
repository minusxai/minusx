import 'server-only';

/**
 * Server-side connections data layer
 * Direct database access; all connection testing / schema fetching runs through
 * the Node.js connectors (`getNodeConnector`). No Python backend.
 * Used by server components and API routes
 */

import { DocumentDB } from '@/lib/database/documents-db';
import { hashContent } from '@/lib/utils/query-hash';
import { ConnectionContent, DatabaseSchema } from '@/lib/types';
import {
  IConnectionsDataLayer,
  ListConnectionsResult,
  GetConnectionResult,
  CreateConnectionResult,
  UpdateConnectionResult,
  CreateConnectionInput
} from './connections.interface';
import { EffectiveUser } from '@/lib/auth/auth-helpers';
import { getSafeConfig, validateConnectionName, RESERVED_NAMES, validateDuckDbFilePath } from './helpers/connections';
import { UserFacingError } from '@/lib/errors';
import { resolvePath } from '@/lib/mode/path-resolver';
import { Mode } from '@/lib/mode/mode-types';
import { getNodeConnector } from '@/lib/connections';

class ConnectionsDataLayerServer implements IConnectionsDataLayer {
  async listAll(user: EffectiveUser, includeSchemas = false): Promise<ListConnectionsResult> {
    // Filter connections by mode to ensure mode isolation
    const modePath = `/${user.mode}`;
    const connections = await DocumentDB.listAll('connection', [modePath]);

    const formatted = connections.map(conn => {
      const content = conn.content as ConnectionContent;
      return {
        id: conn.id,
        name: conn.name,
        type: content.type,
        config: getSafeConfig(content.type, content.config),
        created_at: conn.created_at,
        updated_at: conn.updated_at
      };
    });

    if (!includeSchemas) {
      return { connections: formatted };
    }

    // Fetch schemas in parallel (no timeout, no fallback)
    const schemaPromises = connections.map(async conn => {
      const content = conn.content as ConnectionContent;
      try {
        const connector = getNodeConnector(conn.name, content.type, content.config);
        const schema: DatabaseSchema = {
          schemas: connector ? await connector.getSchema() : [],
          updated_at: new Date().toISOString(),
        };
        return { name: conn.name, schema };
      } catch (error) {
        console.error(`[ConnectionsAPI] Failed to fetch schema for ${conn.name}:`, error);
        return { name: conn.name, schema: null };
      }
    });

    const schemaResults = await Promise.all(schemaPromises);
    const schemas = schemaResults.reduce((acc, { name, schema }) => {
      acc[name] = schema;
      return acc;
    }, {} as Record<string, DatabaseSchema | null>);

    return { connections: formatted, schemas };
  }

  async getByName(name: string, user: EffectiveUser): Promise<GetConnectionResult> {
    const connectionPath = resolvePath(user.mode, `/database/${name}`);
    const conn = await DocumentDB.getByPath(connectionPath);

    if (!conn) {
      throw new Error(`Connection '${name}' not found`);
    }

    const content = conn.content as ConnectionContent;
    return {
      connection: {
        id: conn.id,
        name: conn.name,
        type: content.type,
        config: getSafeConfig(content.type, content.config),
        created_at: conn.created_at,
        updated_at: conn.updated_at
      }
    };
  }

  /**
   * Get connection with raw (unfiltered) config — for trusted internal server-to-server use only.
   * Never expose this to clients; it returns sensitive credentials like service_account_json.
   */
  async getRawByName(name: string, mode: Mode): Promise<{ type: string; config: Record<string, any> }> {
    const connectionPath = resolvePath(mode, `/database/${name}`);
    const conn = await DocumentDB.getByPath(connectionPath);

    if (!conn) {
      throw new Error(`Connection '${name}' not found`);
    }

    const content = conn.content as ConnectionContent;
    return { type: content.type, config: content.config };

  }

  async create(input: CreateConnectionInput, user: EffectiveUser): Promise<CreateConnectionResult> {
    // DuckDB connections cannot be created manually — arbitrary file paths are a security risk
    if (input.type === 'duckdb') {
      throw new UserFacingError('DuckDB connections cannot be created manually. Use CSV uploads or Google Sheets instead.');
    }

    // internal_db is a reserved system connection type, not user-creatable
    if ((input.type as string) === 'internal_db') {
      throw new UserFacingError('internal_db is a reserved connection type and cannot be created manually.');
    }

    // Validation
    validateConnectionName(input.name);

    if (RESERVED_NAMES.includes(input.name)) {
      throw new Error(`Connection name "${input.name}" is reserved`);
    }

    validateDuckDbFilePath(input.type, input.config);

    // Check duplicates
    const connectionPath = resolvePath(user.mode, `/database/${input.name}`);
    const existing = await DocumentDB.getByPath(connectionPath);
    if (existing) {
      throw new Error(`Connection '${input.name}' already exists`);
    }

    // Validate connection before creating, via the Node.js connector.
    const nodeConnector = getNodeConnector(input.name, input.type, input.config);
    const validationResult = nodeConnector
      ? await nodeConnector.testConnection(false)
      : { success: true, message: '' };
    if (!validationResult.success) {
      throw new Error(`Connection test failed: ${validationResult.message}`);
    }

    // Create in DB (name in file metadata, not content)
    const content: ConnectionContent = { type: input.type, config: input.config };
    const id = await DocumentDB.create(
      input.name,
      connectionPath,
      'connection',
      content,
      [],  // Phase 6: Connections have no references
      undefined,
      false  // connections are immediately visible after creation
    );

    const created = await DocumentDB.getById(id);
    if (!created) {
      throw new Error('Failed to create connection');
    }

    const createdContent = created.content as ConnectionContent;
    return {
      connection: {
        id: created.id,
        name: created.name,
        type: createdContent.type,
        config: getSafeConfig(createdContent.type, createdContent.config),
        created_at: created.created_at,
        updated_at: created.updated_at
      }
    };
  }

  async update(name: string, config: Record<string, any>, user: EffectiveUser): Promise<UpdateConnectionResult> {
    // Block editing reserved names
    if (RESERVED_NAMES.includes(name)) {
      throw new Error(`Cannot edit connection "${name}" (reserved)`);
    }

    const connectionPath = resolvePath(user.mode, `/database/${name}`);
    const conn = await DocumentDB.getByPath(connectionPath);
    if (!conn) {
      throw new Error(`Connection '${name}' not found`);
    }

    const content = conn.content as ConnectionContent;
    validateDuckDbFilePath(content.type, config);
    content.config = config;

    await DocumentDB.update(conn.id, name, conn.path, content, [], hashContent({ id: conn.id, config }));  // Phase 6: Connections have no references

    // Schema is refreshed lazily by the connection-loader (Node connectors) on next read.
    const updated = await DocumentDB.getById(conn.id);
    if (!updated) {
      throw new Error('Failed to update connection');
    }

    const updatedContent = updated.content as ConnectionContent;
    return {
      connection: {
        id: updated.id,
        name: updated.name,
        type: updatedContent.type,
        config: getSafeConfig(updatedContent.type, updatedContent.config),
        created_at: updated.created_at,
        updated_at: updated.updated_at
      }
    };
  }

  async delete(name: string, user: EffectiveUser): Promise<void> {
    // Block deleting reserved names
    if (RESERVED_NAMES.includes(name)) {
      throw new Error(`Cannot delete connection "${name}" (reserved)`);
    }

    const connectionPath = resolvePath(user.mode, `/database/${name}`);
    const conn = await DocumentDB.getByPath(connectionPath);
    if (!conn) {
      throw new Error(`Connection '${name}' not found`);
    }

    await DocumentDB.deleteByIds([conn.id]);
    // Note: managed-warehouse data files (CSV / Google Sheets parquet) are no
    // longer cleaned up here — that cleanup previously went through the Python
    // backend, which no longer has those endpoints. The connection document is
    // removed; orphaned data files (if any) are a separate concern.
  }

  /**
   * Persist a freshly-fetched schema back to a connection file.
   * Called exclusively by connection-loader.ts as a background cache write.
   * Bypasses full editFile overhead (no permission checks, no events).
   */
  async updateCachedSchema(
    id: number,
    name: string,
    path: string,
    schema: DatabaseSchema,
    references: number[],
  ): Promise<void> {
    const conn = await DocumentDB.getById(id);
    if (!conn) return;
    const updatedContent: ConnectionContent = { ...(conn.content as ConnectionContent), schema };
    await DocumentDB.update(id, name, path, updatedContent, references, hashContent({ id, schema }));
  }

  async test(name: string, user: EffectiveUser): Promise<{ success: boolean; message: string }> {
    const connectionPath = resolvePath(user.mode, `/database/${name}`);
    const conn = await DocumentDB.getByPath(connectionPath);
    if (!conn) {
      throw new Error(`Connection '${name}' not found`);
    }

    const content = conn.content as ConnectionContent;

    // All connection types are tested via their Node.js connector.
    const nodeConnector = getNodeConnector(name, content.type, content.config);
    if (nodeConnector) {
      return nodeConnector.testConnection(false);
    }
    return { success: false, message: `No connector available for connection type '${content.type}'` };
  }

}

// Singleton instance
export const ConnectionsAPI = new ConnectionsDataLayerServer();

// Functional API exports
export const listAllConnections = ConnectionsAPI.listAll.bind(ConnectionsAPI);
export const getConnection = ConnectionsAPI.getByName.bind(ConnectionsAPI);
export const createConnection = ConnectionsAPI.create.bind(ConnectionsAPI);
export const updateConnection = ConnectionsAPI.update.bind(ConnectionsAPI);
export const deleteConnection = ConnectionsAPI.delete.bind(ConnectionsAPI);
export const testConnection = ConnectionsAPI.test.bind(ConnectionsAPI);
export const updateCachedSchema = ConnectionsAPI.updateCachedSchema.bind(ConnectionsAPI);
