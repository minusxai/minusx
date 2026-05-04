/**
 * Web tool overrides — replace headless defaults with web-aware implementations.
 *
 * Pattern: each web override extends the headless tool from `agents/` and changes
 * only `run()`. For tools that need user input (Clarify) or Redux state (EditFile,
 * CreateFile, PublishAll), `run()` returns `{ state: 'pending', pending: {...} }` —
 * `runAgent` terminates the loop and the route handler returns the pending tool to
 * the frontend, which presents UI and posts the answer back via the next /api/chat call.
 */
import type { ToolResult } from '@/orchestrator/types';
import { AnalystAgent, type AnalystAgentOptions } from '@/agents';
import { Clarify, EditFile, CreateFile, PublishAll, ReadFiles } from '@/agents';
import type { Tool } from '@/orchestrator/tool';

/**
 * Web Clarify — pauses the agent until the user answers via the next /api/chat POST.
 * The pending payload is what the frontend needs to render the clarification UI.
 */
export class WebClarifyTool extends Clarify {
  async run(args: { question: string; options: { label: string; description?: string }[]; multiSelect?: boolean }): Promise<ToolResult> {
    return {
      state: 'pending',
      pending: {
        kind: 'clarify',
        question: args.question,
        options: args.options,
        multiSelect: args.multiSelect ?? false,
      },
    };
  }
}

/**
 * Web EditFile — Redux state lives in the browser, so we hand the request back as
 * a pending tool. The frontend stages the change and POSTs the result on resume.
 */
export class WebEditFileTool extends EditFile {
  async run(args: { fileId: number; changes: { oldMatch: string; newMatch: string; replaceAll?: boolean }[] }): Promise<ToolResult> {
    return {
      state: 'pending',
      pending: { kind: 'edit-file', fileId: args.fileId, changes: args.changes },
    };
  }
}

export class WebCreateFileTool extends CreateFile {
  async run(args: { file_type: string; name?: string; path?: string; content?: Record<string, unknown> }): Promise<ToolResult> {
    return {
      state: 'pending',
      pending: { kind: 'create-file', ...args },
    };
  }
}

export class WebPublishAllTool extends PublishAll {
  async run(): Promise<ToolResult> {
    return { state: 'pending', pending: { kind: 'publish-all' } };
  }
}

/**
 * Web ReadFiles — defers to the browser's Redux store so the LLM sees the same
 * (possibly dirty) content the user is looking at. Headless `ReadFiles` reads from
 * the document DB directly, which doesn't pick up unpublished drafts.
 */
export class WebReadFilesTool extends ReadFiles {
  async run(args: { fileIds: number[]; maxChars?: number; runQueries?: boolean }): Promise<ToolResult> {
    return {
      state: 'pending',
      pending: { kind: 'read-files', ...args },
    };
  }
}

/**
 * WebAnalystAgent — same as AnalystAgent but swaps in web-aware tools.
 */
export class WebAnalystAgent extends AnalystAgent {
  readonly name = 'WebAnalystAgent';

  constructor(opts: AnalystAgentOptions) {
    super(opts);
    this.tools = this.tools.map((t) => this.swapWebTool(t));
  }

  private swapWebTool(t: Tool): Tool {
    if (t instanceof Clarify) return new WebClarifyTool();
    if (t instanceof EditFile) return new WebEditFileTool();
    if (t instanceof CreateFile) return new WebCreateFileTool();
    if (t instanceof PublishAll) return new WebPublishAllTool();
    if (t instanceof ReadFiles) return new WebReadFilesTool();
    return t;
  }
}
