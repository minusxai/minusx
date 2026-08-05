/**
 * MCP Streamable HTTP Endpoint
 *
 * Single endpoint handling POST (tool calls), GET (SSE stream),
 * and DELETE (session termination) for the MCP protocol.
 *
 * Uses Web Standard transport (Request/Response) — native to Next.js App Router.
 * Each session is tied to an authenticated user via OAuth Bearer token.
 */

import { NextRequest } from 'next/server';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { authenticateOAuthRequest } from '@/lib/mcp/auth';
import { createMcpServer } from '@/lib/mcp/server';
import { getModules } from '@/lib/modules/registry';
import { McpSessionLogger } from '@/lib/mcp/session-logger';
import { appEventRegistry, AppEvents } from '@/lib/app-event-registry';
import { getProtectedResourceMetadataUrl } from '@/lib/oauth/base-url';

// ---------------------------------------------------------------------------
// Session store (in-memory, survives HMR via globalThis)
// ---------------------------------------------------------------------------

interface McpSession {
  transport: WebStandardStreamableHTTPServerTransport;
  server: McpServer;
  logger: McpSessionLogger;
}

/* eslint-disable no-restricted-syntax -- safe: keyed by crypto.randomUUID(), auth-gated before access */
const sessions: Map<string, McpSession> = (
  (globalThis as Record<string, unknown>).__mcpSessions ??= new Map<string, McpSession>()
) as Map<string, McpSession>;
/* eslint-enable no-restricted-syntax */

// Clean up stale sessions every 30 minutes
const CLEANUP_INTERVAL = 30 * 60 * 1000;
if (!(globalThis as Record<string, unknown>).__mcpCleanupTimer) {
  (globalThis as Record<string, unknown>).__mcpCleanupTimer = setInterval(() => {
    // The transport handles its own expiry — we just prune disconnected entries
    for (const [id, session] of sessions) {
      if (!session.transport.sessionId) {
        sessions.delete(id);
      }
    }
  }, CLEANUP_INTERVAL);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, Accept, Mcp-Session-Id',
  // WWW-Authenticate is exposed because the 401 challenge is a client's discovery entry point
  // (see unauthorizedResponse). Without this a browser-based MCP client gets the 401 but cannot
  // read the header off it, so citing resource_metadata there would do nothing for exactly the
  // clients that have no other way to find it.
  'Access-Control-Expose-Headers': 'Mcp-Session-Id, WWW-Authenticate',
};

