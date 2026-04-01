/**
 * Client-safe connection testing functions.
 * Server-only backend functions (initializeConnectionOnPython, getSchemaFromPython, etc.)
 * live in python-backend.server.ts.
 */

export async function testConnection(
  type: string,
  config: Record<string, any>,
  name?: string,
  includeSchema: boolean = false
): Promise<{ success: boolean; message: string; schema?: any }> {
  const res = await fetch('/api/connections/test', {
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

  return res.json();
}

export async function testConnectionOnPython(
  name: string,
  type: string,
  config: Record<string, any>
): Promise<{ success: boolean; message: string; schema?: any }> {
  return testConnection(type, config, name, false);
}

export async function testConnectionConfig(
  type: string,
  config: Record<string, any>
): Promise<{ success: boolean; message: string; schema?: any }> {
  return testConnection(type, config, undefined, false);
}

export async function validateConnectionBeforeCreate(
  type: string,
  config: Record<string, any>,
  includeSchema: boolean = false
): Promise<{ success: boolean; message: string; schema?: any }> {
  return testConnection(type, config, undefined, includeSchema);
}
