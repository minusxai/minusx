import 'server-only';

/**
 * Server-side connections data layer
 * Direct database access with Python backend orchestration
 * Used by server components and API routes
 */

import { DocumentDB } from '@/lib/database/documents-db';
import {
  initializeConnectionOnPython,
  removeConnectionFromPython,
  testConnectionOnPython,
  getSchemaFromPython,
  validateConnectionBeforeCreate
} from '@/lib/backend/python-backend.server';
import { BACKEND_URL } from '@/lib/config';
import { deleteGoogleSheetsData } from '@/lib/backend/google-sheets.server';
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
    const connections = await DocumentDB.listAll(user.companyId, 'connection', [modePath]);

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
        const schema = connector
          ? { schemas: await connector.getSchema() }
          : await getSchemaFromPython(conn.name, content.type, content.config);
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
    const conn = await DocumentDB.getByPath(connectionPath, user.companyId);

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
  async getRawByName(name: string, companyId: number, mode: Mode): Promise<{ type: string; config: Record<string, any> }> {
    const connectionPath = resolvePath(mode, `/database/${name}`);
    const conn = await DocumentDB.getByPath(connectionPath, companyId);

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

    // Validation
    validateConnectionName(input.name);

    if (RESERVED_NAMES.includes(input.name)) {
      throw new Error(`Connection name "${input.name}" is reserved`);
    }

    validateDuckDbFilePath(input.type, input.config, user.companyId);

    // Check duplicates
    const connectionPath = resolvePath(user.mode, `/database/${input.name}`);
    const existing = await DocumentDB.getByPath(connectionPath, user.companyId);
    if (existing) {
      throw new Error(`Connection '${input.name}' already exists`);
    }

    // Validate connection before creating.
    // DuckDB connections are tested in Node.js; all others go through Python.
    const nodeConnector = getNodeConnector(input.name, input.type, input.config);
    const validationResult = nodeConnector
      ? await nodeConnector.testConnection(false)
      : await validateConnectionBeforeCreate(input.type, input.config);
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
      user.companyId
    );

    const created = await DocumentDB.getById(id, user.companyId);
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
    const conn = await DocumentDB.getByPath(connectionPath, user.companyId);
    if (!conn) {
      throw new Error(`Connection '${name}' not found`);
    }

    const content = conn.content as ConnectionContent;
    validateDuckDbFilePath(content.type, config, user.companyId);
    content.config = config;

    await DocumentDB.update(conn.id, name, conn.path, content, [], user.companyId);  // Phase 6: Connections have no references

    // Re-initialize on Python backend and capture schema.
    // DuckDB connections are handled entirely in Node.js — skip Python to avoid lock conflict.
    let schema: DatabaseSchema | null = null;
    if (!getNodeConnector(name, content.type, config)) {
      try {
        await removeConnectionFromPython(name);
        const initResult = await initializeConnectionOnPython(name, content.type, config);
        schema = initResult.schema || null;
      } catch (error) {
        console.error(`[ConnectionsAPI] Failed to re-initialize connection ${name}:`, error);
      }
    }

    const updated = await DocumentDB.getById(conn.id, user.companyId);
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
      },
      ...(schema && { schema })
    };
  }

  async delete(name: string, user: EffectiveUser): Promise<void> {
    // Block deleting reserved names
    if (RESERVED_NAMES.includes(name)) {
      throw new Error(`Cannot delete connection "${name}" (reserved)`);
    }

    const connectionPath = resolvePath(user.mode, `/database/${name}`);
    const conn = await DocumentDB.getByPath(connectionPath, user.companyId);
    if (!conn) {
      throw new Error(`Connection '${name}' not found`);
    }

    const content = conn.content as ConnectionContent;

    await DocumentDB.deleteByIds([conn.id], user.companyId);

    // Remove from Python backend
    try {
      await removeConnectionFromPython(name);
    } catch (error) {
      console.error(`[ConnectionsAPI] Failed to remove connection ${name} from Python backend:`, error);
    }

    // For CSV connections, also clean up the data files
    if (content.type === 'csv') {
      try {
        await fetch(`${BACKEND_URL}/api/csv/delete/${encodeURIComponent(name)}`, {
          method: 'DELETE',
          headers: {
            'x-company-id': user.companyId.toString(),
            'x-mode': user.mode
          }
        });
        console.log(`[ConnectionsAPI] Cleaned up CSV data for connection ${name}`);
      } catch (error) {
        console.error(`[ConnectionsAPI] Failed to clean up CSV data for ${name}:`, error);
      }
    }

    // For Google Sheets connections, also clean up the data files
    if (content.type === 'google-sheets') {
      try {
        await deleteGoogleSheetsData(name, user.companyId, user.mode);
        console.log(`[ConnectionsAPI] Cleaned up Google Sheets data for connection ${name}`);
      } catch (error) {
        console.error(`[ConnectionsAPI] Failed to clean up Google Sheets data for ${name}:`, error);
      }
    }
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
    companyId: number
  ): Promise<void> {
    const conn = await DocumentDB.getById(id, companyId);
    if (!conn) return;
    const updatedContent: ConnectionContent = { ...(conn.content as ConnectionContent), schema };
    await DocumentDB.update(id, name, path, updatedContent, references, companyId);
  }

  async test(name: string, user: EffectiveUser): Promise<{ success: boolean; message: string }> {
    const connectionPath = resolvePath(user.mode, `/database/${name}`);
    const conn = await DocumentDB.getByPath(connectionPath, user.companyId);
    if (!conn) {
      throw new Error(`Connection '${name}' not found`);
    }

    const content = conn.content as ConnectionContent;

    // Node-handled types (duckdb, csv, google-sheets): test via Node.js connector directly.
    // Never route these to Python — DuckDB lock conflicts would occur.
    const nodeConnector = getNodeConnector(name, content.type, content.config);
    if (nodeConnector) {
      return nodeConnector.testConnection(false);
    }

    // Python-only types (bigquery, postgresql, athena): initialize then test on Python.
    try {
      await initializeConnectionOnPython(name, content.type, content.config);
    } catch (error) {
      console.error(`[ConnectionsAPI] Failed to initialize for test:`, error);
    }

    return testConnectionOnPython(name, content.type, content.config);
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
