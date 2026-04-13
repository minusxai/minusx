import 'server-only';
import { headers } from 'next/headers';
import { logNetworkResponse } from '@/lib/network-logging';

async function logResponse(cloned: Response): Promise<void> {
  try {
    const h = await headers();
    const requestId = h.get('x-request-id');
    if (!requestId) return;
    const body = await cloned.json().catch(() => null);
    await logNetworkResponse(
      requestId,
      body,
      cloned.status,
      cloned.status >= 400,
      {
        companyId: h.get('x-company-id'),
        userId: h.get('x-user-id'),
        mode: h.get('x-mode'),
      },
      h.get('x-request-path') ?? undefined,
    );
  } catch {
    // never break the response
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function withResponseLogging<T extends (...args: any[]) => Promise<Response>>(handler: T): T {
  return (async (...args: Parameters<T>) => {
    const response = await handler(...args);
    void logResponse(response.clone());
    return response;
  }) as T;
}
