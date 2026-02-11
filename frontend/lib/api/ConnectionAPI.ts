import { DatabaseConnection, DatabaseConnectionCreate, TestConnectionResult } from '../types';
import { fetchWithCache } from './fetch-wrapper';
import { API } from './declarations';

export default class ConnectionAPI {
  /**
   * List all database connections
   */
  static async listAll(): Promise<DatabaseConnection[]> {
    const json = await fetchWithCache('/api/connections', {
      method: 'GET',
      cacheStrategy: API.connections.list.cache,
    });
    return json.data || json; // Support both new and legacy format
  }

  /**
   * Get a specific connection
   */
  static async getById(name: string): Promise<DatabaseConnection> {
    const json = await fetchWithCache(`/api/connections/${name}`, {
      method: 'GET',
      cacheStrategy: {
        ttl: 5 * 60 * 1000,
        deduplicate: true,
      },
    });
    return json.data || json; // Support both new and legacy format
  }

  /**
   * Create a new connection
   */
  static async create(data: DatabaseConnectionCreate): Promise<DatabaseConnection> {
    const json = await fetchWithCache('/api/connections', {
      method: 'POST',
      body: JSON.stringify(data),
      cacheStrategy: {
        ttl: 0,
        deduplicate: false,
      },
    });
    return json.data || json; // Support both new and legacy format
  }

  /**
   * Update a connection
   */
  static async update(name: string, config: Record<string, any>): Promise<DatabaseConnection> {
    const json = await fetchWithCache(`/api/connections/${name}`, {
      method: 'PUT',
      body: JSON.stringify({ config }),
      cacheStrategy: {
        ttl: 0,
        deduplicate: false,
      },
    });
    return json.data || json; // Support both new and legacy format
  }

  /**
   * Delete a connection
   */
  static async delete(name: string): Promise<void> {
    await fetchWithCache(`/api/connections/${name}`, {
      method: 'DELETE',
      cacheStrategy: {
        ttl: 0,
        deduplicate: true,
      },
    });
  }

  /**
   * Test a connection
   */
  static async test(name: string): Promise<TestConnectionResult> {
    const json = await fetchWithCache(`/api/connections/${name}/test`, {
      method: 'POST',
      cacheStrategy: API.connections.test.cache,
    });
    return json.data || json; // Support both new and legacy format
  }
}
