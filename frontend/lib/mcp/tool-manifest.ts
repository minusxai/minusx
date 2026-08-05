/**
 * The MCP tool surface, declared once.
 *
 * The OAuth consent screen has to tell the user what an MCP client is about to be granted, and
 * it did that with its own hand-typed array of five names. `LoadContext` was added to `server.ts`
 * afterwards and nobody went back to the consent screen, so for every user with a Context Library
 * the screen understated the grant — it named five of the six tools the client would receive, and
 * omitted the one that reads their documents.
 *
 * Two hand-maintained copies of one list is the entire bug, so there is now one copy. `server.ts`
 * registers tools by `MCP_TOOL.X` rather than by retyping the string, and the consent screen maps
 * over `MCP_TOOLS`. A name cannot drift between them because neither of them spells it.
 *
 * What a shared constant still cannot catch is a tool declared here and registered nowhere, or
 * registered under a name absent from `MCP_TOOL`. `__tests__/tool-manifest.e2e.test.ts` closes
 * that by asking a real server what it advertises.
 *
 * No imports: the consent form is a client component and `server.ts` is `server-only`, so this
 * file has to be safe for both.
 */

/**
 * Every tool name, and the only place any of them is written as a string.
 *
 * Callers reference `MCP_TOOL.ExecuteQuery`, never `'ExecuteQuery'` — that is what makes this
 * the single source rather than merely the first of several.
 */
export const MCP_TOOL = {
  SearchDBSchema: 'SearchDBSchema',
  ExecuteQuery: 'ExecuteQuery',
  ListAllConnections: 'ListAllConnections',
  SearchFiles: 'SearchFiles',
  ReadFiles: 'ReadFiles',
  LoadContext: 'LoadContext',
} as const;

export type McpToolName = (typeof MCP_TOOL)[keyof typeof MCP_TOOL];

export interface McpToolManifestEntry {
  name: McpToolName;
  /**
   * True for tools `server.ts` registers only for some users — `LoadContext` appears only when
   * the user's context has on-demand library docs.
   *
   * They are still shown on the consent screen. The access token is what the user approves, and
   * it authorizes the whole surface; which tools a given session exposes is decided later, per
   * session. Naming them all is the honest description of the grant, and understating it is the
   * bug this file exists to prevent.
   */
  conditional?: boolean;
}

/** Every tool `createMcpServer` can register, in the order it registers them. */
export const MCP_TOOLS: readonly McpToolManifestEntry[] = [
  { name: MCP_TOOL.SearchDBSchema },
  { name: MCP_TOOL.ExecuteQuery },
  { name: MCP_TOOL.ListAllConnections },
  { name: MCP_TOOL.SearchFiles },
  { name: MCP_TOOL.ReadFiles },
  { name: MCP_TOOL.LoadContext, conditional: true },
];

/** The tools every session gets, whatever the user's context looks like. */
export const MCP_ALWAYS_REGISTERED_TOOLS: readonly McpToolName[] = MCP_TOOLS.filter(
  (t) => !t.conditional
).map((t) => t.name);
