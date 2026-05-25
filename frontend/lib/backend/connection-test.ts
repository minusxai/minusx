/**
 * Client-safe connection testing helper. POSTs to the Next.js
 * `/api/connections/test` route, which tests connections via the Node.js
 * connectors.
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
