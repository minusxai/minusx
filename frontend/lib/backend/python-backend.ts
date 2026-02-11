import { BACKEND_URL } from '@/lib/constants';

export async function initializeConnectionOnPython(
  name: string,
  type: string,
  config: Record<string, any>
): Promise<{ success: boolean; message: string; schema?: any }> {
  const res = await fetch(`${BACKEND_URL}/api/connections/${name}/initialize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type, config })
  });

  if (!res.ok) {
    const error = await res.text();
    throw new Error(`Failed to initialize connection: ${error}`);
  }

  return res.json();  // Now includes { success, message, schema }
}

export async function removeConnectionFromPython(name: string): Promise<void> {
  await fetch(`${BACKEND_URL}/api/connections/${name}/remove`, {
    method: 'POST'
  });
}

/**
 * Unified test connection endpoint
 * Routes through Next.js API to work in both dev and production
 * @param name - Connection name (for existing connections) or undefined (for new configs)
 * @param type - Connection type ('duckdb' | 'bigquery')
 * @param config - Connection configuration
 * @param includeSchema - Whether to fetch schema (default: false for performance)
 */
export async function testConnection(
  type: string,
  config: Record<string, any>,
  name?: string,
  includeSchema: boolean = false
): Promise<{ success: boolean; message: string; schema?: any }> {
  const isServerSide = typeof window === 'undefined';

  // Server-side: Call Python backend directly to avoid auth issues
  // Client-side: Call Next.js API route (which handles auth and forwards to Python)
  const url = isServerSide
    ? `${BACKEND_URL}/api/connections/test`
    : '/api/connections/test';

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: name || null,
      type,
      config,
      include_schema: includeSchema
    })
  });

  if (!res.ok) {
    const error = await res.text();
    throw new Error(`Failed to test connection: ${error}`);
  }

  // API route now passes through Python response directly (no wrapper)
  const result = await res.json();
  return result;
}

// Legacy function for backward compatibility
export async function testConnectionOnPython(
  name: string,
  type: string,
  config: Record<string, any>
): Promise<{ success: boolean; message: string; schema?: any }> {
  return testConnection(type, config, name, false);
}

// Legacy function for backward compatibility
export async function testConnectionConfig(
  type: string,
  config: Record<string, any>
): Promise<{ success: boolean; message: string; schema?: any }> {
  return testConnection(type, config, undefined, false);
}

/**
 * Fetch schema from Python backend
 *
 * NOTE: No Next.js caching here - caching is handled by connection loader
 * which stores schemas in the database with proper refresh logic
 */
export async function getSchemaFromPython(name: string, type: string, config: Record<string, any>) {
  try {
    const res = await fetch(`${BACKEND_URL}/api/connections/${name}/schema`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, config }),
      cache: 'no-store'  // Disable Next.js cache - loader handles caching
    });

    if (!res.ok) {
      const error = await res.text();
      console.error(`[getSchemaFromPython] Failed to fetch schema for ${name} (${res.status}):`, error);
      // Return empty schema instead of throwing
      return { schemas: [] };
    }

    const result = await res.json();
    console.log(`[getSchemaFromPython] Successfully fetched schema for ${name}: ${result.schemas?.length || 0} schemas`);
    return result;
  } catch (error) {
    console.error(`[getSchemaFromPython] Exception fetching schema for ${name}:`, error);
    // Return empty schema instead of throwing
    return { schemas: [] };
  }
}

/**
 * Validate connection with Python backend before creating document
 * Uses the unified test endpoint
 * @param includeSchema - Whether to fetch schema (default: false for performance)
 */
export async function validateConnectionBeforeCreate(
  type: string,
  config: Record<string, any>,
  includeSchema: boolean = false
): Promise<{ success: boolean; message: string; schema?: any }> {
  return await testConnection(type, config, undefined, includeSchema);
}
