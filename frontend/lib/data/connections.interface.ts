import { EffectiveUser } from '@/lib/auth/auth-helpers';
import { DatabaseConnection, DatabaseSchema, TestConnectionResult } from '@/lib/types';

/**
 * Shared interface for connections data layer
 * Both server and client implementations must conform to this interface
 *
 * Server: Direct database access via the Node.js connectors
 * Client: HTTP calls to API routes
 */
export interface IConnectionsDataLayer {
  /**
   * List all connections (with optional schemas)
   * @param user - Authenticated user (server) or undefined (client, auth via cookies)
   * @param includeSchemas - Whether to fetch schemas via the connector (expensive)
   */
  listAll(user: EffectiveUser, includeSchemas?: boolean): Promise<ListConnectionsResult>;

  /**
   * Get single connection by name
   */
  getByName(name: string, user: EffectiveUser): Promise<GetConnectionResult>;

  /**
   * Create new connection
   * Validates via the connector before creating document
   */
  create(input: CreateConnectionInput, user: EffectiveUser): Promise<CreateConnectionResult>;

  /**
   * Update connection config
   * Re-initializes the connector and returns updated schema
   */
  update(name: string, config: Record<string, any>, user: EffectiveUser): Promise<UpdateConnectionResult>;

  /**
   * Delete connection
   * Removes from the database
   */
  delete(name: string, user: EffectiveUser): Promise<void>;

  /**
   * Test connection via the connector
   */
  test(name: string, user: EffectiveUser): Promise<TestConnectionResult>;
}

/**
 * Result type for listAll operation
 */
export interface ListConnectionsResult {
  connections: DatabaseConnection[];
  schemas?: Record<string, DatabaseSchema | null>;  // Optional, for Redux preload
}

/**
 * Result type for getByName operation
 */
export interface GetConnectionResult {
  connection: DatabaseConnection;
  schema?: DatabaseSchema;  // Optional
}

/**
 * Result type for create operation
 */
export interface CreateConnectionResult {
  connection: DatabaseConnection;
}

/**
 * Result type for update operation
 */
export interface UpdateConnectionResult {
  connection: DatabaseConnection;
  schema?: DatabaseSchema;  // Included when re-initialized
}

/**
 * Input type for create operation
 */
export interface CreateConnectionInput {
  name: string;
  type: 'duckdb' | 'bigquery' | 'postgresql' | 'csv' | 'google-sheets' | 'athena';
  config: Record<string, any>;
}
