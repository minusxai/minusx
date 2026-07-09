import { NextRequest, NextResponse } from 'next/server';
import { withRemoteSessionAuth } from '@/lib/http/with-remote-session-auth';
import { RemoteSessionAgent } from '@/agents/remote-session/remote-session-agent';
import { listAllConnections } from '@/lib/data/connections.server';
import type { RemoteSessionContext } from '@/lib/data/remote-sessions.types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** GET /s/<code>/context — orientation snapshot for the external agent (Remote Agent Sessions). */
export const GET = withRemoteSessionAuth(async (_request: NextRequest, { conversation, user }) => {
  const connections = (await listAllConnections(user)).connections.map((c) => ({
    name: c.name,
    dialect: c.type,
  }));
  const snapshot: RemoteSessionContext = {
    conversationId: conversation.id,
    mode: conversation.mode,
    agentName: 'RemoteSessionAgent',
    ...(conversation.meta.remoteSession?.page ? { currentPage: conversation.meta.remoteSession.page } : {}),
    connections,
    toolNames: RemoteSessionAgent.tools.map((t) => t.name),
  };
  return NextResponse.json(snapshot);
});