export async function OPTIONS(): Promise<Response> {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

function addCorsHeaders(response: Response): Response {
  const newResponse = new Response(response.body, response);
  for (const [key, value] of Object.entries(CORS_HEADERS)) {
    newResponse.headers.set(key, value);
  }
  return newResponse;
}

/**
 * The 401 an MCP client is expected to bootstrap from.
 *
 * RFC 9728 has the challenge cite the Protected Resource Metadata document, and that is how a
 * client with nothing but this URL discovers where to authenticate: 401 → fetch
 * `resource_metadata` → read `authorization_servers` → RFC 8414 → register and authorize. The
 * header used to be the bare word `Bearer`, which names a scheme and nothing else, so a client
 * had to already know to guess `/.well-known/oauth-protected-resource` — clients that follow the
 * spec instead of guessing simply failed to connect.
 *
 * `error="invalid_token"` is only correct when a token was actually presented (RFC 6750 §3.1).
 * On a request with no `Authorization` header at all there is nothing invalid yet, and sending
 * the code anyway tells a client its credentials were rejected when it never offered any.
 */
function unauthorizedResponse(request: Request): Response {
  const presentedToken = request.headers.get('authorization')?.startsWith('Bearer ') ?? false;

  const params = [
    'realm="minusx"',
    ...(presentedToken ? ['error="invalid_token"'] : []),
    `resource_metadata="${getProtectedResourceMetadataUrl(request)}"`,
  ];

  return new Response(
    JSON.stringify({
      jsonrpc: '2.0',
      error: { code: -32001, message: 'Unauthorized' },
      id: null,
    }),
    {
      status: 401,
      headers: {
        ...CORS_HEADERS,
        'Content-Type': 'application/json',
        // "Bearer" is the scheme; the auth-params after it are comma-separated.
        'WWW-Authenticate': `Bearer ${params.join(', ')}`,
      },
    }
  );
}

// ---------------------------------------------------------------------------
// POST — tool calls and initialization
// ---------------------------------------------------------------------------

async function handleMcpPost(request: NextRequest): Promise<Response> {
  // Authenticate via OAuth Bearer token
  const user = await authenticateOAuthRequest(request);
  if (!user) {
    return unauthorizedResponse(request);
  }

  const sessionId = request.headers.get('mcp-session-id');

  // Existing session — route to its transport
  if (sessionId && sessions.has(sessionId)) {
    const session = sessions.get(sessionId)!;
    return addCorsHeaders(await session.transport.handleRequest(request));
  }

  // New session — create server + transport + logger.
  // Use a mutable ref so the onToolCall closure can access the logger
  // after onsessioninitialized sets it (the SDK assigns session IDs asynchronously).
  const sessionRef: { logger: McpSessionLogger | null } = { logger: null };

  const server = await createMcpServer(user, (tool, args, result) => {
    sessionRef.logger?.logToolCall(tool, args, result);
  });

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: () => crypto.randomUUID(),
    onsessioninitialized: (id: string) => {
      const logger = new McpSessionLogger(id, user);
      sessionRef.logger = logger;
      sessions.set(id, { transport, server, logger });
      appEventRegistry.publish(AppEvents.USER_MESSAGE, {
        source: 'mcp',
        userId: user.userId,
        userEmail: user.email,
        
        mode: user.mode,
      });
    },
    onsessionclosed: (id: string) => {
      const session = sessions.get(id);
      if (session) {
        void session.logger.flush(); // fire-and-forget — must not block the close
        sessions.delete(id);
      }
    },
  });

  try {
    await server.connect(transport);
    return addCorsHeaders(await transport.handleRequest(request));
  } catch (err) {
    appEventRegistry.publish(AppEvents.ERROR, {
      source: 'mcp',
      message: err instanceof Error ? err.message : String(err),
      error: err,
      
      mode: user.mode,
    });
    return new Response(JSON.stringify({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal error' }, id: null }), {
      status: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }
}

// ---------------------------------------------------------------------------
// GET — SSE stream for server-to-client notifications
// ---------------------------------------------------------------------------

async function handleMcpGet(request: NextRequest): Promise<Response> {
  const user = await authenticateOAuthRequest(request);
  if (!user) {
    return unauthorizedResponse(request);
  }

  const sessionId = request.headers.get('mcp-session-id');
  if (!sessionId || !sessions.has(sessionId)) {
    return new Response('Session not found', { status: 404, headers: CORS_HEADERS });
  }

  return addCorsHeaders(await sessions.get(sessionId)!.transport.handleRequest(request));
}

// ---------------------------------------------------------------------------
// DELETE — session termination (triggers onsessionclosed → logger.flush)
// ---------------------------------------------------------------------------

export async function DELETE(request: NextRequest): Promise<Response> {
  const sessionId = request.headers.get('mcp-session-id');
  if (sessionId && sessions.has(sessionId)) {
    const session = sessions.get(sessionId)!;
    await session.server.close(); // SDK calls onsessionclosed, which flushes + removes
  }
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

/**
 * MCP requests carry their namespace in a bearer token, not in the host, so it has to
 * be resolved here rather than by middleware.
 *
 * `with()` scopes it to this handler, deliberately rather than setting it ambiently for
 * the async context: an ambient value cannot be unset, so it persists onto whatever runs
 * next on the same context — which, for a pooled server, is an unrelated request.
 */
async function withNamespace(
  request: NextRequest,
  handler: (request: NextRequest) => Promise<Response>,
): Promise<Response> {
  const ns = await getModules().namespace.resolve(request);
  if (ns == null) return unauthorizedResponse(request);
  return getModules().namespace.with(ns, () => handler(request));
}

export const POST = (request: NextRequest): Promise<Response> => withNamespace(request, handleMcpPost);
export const GET = (request: NextRequest): Promise<Response> => withNamespace(request, handleMcpGet);
