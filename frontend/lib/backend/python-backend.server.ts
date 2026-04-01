import 'server-only';
import { BACKEND_URL } from '@/lib/config';
import { pythonBackendFetch } from '@/lib/api/python-backend-client';

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

  return res.json();
}

export async function removeConnectionFromPython(name: string): Promise<void> {
  await fetch(`${BACKEND_URL}/api/connections/${name}/remove`, {
    method: 'POST'
  });
}

export async function getSchemaFromPython(name: string, type: string, config: Record<string, any>) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 300000);

  try {
    const res = await fetch(`${BACKEND_URL}/api/connections/${name}/schema`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, config }),
      cache: 'no-store',
      signal: controller.signal
    });

    if (!res.ok) {
      const error = await res.text();
      console.error(`[getSchemaFromPython] Failed to fetch schema for ${name} (${res.status}):`, error);
      return { schemas: [] };
    }

    const result = await res.json();
    console.log(`[getSchemaFromPython] Successfully fetched schema for ${name}: ${result.schemas?.length || 0} schemas`);
    return result;
  } catch (error: any) {
    if (error.name === 'AbortError') {
      console.error(`[getSchemaFromPython] Timeout fetching schema for ${name} after 5 minutes`);
    } else {
      console.error(`[getSchemaFromPython] Exception fetching schema for ${name}:`, error);
    }
    return { schemas: [] };
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function testConnectionOnPython(
  name: string,
  type: string,
  config: Record<string, any>
): Promise<{ success: boolean; message: string; schema?: any }> {
  const res = await pythonBackendFetch('/api/connections/test', {
    method: 'POST',
    body: JSON.stringify({ name, type, config, include_schema: false })
  });
  if (!res.ok) {
    const error = await res.text();
    throw new Error(`Failed to test connection: ${error}`);
  }
  return res.json();
}

export async function validateConnectionBeforeCreate(
  type: string,
  config: Record<string, any>,
  includeSchema: boolean = false
): Promise<{ success: boolean; message: string; schema?: any }> {
  const res = await pythonBackendFetch('/api/connections/test', {
    method: 'POST',
    body: JSON.stringify({ name: null, type, config, include_schema: includeSchema })
  });
  if (!res.ok) {
    const error = await res.text();
    throw new Error(`Failed to test connection: ${error}`);
  }
  return res.json();
}
