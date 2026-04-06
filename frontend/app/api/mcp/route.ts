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
import { McpSessionLogger } from '@/lib/mcp/session-logger';
import { appEventRegistry, AppEvents } from '@/lib/app-event-registry';

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
  'Access-Control-Expose-Headers': 'Mcp-Session-Id',
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

function unauthorizedResponse(): Response {
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
        'WWW-Authenticate': 'Bearer',
      },
    }
  );
}

// ---------------------------------------------------------------------------
// POST — tool calls and initialization
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest): Promise<Response> {
  // Authenticate via OAuth Bearer token
  const user = await authenticateOAuthRequest(request);
  if (!user) {
    return unauthorizedResponse();
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

  const server = createMcpServer(user, (tool, args, result) => {
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
        companyId: user.companyId,
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
      companyId: user.companyId,
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

export async function GET(request: NextRequest): Promise<Response> {
  const user = await authenticateOAuthRequest(request);
  if (!user) {
    return unauthorizedResponse();
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
