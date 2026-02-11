/**
 * FrontendToolException
 *
 * Exception thrown by Next.js backend tools to signal that they need to spawn
 * frontend tool calls to complete their work.
 *
 * When this exception is thrown:
 * 1. The parent tool is NOT completed (no TaskResult added)
 * 2. Spawned tools are added as pending with _parent_unique_id reference
 * 3. Frontend executes the child tools
 * 4. Python orchestrator resumes parent with _child_tasks_batch arg
 */

interface ToolCallSpec {
  type: 'function';
  function: {
    name: string;
    arguments: Record<string, any>;  // Always an object - HTTP response handles JSON serialization
  };
}

export class FrontendToolException extends Error {
  public spawnedTools: ToolCallSpec[];

  constructor(config: { spawnedTools: ToolCallSpec[] }) {
    super('Tool requires frontend execution');
    this.name = 'FrontendToolException';
    this.spawnedTools = config.spawnedTools;
  }
}
