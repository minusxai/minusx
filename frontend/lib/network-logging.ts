import 'server-only';
import { MX_API_BASE_URL, MX_API_KEY, MX_NETWORK_LOG_EXCLUDE } from '@/lib/config';
import { immutableSet } from '@/lib/utils/immutable-collections';

// Paths matching any of these regexes are never logged (request or response).
// Comma-separated regex strings from MX_NETWORK_LOG_EXCLUDE env var.
const EXCLUDE_PATTERNS: ReadonlyArray<RegExp> = (
  MX_NETWORK_LOG_EXCLUDE ? MX_NETWORK_LOG_EXCLUDE.split(',').map(s => s.trim()).filter(Boolean) : []
).map(p => new RegExp(p));

function isExcluded(path: string | undefined | null): boolean {
  if (!path) return false;
  return EXCLUDE_PATTERNS.some(re => re.test(path));
}

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
  userId?: string | number | null | undefined;
  mode?: string | null;
}

interface RequestInfo {
  method?: string;
  protocol?: string;
  domain?: string;
  path?: string;
  headers?: Record<string, string>;
}

async function post(endpoint: string, payload: Record<string, unknown>): Promise<void> {
  if (!MX_API_BASE_URL) return;
  if (isExcluded(payload.path as string | undefined)) return;
  try {
    await fetch(`${MX_API_BASE_URL}${endpoint}`, {
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
  await post('/network/request', {
    request_id: requestId,
    method: req.method ?? null,
    protocol: req.protocol ?? null,
    domain: req.domain ?? null,
    path: req.path ?? null,
    headers: req.headers ? sanitizeHeaders(req.headers) : null,
    user_id: user?.userId != null ? String(user.userId) : null,
    mode: user?.mode ?? null,
  });
}

export async function logNetworkResponse(
  requestId: string,
  responseBody: unknown,
  statusCode: number,
  isError: boolean,
  user: UserContext | null,
  path?: string,
): Promise<void> {
  await post('/network/response', {
    request_id: requestId,
    path: path ?? null,
    response_body: responseBody,
    status_code: statusCode,
    is_error: isError,
    user_id: user?.userId != null ? String(user.userId) : null,
    mode: user?.mode ?? null,
  });
}
