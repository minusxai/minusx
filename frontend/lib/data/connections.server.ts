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
} from '@/lib/backend/python-backend';
import { deleteCsvData } from '@/lib/backend/csv-upload';
import { deleteGoogleSheetsData } from '@/lib/backend/google-sheets';
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
import { resolvePath } from '@/lib/mode/path-resolver';

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
        const schema = await getSchemaFromPython(conn.name, content.type, content.config);
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

  async create(input: CreateConnectionInput, user: EffectiveUser): Promise<CreateConnectionResult> {
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

    // Validate with Python backend before creating
    const validationResult = await validateConnectionBeforeCreate(input.type, input.config);
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

    // Re-initialize on Python backend and capture schema
    let schema: DatabaseSchema | null = null;
    try {
      await removeConnectionFromPython(name);
      const initResult = await initializeConnectionOnPython(name, content.type, config);
      schema = initResult.schema || null;
    } catch (error) {
      console.error(`[ConnectionsAPI] Failed to re-initialize connection ${name}:`, error);
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

    await DocumentDB.delete(conn.id, user.companyId);

    // Remove from Python backend
    try {
      await removeConnectionFromPython(name);
    } catch (error) {
      console.error(`[ConnectionsAPI] Failed to remove connection ${name} from Python backend:`, error);
    }

    // For CSV connections, also clean up the data files
    if (content.type === 'csv') {
      try {
        await deleteCsvData(name, user.companyId, user.mode);
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

  async test(name: string, user: EffectiveUser): Promise<{ success: boolean; message: string }> {
    const connectionPath = resolvePath(user.mode, `/database/${name}`);
    const conn = await DocumentDB.getByPath(connectionPath, user.companyId);
    if (!conn) {
      throw new Error(`Connection '${name}' not found`);
    }

    const content = conn.content as ConnectionContent;

    // Initialize if not already initialized
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
