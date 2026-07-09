import { NextRequest } from 'next/server';
import { RemoteSessionAgent } from '@/agents/remote-session/remote-session-agent';
import { resolveRemoteSession } from '@/lib/chat/remote-session.server';
import { decodeRemoteSessionCode } from '@/lib/data/remote-sessions.server';
import { listAllConnections } from '@/lib/data/connections.server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /s/<code> — the Remote Agent Session skill document (public; the code IS the auth).
 *
 * A self-describing markdown page an external agent (Claude Code, Codex, …) fetches to learn how
 * to drive this MinusX session: what it is, the HTTP protocol, and the full tool schemas.
 * Assembled per-request from live data — a revoked/expired session immediately serves a
 * "session ended" page (410) instead. Malformed/unknown codes are 404.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code } = await params;
  if (!decodeRemoteSessionCode(code)) return markdown('# Not found\n', 404);

  const resolved = await resolveRemoteSession(code);
  if (!resolved.ok) {
    if (resolved.denial === 'malformed' || resolved.denial === 'not_found') {
      return markdown('# Not found\n', 404);
    }
    return markdown(
      [
        '# MinusX remote session — ended',
        '',
        'This remote agent session has ended (stopped by the user, expired, or replaced by a newer link).',
        'Stop making calls with this URL. Ask the user for a fresh "Copy to Agent" link if you need to continue.',
        '',
      ].join('\n'),
      410,
    );
  }

  const { conversation, user } = resolved;
  const base = baseUrl(request);
  const sessionUrl = `${base}/s/${code}`;
  const page = conversation.meta.remoteSession?.page;
  const pageLine = page
    ? `\n- Current page: the user is looking at ${page.fileType ?? 'file'} "${page.fileName ?? ''}" (file id ${page.fileId}) — \`ReadFiles\` it for details. (Navigate changes this.)`
    : '';

  const connections = (await listAllConnections(user)).connections.map((c) => ({
    name: c.name,
    dialect: c.type,
  }));

  // Leaf-tool schemas only (ClarifyFrontend excluded by the agent class; no agents are ever in
  // `tools`). JSON round-trip strips TypeBox's Symbol metadata → plain JSON Schema.
  const tools = RemoteSessionAgent.tools.map((t) => JSON.parse(JSON.stringify(t)) as {
    name: string; description: string; parameters: unknown;
  });

  const doc = `# MinusX Remote Agent Session

You are operating a **live MinusX analytics session** on behalf of its owner (${user.name}, mode: \`${conversation.mode}\`).
Everything you do is rendered in the user's chat sidebar in real time and durably logged. The user can stop this session at any moment.

## Session

- Conversation id: ${conversation.id}${pageLine}
- Session URL (this page — treat it as a secret): \`${sessionUrl}\`
- Data connections: ${connections.length > 0 ? connections.map((c) => `\`${c.name}\` (${c.dialect})`).join(', ') : '(none configured)'}

## First: confirm the goal with YOUR user — before ANY tool calls

