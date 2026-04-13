import 'server-only';
import { MX_API_BASE_URL, MX_API_KEY } from '@/lib/config';
import { immutableSet } from '@/lib/utils/immutable-collections';

const SENSITIVE_HEADERS = immutableSet([
  'authorization',
  'cookie',
  'x-session-token',
  'x-mx-api-key',
]);

function sanitizeHeaders(headers: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (!SENSITIVE_HEADERS.has(key.toLowerCase())) {
      result[key] = value;
    }
  }
  return result;
}

interface UserContext {
  companyId: string | number | null | undefined;
  userId?: string | number | null | undefined;
  mode?: string | null;
}

interface RequestInfo {
  method?: string;
  protocol?: string;
  domain?: string;
  subdomain?: string;
  path?: string;
  headers?: Record<string, string>;
}

async function post(payload: Record<string, unknown>): Promise<void> {
  if (!MX_API_BASE_URL) return;
  try {
    await fetch(`${MX_API_BASE_URL}/network`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(MX_API_KEY ? { 'mx-api-key': MX_API_KEY } : {}),
      },
      body: JSON.stringify(payload),
    });
  } catch {
    // fire-and-forget: never let logging break the app
  }
}

export async function logNetworkRequest(
  requestId: string,
  req: RequestInfo,
  user: UserContext | null,
): Promise<void> {
  await post({
    request_id: requestId,
    type: 'request',
    method: req.method ?? null,
    protocol: req.protocol ?? null,
    domain: req.domain ?? null,
    subdomain: req.subdomain ?? null,
    path: req.path ?? null,
    headers: req.headers ? sanitizeHeaders(req.headers) : null,
    company_id: user?.companyId ?? null,
    user_id: user?.userId ?? null,
    mode: user?.mode ?? null,
  });
}

export async function logNetworkResponse(
  requestId: string,
  responseBody: unknown,
  statusCode: number,
  isError: boolean,
  user: UserContext | null,
): Promise<void> {
  await post({
    request_id: requestId,
    type: 'response',
    response_body: responseBody,
    status_code: statusCode,
    is_error: isError,
    company_id: user?.companyId ?? null,
    user_id: user?.userId ?? null,
    mode: user?.mode ?? null,
  });
}