Unless your user already told you what to accomplish, your FIRST action is to ask them — not to
explore. **This document already contains everything you need to ask a good question**: the
current page, the data connections, and the full tool list above/below. Do NOT run orientation
calls (\`/context\`, \`SearchFiles\`, \`ReadFiles\`, \`SearchDBSchema\`) before asking — tell your
user you're connected (mention the current page and connections) and ask what they'd like done.
Orient with read-only calls AFTER you know the goal, and only as much as the task needs.

## Protocol

Drive the session with plain HTTP. **One tool call at a time** — wait for each result before the next call.

### Call a tool

\`\`\`
POST ${sessionUrl}/tool
Content-Type: application/json

{ "tool": "<ToolName>", "args": { ... } }
\`\`\`

Responses:
- \`200 { "status": "completed", "toolCallId", "isError", "content": [...] }\` — done. \`content\` is a list of blocks: \`{type:'text', text}\` and images as \`{type:'image', url}\` or \`{type:'image', data, mimeType}\` (base64). \`isError: true\` means the TOOL failed (bad SQL, missing file, …) — read the message and recover; the session is still live.
- \`202 { "status": "pending", "toolCallId", "pollAfterMs" }\` — the tool is executing in the user's browser. Poll:

\`\`\`
GET ${sessionUrl}/result/<toolCallId>
\`\`\`

which returns the same \`200 completed\` shape (or \`202\` again — keep polling at \`pollAfterMs\`).

Errors:
- \`400\` — unknown tool or args failed schema validation (body includes details). Fix and retry.
- \`410 { "error": "session_ended" }\` — this session has ended (stopped, expired, or disabled). Stop making calls; ask the user for a fresh link. (\`404\` = the URL is not a live session at all.)
- \`409\` — another call is still in flight. Wait and retry.
- A \`202\` with \`"browserMaybeUnreachable": true\` — the tool has waited unusually long in the user's browser: either no tab is open, or a confirmation prompt (e.g. allowing a navigation) is awaiting the user. Keep polling and tell YOUR user to check their MinusX tab. Issuing a different tool call will supersede (cancel) the stuck one.
- \`429\` — rate limited. Back off.

### Orientation

\`GET ${sessionUrl}/context\` returns a JSON snapshot (connections, tool names).

### Finish

When you are done, end the session politely:

\`\`\`
POST ${sessionUrl}/end
\`\`\`

### Example: run SQL

\`\`\`
curl -sS -X POST ${sessionUrl}/tool \\
  -H 'Content-Type: application/json' \\
  -d '{"tool":"ExecuteQuery","args":{"sql":"SELECT 1 AS one","connection":"${connections[0]?.name ?? '<connection name>'}"}}'
\`\`\`

## Tips

- Start with \`SearchDBSchema\` to discover tables, then \`ExecuteQuery\` to explore data.
- \`ReadFiles\` / \`SearchFiles\` read the user's saved questions/dashboards; \`EditFile\` / \`CreateFile\` modify them (these run in the user's browser — expect \`202\` + poll).
- The stored markup is a **normalized projection**: HTML comments are dropped and attributes/whitespace may be rewritten on save — so text YOU authored may not survive verbatim. Never anchor an \`EditFile\` \`oldMatch\` on something you wrote from memory; anchor on markup you have SEEN (the latest diff, \`currentMarkup\` from a failed edit, or a fresh \`ReadFiles\`). Every EditFile response's \`diff\` shows the exact stored form.
- File contents use MinusX markup. **Before creating or editing a file type for the first time, call \`LoadSkill\` with that type's guide** — \`{"tool":"LoadSkill","args":{"name":"stories"}}\` (also: \`questions\`, \`dashboards\`, \`visualizations\`, \`reports\`, \`alerts\`, \`notebooks\`). The guide is the source of truth for that type's markup; follow it precisely.
- To create a NEW story/question/dashboard: \`Navigate\` with \`newFileType\` (creates a draft and opens it in the user's browser), then \`EditFile\` the returned file id. Save/publish happens via \`PublishAll\`, which asks the USER to approve — expect a wait while they review.
- If you need input from a human, ask YOUR user directly (your own chat/terminal) — there is no in-MinusX prompt channel.

## Tools

${tools.map((t) => `### ${t.name}

${t.description}

Parameters (JSON Schema):

\`\`\`json
${JSON.stringify(t.parameters, null, 2)}
\`\`\`
`).join('\n')}
`;

  return markdown(doc, 200);
}

function baseUrl(request: NextRequest): string {
  const proto = (request.headers.get('x-forwarded-proto') || request.nextUrl.protocol.replace(':', ''))
    .split(',')[0].trim();
  const host = (request.headers.get('x-forwarded-host') || request.headers.get('host') || request.nextUrl.host)
    .split(',')[0].trim();
  return `${proto}://${host}`;
}

function markdown(body: string, status: number): Response {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'text/markdown; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
